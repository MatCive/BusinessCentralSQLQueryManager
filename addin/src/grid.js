// Plain HTML result grid. Phase 4 replaces it with a sortable, virtualised grid.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function formatValue(v) {
  if (v == null) return '<span class="sqm-null">NULL</span>';
  if (typeof v === 'number' && !Number.isInteger(v)) return esc(String(Math.round(v * 1e5) / 1e5)); // hide float noise
  return esc(v);
}

export function renderGrid(container, { columns, rows }) {
  const head = `<tr><th class="sqm-rownum"></th>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) =>
    `<tr><td class="sqm-rownum">${i + 1}</td>${r.map(v => `<td class="${typeof v === 'number' ? 'sqm-num' : ''}">${formatValue(v)}</td>`).join('')}</tr>`
  ).join('');
  container.innerHTML = `<table class="sqm-grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
