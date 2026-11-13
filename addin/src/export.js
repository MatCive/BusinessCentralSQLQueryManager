// Text exports of a query result.

const csvCell = (v, sep) => {
  if (v == null) return '';
  const s = String(v);
  return s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv({ columns, rows }, sep = ';') {
  const lines = [columns.map(c => csvCell(c, sep)).join(sep)];
  for (const r of rows) lines.push(r.map(v => csvCell(v, sep)).join(sep));
  return lines.join('\r\n');
}

/** Tab-separated text: pastes straight into Excel cells. */
export function toTsv({ columns, rows }) {
  const cell = v => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
  return [columns.map(cell).join('\t'), ...rows.map(r => r.map(cell).join('\t'))].join('\r\n');
}
