// Slot bookkeeping for the multi-page logo atlas (map-spec §5): which cell of which page holds which company.
// Pure and DOM-free. Pages are added on demand up to a cap; when the cap is reached the least recently used
// entry is evicted, but never one used in the current frame (that would blink a logo that is on screen).

export type Slot = { page: number; index: number };

export type SlotAllocatorOptions = {
  /** Cells in one page: (pageSize / cellPx)². */
  slotsPerPage: number;
  /** The page cap, from the GPU memory budget. */
  maxPages: number;
};

export type SlotAllocatorStats = { pages: number; used: number; capacity: number; evictions: number };

export class SlotAllocator<K> {
  private readonly slotsPerPage: number;
  private readonly maxPages: number;
  private pages = 0;
  /** Insertion order is recency order: the first entry is the least recently used. */
  private readonly entries = new Map<K, { slot: Slot; frame: number }>();
  private free: Slot[] = [];
  private evictions = 0;

  /** Called with each key that loses its slot to eviction. */
  onEvict: ((key: K, slot: Slot) => void) | null = null;

  constructor(options: SlotAllocatorOptions) {
    if (options.slotsPerPage < 1 || options.maxPages < 1) throw new Error("An atlas needs at least one slot and one page.");
    this.slotsPerPage = options.slotsPerPage;
    this.maxPages = options.maxPages;
  }

  get pageCount(): number {
    return this.pages;
  }

  get stats(): SlotAllocatorStats {
    return { pages: this.pages, used: this.entries.size, capacity: this.maxPages * this.slotsPerPage, evictions: this.evictions };
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): Slot | undefined {
    return this.entries.get(key)?.slot;
  }

  /** Marks the key as used in `frame`. Returns its slot, or undefined when it has none. */
  touch(key: K, frame: number): Slot | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.frame = frame;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.slot;
  }

  /**
   * A slot for `key`: its existing one, a free one, one on a new page, or one taken from the least recently
   * used entry that was not used in `frame`. Null when every slot is in use this frame.
   */
  acquire(key: K, frame: number): Slot | null {
    const existing = this.touch(key, frame);
    if (existing) return existing;

    let slot = this.free.pop();
    if (!slot && this.pages < this.maxPages) {
      this.addPage();
      slot = this.free.pop();
    }
    if (!slot) {
      for (const [victim, entry] of this.entries) {
        if (entry.frame >= frame) break; // everything after this was used at least as recently
        this.entries.delete(victim);
        this.evictions++;
        slot = entry.slot;
        this.onEvict?.(victim, entry.slot);
        break;
      }
    }
    if (!slot) return null;
    this.entries.set(key, { slot, frame });
    return slot;
  }

  release(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.free.push(entry.slot);
  }

  /** Forgets every entry and every page (after a lost GL context, when the textures are gone). */
  clear(): void {
    this.entries.clear();
    this.free = [];
    this.pages = 0;
  }

  private addPage(): void {
    const page = this.pages++;
    // Pushed in reverse so cells fill row by row from the top left.
    for (let index = this.slotsPerPage - 1; index >= 0; index--) this.free.push({ page, index });
  }
}

/** Where a slot sits in its page, in cells and in texture coordinates (0…1, v downward like the image). */
export function slotRect(slot: Slot, cellPx: number, pageSize: number): { x: number; y: number; u: number; v: number } {
  const columns = pageSize / cellPx;
  const x = (slot.index % columns) * cellPx;
  const y = Math.floor(slot.index / columns) * cellPx;
  return { x, y, u: x / pageSize, v: y / pageSize };
}
