/**
 * Minimal RFC 4180 CSV. No dependency added for nine lines of quoting.
 *
 * A field is quoted when it contains a comma, a quote, or a newline, and inner
 * quotes are doubled. A business called `Nile Barbers, Juba` would otherwise
 * split into two columns and silently shift every following value — in a
 * document someone reads amounts of money off.
 */
export function toCsvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map((field) => escapeCsv(field)).join(',');
}

function escapeCsv(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return '';
  const value = String(field);
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
