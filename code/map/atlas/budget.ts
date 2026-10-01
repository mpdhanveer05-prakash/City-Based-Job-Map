// GPU memory budget for logo textures (map-spec §5). Pure.

export const PAGE_SIZE = 2048;
const MIB = 1024 * 1024;

/** Proposals from map-spec §5: about 64 MB of logo textures on a phone, 128 MB on a desktop. */
export const MOBILE_BUDGET_BYTES = 64 * MIB;
export const DESKTOP_BUDGET_BYTES = 128 * MIB;

/** RGBA8, no mipmaps: logos are drawn near their source size, so a mip chain would only add a third. */
export const pageBytes = (pageSize: number = PAGE_SIZE): number => pageSize * pageSize * 4;

export const defaultBudgetBytes = (coarsePointer: boolean): number => (coarsePointer ? MOBILE_BUDGET_BYTES : DESKTOP_BUDGET_BYTES);

/** Whole pages that fit the budget. Always at least one, so the atlas can work at all. */
export const maxPagesFor = (budgetBytes: number, pageSize: number = PAGE_SIZE): number =>
  Math.max(1, Math.floor(budgetBytes / pageBytes(pageSize)));

export const slotsPerPage = (cellPx: number, pageSize: number = PAGE_SIZE): number => (pageSize / cellPx) ** 2;
