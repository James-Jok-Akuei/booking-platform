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

/**
 * A value that must survive being opened in a spreadsheet as TEXT (§65.2).
 *
 * `+211921000004` is a phone number. Excel sees a leading `+`, decides it is a
 * number, and renders `2.11921E+11` — so the one column the reader actually
 * needs becomes unreadable. Quoting does not help: Excel converts quoted
 * numeric-looking cells too.
 *
 * `="…"` is the escape hatch spreadsheets honour: a formula returning a string,
 * which Excel, Google Sheets and Numbers all display verbatim. It is ugly in a
 * text editor, and this file exists to be opened in a spreadsheet by a person
 * checking a payout against a statement — so that is the reader to optimise
 * for.
 *
 * A script consuming this strips a leading `="` and a trailing `"`. That is
 * documented here rather than discovered.
 */
export function csvTextCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `="${String(value).replace(/"/g, '""')}"`;
}
