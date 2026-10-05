/**
 * Shown on every public page while the build holds synthetic sample data (CLAUDE.md hard rules:
 * "Synthetic data must be labelled synthetic"). A release build refuses sample data, so this never
 * reaches production.
 */
export function SampleDataNotice() {
  return (
    <p role="note" data-testid="sample-data-notice" className="bg-milky-shade px-4 py-2 text-sm text-foreground sm:px-6">
      Sample data. The companies, offices, and jobs on this site are synthetic. None of them is real.
    </p>
  );
}
