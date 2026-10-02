// The company marker layer: a MapLibre custom layer that draws every cluster, logo, and stack as one
// instanced quad in a single draw call (map-spec §1). No DOM markers, no React.
//
// Camera: north-up and top-down only. Positions are projected to screen px on the CPU (geometry.ts), so the
// layer does not use MapLibre's matrices. A map with bearing or pitch draws nothing and sets
// stats.unsupportedCamera; the explorer turns rotation and tilt off.
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { Animator, type AnimOutput, type AnimStats } from "../animation/animator.ts";
import type { GlyphSheet } from "../atlas/glyph-sheet.ts";
import { MAX_LOGO_PAGES, type LogoAtlas } from "../atlas/logo-atlas.ts";
import { parseCssColor, type MarkerTheme, type Rgb } from "../theme.ts";
import { latToMercatorY, lngToMercatorX, viewFor, type View } from "./geometry.ts";
import { FLOATS_PER_INSTANCE, FramePacker, STATIC_FLOATS, prepareScene, type LayerItem, type MarkerKind, type PreparedScene, type ScenePalette } from "./instances.ts";
import { MARKER_FRAGMENT, MARKER_VERTEX } from "./shaders/marker.ts";

export type CompanyLayerOptions = {
  theme: MarkerTheme;
  glyphs: GlyphSheet;
  /** Without one, every logo shows its letter fallback. The layer drives it and disposes it when removed. */
  logoAtlas?: LogoAtlas;
  /** The clock for animation, in ms. Default `performance.now`. Tests inject one to hold a transition still. */
  now?: () => number;
  id?: string;
};

/** One item of a zoom or filter update, with the lineage the worker returned. */
export type LayerTarget = { item: LayerItem; parentKey: string; childKeys: readonly string[] };

export type LayerUpdate = {
  targets: readonly LayerTarget[];
  /** The integer zoom level of the response. */
  level: number;
  /** `dataVersion:filterHash`: a different one replaces the scene with a cross-fade. */
  namespace: string;
  /** The worker response's generation. An older update than one already applied is ignored. */
  generation: number;
};

export type DrawnItem = {
  key: string;
  kind: MarkerKind;
  x: number;
  y: number;
  radius: number;
  selected: boolean;
  /** 0…1 as drawn in the last frame, after animation. */
  opacity: number;
};

export type LayerStats = {
  items: number;
  drawn: number;
  culled: number;
  /** Draw calls in the last frame: 1 when anything is drawn. */
  drawCalls: number;
  frames: number;
  unsupportedCamera: boolean;
  contextRestores: number;
  /** True while any marker is still moving, growing, or fading. */
  animating: boolean;
};

type Gpu = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
  instances: WebGLBuffer;
  /** Capacity of the instance buffer in floats. */
  capacity: number;
  texture: WebGLTexture;
  /** A 1×1 texture for the logo sampler units when there is no atlas. */
  dummy: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

const BYTES = 4;
const STRIDE = FLOATS_PER_INSTANCE * BYTES;
/** Attribute locations, offsets in floats, and sizes. Keep in step with the vertex shader and instances.ts. */
const ATTRIBUTES: Array<[location: number, size: number, offset: number]> = [
  [1, 2, 0], // centre
  [2, 1, 2], // radius
  [3, 1, 3], // kind
  [4, 1, 4], // flags
  [5, 1, 5], // opacity
  [6, 3, 6], // fill
  [7, 4, 9], // glyph cells
  [8, 4, 13], // glyph x
  [9, 2, 17], // em, badge em
  [10, 4, 19], // logo: atlas page, cell u, cell v, cross-fade
];

const UNIFORM_NAMES = [
  "u_resolution",
  "u_clusterFill",
  "u_clusterHalo",
  "u_text",
  "u_logoRing",
  "u_badge",
  "u_badgeText",
  "u_selection",
  "u_focus",
  "u_logoFill",
  "u_glyphs",
  "u_grid",
  "u_logo0",
  "u_logo1",
  "u_logo2",
  "u_logo3",
  "u_logo4",
  "u_logo5",
  "u_logo6",
  "u_logo7",
  "u_logoCell",
  "u_pageSize",
] as const;

/** Texture unit 0 holds the glyph sheet; the logo pages take units 1…8. */
const FIRST_LOGO_UNIT = 1;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Marker shader failed to compile: ${log}`);
  }
  return shader;
}

export class CompanyLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  readonly stats: LayerStats = {
    items: 0,
    drawn: 0,
    culled: 0,
    drawCalls: 0,
    frames: 0,
    unsupportedCamera: false,
    contextRestores: 0,
    animating: false,
  };

  private readonly glyphs: GlyphSheet;
  private readonly logoAtlas: LogoAtlas | null;
  private readonly now: () => number;
  private readonly colours: Record<"clusterFill" | "clusterHalo" | "text" | "logoRing" | "logoFill" | "badge" | "badgeText" | "selection" | "focus", Rgb>;
  private readonly palette: ScenePalette;
  private readonly packer = new FramePacker();
  private readonly animator = new Animator<LayerItem>();
  private scene: PreparedScene;
  /** The animator's state for each scene item, refilled every frame. */
  private dynamic: AnimOutput = { x: new Float64Array(0), y: new Float64Array(0), scale: new Float32Array(0), opacity: new Float32Array(0) };
  private map: MapLibreMap | null = null;
  private gpu: Gpu | null = null;
  private lastView: View | null = null;
  private lastSampleTime = Number.NaN;
  private framesAtSameTime = 0;

  constructor(options: CompanyLayerOptions) {
    const { theme } = options;
    this.id = options.id ?? "company-markers";
    this.glyphs = options.glyphs;
    this.logoAtlas = options.logoAtlas ?? null;
    this.now = options.now ?? (() => performance.now());
    this.colours = {
      clusterFill: parseCssColor(theme.clusterFill),
      clusterHalo: parseCssColor(theme.clusterHalo),
      text: parseCssColor(theme.clusterText),
      logoRing: parseCssColor(theme.logoRing),
      logoFill: parseCssColor(theme.logoFill),
      badge: parseCssColor(theme.stackBadge),
      badgeText: parseCssColor(theme.stackBadgeText),
      selection: parseCssColor(theme.selectionRing),
      focus: parseCssColor(theme.focusRing),
    };
    this.palette = { swatches: theme.swatches.map(parseCssColor), logoFill: parseCssColor(theme.logoFill) };
    this.scene = prepareScene([], this.palette, this.glyphs.metrics);
  }

  /** Replaces everything on the map at once, with no animation. Keys must be unique. */
  setItems(items: readonly LayerItem[]): void {
    this.animator.reset({
      generation: Number.NEGATIVE_INFINITY, // a later setTargets, whatever its generation, is newer than this
      level: 0,
      namespace: "",
      targets: items.map((item) => ({ item, ...this.place(item), parentKey: item.key, childKeys: [item.key] })),
    });
    this.rebuild();
  }

  /**
   * Moves the map to a new set of items with split, merge, or cross-fade animation, from the markers' current
   * positions (map-spec §4). Returns false, and changes nothing, if a newer generation was already applied.
   */
  setTargets(update: LayerUpdate): boolean {
    const applied = this.animator.update({
      generation: update.generation,
      level: update.level,
      namespace: update.namespace,
      targets: update.targets.map((t) => ({ item: t.item, ...this.place(t.item), parentKey: t.parentKey, childKeys: t.childKeys })),
      now: this.now(),
    });
    if (applied) this.rebuild();
    return applied;
  }

  /** What the last update did: mode, how many markers moved, and whether it cross-faded to stay smooth. */
  get animation(): Readonly<AnimStats> {
    return this.animator.stats;
  }

  private place(item: LayerItem): { mx: number; my: number } {
    return { mx: lngToMercatorX(item.lng), my: latToMercatorY(item.lat) };
  }

  /** Builds the drawable scene from everything on the animator's render list, including markers fading out. */
  private rebuild(): void {
    this.scene = prepareScene(this.animator.items, this.palette, this.glyphs.metrics);
    const n = this.scene.count;
    this.dynamic = { x: new Float64Array(n), y: new Float64Array(n), scale: new Float32Array(n), opacity: new Float32Array(n) };
    this.stats.items = n;
    this.map?.triggerRepaint();
  }

  /** The items drawn in the last frame, in draw order, with their screen positions (CSS px). */
  getDrawn(): DrawnItem[] {
    const out: DrawnItem[] = [];
    for (let k = 0; k < this.stats.drawn; k++) {
      const i = this.packer.indices[k];
      out.push({
        key: this.scene.keys[i],
        kind: this.scene.kinds[i],
        x: this.packer.x[k],
        y: this.packer.y[k],
        radius: this.packer.r[k],
        selected: (this.scene.statics[i * STATIC_FLOATS + 2] & 1) === 1, // flag bit 0 (instances.ts)
        opacity: this.packer.data[k * FLOATS_PER_INSTANCE + 5],
      });
    }
    return out;
  }

  /** The view used for the last frame, for tests and for hit testing. */
  getView(): View | null {
    return this.lastView;
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.logoAtlas?.setOnChange(() => map.triggerRepaint());
    this.gpu = this.createGpu(gl);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    // After a context loss every GL object is already gone, and deleting them would only raise errors.
    if (this.gpu && !gl.isContextLost()) this.destroyGpu(this.gpu);
    this.logoAtlas?.dispose(gl); // also the path after a lost context: its textures are gone with it
    this.gpu = null;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext): void {
    const map = this.map;
    if (!map || gl.isContextLost()) return;
    if (!this.gpu || this.gpu.gl !== gl) this.gpu = this.createGpu(gl);

    this.stats.frames++;
    this.stats.unsupportedCamera = map.getBearing() !== 0 || map.getPitch() !== 0;
    this.stats.drawn = 0;
    this.stats.culled = 0;
    this.stats.drawCalls = 0;
    if (this.stats.unsupportedCamera) return;

    const canvas = map.getCanvas();
    const view = viewFor(map.getCenter(), map.getZoom(), canvas.clientWidth, canvas.clientHeight);
    this.lastView = view;
    const atlas = this.logoAtlas;
    atlas?.beginFrame();
    atlas?.flushUploads(gl);
    const scene = this.scene;
    // Where every marker is right now: the animator moves, grows, and fades them between updates.
    const time = this.now();
    const animating = this.animator.sample(time, this.dynamic, this.scene.sourceIndex);
    this.stats.animating = animating;
    // A frame can only differ from the last one if the clock moved. A held test clock does not move, so it
    // must not keep the render loop spinning (each software-GL frame is slow enough to starve the page).
    // One repeat is allowed, because the real clock is coarse and two frames can share a timestamp.
    this.framesAtSameTime = time === this.lastSampleTime ? this.framesAtSameTime + 1 : 0;
    this.lastSampleTime = time;
    const clockMoved = this.framesAtSameTime < 2;
    const { drawn, culled } = this.packer.pack(scene, view, {
      dynamic: this.dynamic,
      // Only drawn markers get here, so only visible companies ask for their logo.
      logoFor: atlas
        ? (i) => {
            const url = scene.logoUrls[i];
            if (!url) return null;
            atlas.request(scene.companyIds[i], url);
            return atlas.lookup(scene.companyIds[i]);
          }
        : undefined,
    });
    this.stats.drawn = drawn;
    this.stats.culled = culled;
    // Ask for the next frame even if nothing is visible yet: a fade-in starts at opacity 0.
    if (animating && clockMoved) map.triggerRepaint();
    if (drawn === 0) return;

    const gpu = this.gpu;
    const { uniforms } = gpu;
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);

    // Blending is already premultiplied (ONE, ONE_MINUS_SRC_ALPHA); the rest is set here because a custom
    // layer may not assume any other GL state.
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);

    gl.uniform2f(uniforms.u_resolution, view.width, view.height);
    gl.uniform3fv(uniforms.u_clusterFill, this.colours.clusterFill);
    gl.uniform3fv(uniforms.u_clusterHalo, this.colours.clusterHalo);
    gl.uniform3fv(uniforms.u_text, this.colours.text);
    gl.uniform3fv(uniforms.u_logoRing, this.colours.logoRing);
    gl.uniform3fv(uniforms.u_logoFill, this.colours.logoFill);
    gl.uniform3fv(uniforms.u_badge, this.colours.badge);
    gl.uniform3fv(uniforms.u_badgeText, this.colours.badgeText);
    gl.uniform3fv(uniforms.u_selection, this.colours.selection);
    gl.uniform3fv(uniforms.u_focus, this.colours.focus);
    gl.uniform2f(uniforms.u_grid, this.glyphs.columns, this.glyphs.rows);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.texture);
    gl.uniform1i(uniforms.u_glyphs, 0);
    if (atlas) {
      atlas.bindPages(gl, FIRST_LOGO_UNIT);
    } else {
      for (let i = 0; i < MAX_LOGO_PAGES; i++) {
        gl.activeTexture(gl.TEXTURE0 + FIRST_LOGO_UNIT + i);
        gl.bindTexture(gl.TEXTURE_2D, gpu.dummy);
      }
    }
    for (let i = 0; i < MAX_LOGO_PAGES; i++) gl.uniform1i(uniforms[`u_logo${i}` as (typeof UNIFORM_NAMES)[number]], FIRST_LOGO_UNIT + i);
    const cell = atlas ? atlas.cellPx / atlas.pageSize : 1;
    gl.uniform2f(uniforms.u_logoCell, cell, cell);
    gl.uniform1f(uniforms.u_pageSize, atlas ? atlas.pageSize : 1);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instances);
    const needed = drawn * FLOATS_PER_INSTANCE;
    if (needed > gpu.capacity) {
      gpu.capacity = Math.max(needed, gpu.capacity * 2);
      gl.bufferData(gl.ARRAY_BUFFER, gpu.capacity * BYTES, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.packer.data, 0, needed);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawn);
    this.stats.drawCalls = 1;
    gl.bindVertexArray(null);
    // Logos still cross-fading, or waiting for their upload slot, need another frame.
    if (atlas?.needsRepaint) map.triggerRepaint();
  }

  private createGpu(gl: WebGL2RenderingContext): Gpu {
    const vertex = compile(gl, gl.VERTEX_SHADER, MARKER_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, MARKER_FRAGMENT);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Marker program failed to link: ${log}`);
    }

    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    const instances = gl.createBuffer();
    const texture = gl.createTexture();
    const dummy = gl.createTexture();
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const capacity = 1024 * FLOATS_PER_INSTANCE;
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * BYTES, gl.DYNAMIC_DRAW);
    for (const [location, size, offset] of ATTRIBUTES) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE, offset * BYTES);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.glyphs.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const uniforms = {} as Gpu["uniforms"];
    for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name);
    return { gl, program, vao, quad, instances, capacity, texture, dummy, uniforms };
  }

  private destroyGpu(gpu: Gpu): void {
    const { gl } = gpu;
    gl.deleteProgram(gpu.program);
    gl.deleteVertexArray(gpu.vao);
    gl.deleteBuffer(gpu.quad);
    gl.deleteBuffer(gpu.instances);
    gl.deleteTexture(gpu.texture);
    gl.deleteTexture(gpu.dummy);
  }
}

/**
 * Adds the layer (as soon as the style allows it) and keeps it alive across WebGL context loss (map-spec §9). MapLibre removes custom layers
 * when the context is lost and does not bring them back, so this re-adds the layer on `webglcontextrestored`.
 * The layer still holds its items, so the scene reappears with no further call. Returns a function that
 * removes the layer and stops listening; call it on unmount or city change.
 */
export function attachCompanyLayer(map: MapLibreMap, layer: CompanyLayer, beforeId?: string): () => void {
  // After a restore MapLibre reloads the style, and addLayer throws until that has finished ("Style is not done
  // loading"). So try, and on that error try again at the next style event.
  const add = (): void => {
    if (map.getLayer(layer.id)) return;
    try {
      map.addLayer(layer, beforeId);
      map.triggerRepaint();
    } catch {
      map.once("styledata", add);
    }
  };
  const restore = (): void => {
    layer.stats.contextRestores++;
    add();
  };
  // The same path as a restore, so the layer also attaches while the style is still loading. It must not wait for
  // the map's `load` event: that needs every visible tile, and with a failing basemap it never comes (map-spec §9).
  add();
  map.on("webglcontextrestored", restore);
  return () => {
    map.off("webglcontextrestored", restore);
    map.off("styledata", add);
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  };
}
