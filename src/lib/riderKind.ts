/**
 * How the app names the person signed in. Everyone is the shop's own staff,
 * on salary: the app has no third-party riders and shows no pay, only counts.
 * The words follow the lines the office set them to work in.
 */
export function staffLabel(lines: readonly string[]): string {
  if (lines.length > 1) return 'Office staff';
  if (lines[0] === 'service') return 'Office technician';
  return 'Office rider';
}
