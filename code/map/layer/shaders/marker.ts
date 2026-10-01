// GLSL ES 3.00 for the marker layer: one instanced quad per cluster, logo, or stack.
// No colour is written here. Every colour arrives as a uniform read from the design tokens (map/theme.ts),
// so a palette swap never touches a shader. Sizes are in CSS px; anti-aliasing is one device pixel.

/** Extra space around the disc for the halo, selection ring, and focus ring. Keep in step with the fragment shader. */
export const QUAD_PADDING = 14;

export const MARKER_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // (-1..1) quad corner, shared by every instance
layout(location = 1) in vec2 a_center;   // screen px
layout(location = 2) in float a_radius;  // px
layout(location = 3) in float a_kind;    // 0 logo, 1 cluster, 2 stack
layout(location = 4) in float a_flags;   // bit 0 selected, bit 1 keyboard focus
layout(location = 5) in float a_opacity;
layout(location = 6) in vec3 a_fill;     // logo fill (a swatch or Milky)
layout(location = 7) in vec4 a_cells;    // glyph cells, -1 = none
layout(location = 8) in vec4 a_xs;       // glyph centres in em units
layout(location = 9) in vec2 a_em;       // main text em, badge text em (both x radius)

uniform vec2 u_resolution;               // canvas size, CSS px

out vec2 v_local;
flat out float v_radius;
flat out float v_kind;
flat out float v_flags;
flat out float v_opacity;
flat out vec3 v_fill;
flat out vec4 v_cells;
flat out vec4 v_xs;
flat out vec2 v_em;

void main() {
  float extent = a_radius + ${QUAD_PADDING.toFixed(1)};
  v_local = a_corner * extent;
  vec2 px = a_center + v_local;
  gl_Position = vec4(px.x / u_resolution.x * 2.0 - 1.0, 1.0 - px.y / u_resolution.y * 2.0, 0.0, 1.0);
  v_radius = a_radius;
  v_kind = a_kind;
  v_flags = a_flags;
  v_opacity = a_opacity;
  v_fill = a_fill;
  v_cells = a_cells;
  v_xs = a_xs;
  v_em = a_em;
}
`;

export const MARKER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_local;
flat in float v_radius;
flat in float v_kind;
flat in float v_flags;
flat in float v_opacity;
flat in vec3 v_fill;
flat in vec4 v_cells;
flat in vec4 v_xs;
flat in vec2 v_em;

uniform vec3 u_clusterFill;
uniform vec3 u_clusterHalo;
uniform vec3 u_text;
uniform vec3 u_logoRing;
uniform vec3 u_badge;
uniform vec3 u_badgeText;
uniform vec3 u_selection;
uniform vec3 u_focus;
uniform sampler2D u_glyphs;
uniform vec2 u_grid;                     // sheet columns, rows

out vec4 outColor;

// Premultiplied alpha, matching MapLibre's blend function (ONE, ONE_MINUS_SRC_ALPHA).
vec4 shape(vec3 rgb, float a) { return vec4(rgb * a, a); }
vec4 over(vec4 top, vec4 below) { return top + below * (1.0 - top.a); }
float inside(float dist, float aa) { return clamp(0.5 - dist / aa, 0.0, 1.0); }
float band(float dist, float inner, float outer, float aa) { return inside(dist - outer, aa) * (1.0 - inside(dist - inner, aa)); }

void main() {
  float R = v_radius;
  float d = length(v_local);
  float aa = max(fwidth(d), 0.0001);
  int flags = int(v_flags + 0.5);
  bool selected = (flags & 1) != 0;
  bool focused = (flags & 2) != 0;
  bool isCluster = v_kind > 0.5 && v_kind < 1.5;
  bool isStack = v_kind > 1.5;

  vec4 col = vec4(0.0);

  // Keyboard focus: a 2 px ring offset 3 px from the marker (or from its selection ring).
  float outer = R + (selected ? 3.0 : 0.0);
  if (focused) col = over(shape(u_focus, band(d, outer + 3.0, outer + 5.0, aa)), col);
  // Selection: a 3 px ring around the marker.
  if (selected) col = over(shape(u_selection, band(d, R, R + 3.0, aa)), col);

  if (isCluster) {
    // A 2 px halo, then the disc inside it.
    col = over(shape(u_clusterHalo, inside(d - R, aa)), col);
    col = over(shape(u_clusterFill, inside(d - (R - 2.0), aa)), col);
  } else {
    col = over(shape(v_fill, inside(d - R, aa)), col);
    col = over(shape(u_logoRing, band(d, R - 2.0, R, aa)), col);
  }

  // The co-location badge sits at the top right of the top logo.
  float bR = 0.5 * R;
  vec2 bC = vec2(0.72, -0.72) * R;
  if (isStack) {
    float db = length(v_local - bC);
    col = over(shape(u_badgeText, inside(db - (bR + 1.5), aa)), col);
    col = over(shape(u_badge, inside(db - bR, aa)), col);
  }

  // Glyphs. Derivatives are taken here, in uniform control flow, then passed to textureGrad.
  vec2 gdx = dFdx(v_local);
  vec2 gdy = dFdy(v_local);
  for (int i = 0; i < 4; i++) {
    float cell = v_cells[i];
    if (cell < 0.0) continue;
    bool onBadge = isStack && i >= 1;
    vec2 origin = onBadge ? bC : vec2(0.0);
    float em = (onBadge ? v_em.y : v_em.x) * R;
    vec2 p = (v_local - origin) / em;
    p.x -= v_xs[i];
    if (abs(p.x) < 0.5 && abs(p.y) < 0.5) {
      vec2 colRow = vec2(mod(cell, u_grid.x), floor(cell / u_grid.x));
      vec2 uv = (colRow + p + 0.5) / u_grid;
      float a = textureGrad(u_glyphs, uv, gdx / (em * u_grid), gdy / (em * u_grid)).a;
      col = over(shape(onBadge ? u_badgeText : u_text, a), col);
    }
  }

  outColor = col * v_opacity;
}
`;
