/** One line of a usage export: a counter of one bot, one day and one metric. */
export interface UsageCsvRow {
  day: string;
  organizationId: string;
  /** Empty for a bot in no group. */
  groupId: string;
  botId: string;
  metric: string;
  count: number;
}

export const USAGE_CSV_COLUMNS = ["day", "organisation", "group", "bot", "metric", "count"] as const;

/** A month as YYYY-MM, January to December. */
export const USAGE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * RFC 4180: a field with a comma, a quote or a line break goes in quotes, its quotes doubled.
 * A field a spreadsheet would read as a formula gets a leading apostrophe.
 */
function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The export as CSV, header first, CRLF line ends. */
export function usageCsv(rows: UsageCsvRow[]): string {
  const lines = [USAGE_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([r.day, r.organizationId, r.groupId, r.botId, r.metric, String(r.count)].map(field).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
