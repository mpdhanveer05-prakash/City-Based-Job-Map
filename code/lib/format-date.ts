// A date as "12 Sep 2026", in UTC, with fixed month names. toLocaleDateString gives "Sept" in some ICU versions and
// "Sep" in others, and a static page must read the same however it was built.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
