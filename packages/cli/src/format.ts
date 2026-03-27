/** Render rows as a plain-text table with right-padded columns and a header separator. */
export function table(rows: string[][], headers: string[]): string {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, ci) =>
    Math.max(...allRows.map((r) => (r[ci] ?? '').length)),
  );

  return allRows
    .map((row, ri) => {
      const line = row.map((cell, ci) => (cell ?? '').padEnd(widths[ci] ?? 0)).join('  ');
      return ri === 0 ? line + '\n' + widths.map((w) => '-'.repeat(w)).join('  ') : line;
    })
    .join('\n');
}

/** Format an ISO timestamp as a relative time string, e.g. "2m ago" or "now". */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 5_000) return 'now';
  const secs = Math.floor(diffMs / 1_000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
