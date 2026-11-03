/**
 * Install counts in the hub render as one-decimal thousands once the value
 * rounds to 1.0K: `950 → 1K`, `1050 → 1.1K`, `1280 → 1.3K`, `949 → 949`.
 *
 * The switch is at 950 rather than 1000 on purpose — 950 rounds up to 1K, so
 * a column that only abbreviated above 1000 would mix "949" with "1K" while
 * hiding the fact that both are the same magnitude. Rounding is half-up on
 * the exact decimal (Math.round on tenths), and a trailing ".0" is dropped so
 * a round thousand never reads "1.0K".
 */
export function formatInstallCount(n: number): string {
  const tenths = Math.round(n / 100);
  if (tenths < 10) return String(n);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? `${whole}K` : `${whole}.${frac}K`;
}
