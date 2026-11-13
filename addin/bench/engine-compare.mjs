// Phase 0: compares alasql and sql.js (SQLite WASM) on correctness and speed.
// Usage: npm run bench [-- <rows of G/L Entry>]  (default 100000)
import sqlParser from 'node-sql-parser/build/transactsql.js';
const { Parser } = sqlParser;
import alasql from 'alasql';
import initSqlJs from 'sql.js';

const parser = new Parser();
const TSQL = { database: 'TransactSQL' };

// ---------- synthetic BC-like data ----------
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const r = rng(42);
const N_CUST = 5000, N_GL = Number(process.argv[2] || 100000);
const customers = Array.from({ length: N_CUST }, (_, i) => ({
  'No.': 'C' + String(i).padStart(5, '0'),
  Name: (i % 7 === 0 ? 'rossi ' : 'Cliente ') + i,
  'Country/Region Code': i % 3 === 0 ? 'IT' : i % 3 === 1 ? 'DE' : 'FR',
  Blocked: i % 10 === 0 ? 1 : 0,
}));
const accounts = ['6110', '6120', '6210', '7010', '7020', '1010', '2410', '4410'];
const gl = Array.from({ length: N_GL }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(r() * 730) * 86400000);
  return {
    'Entry No.': i + 1,
    'G/L Account No.': accounts[Math.floor(r() * accounts.length)],
    'Posting Date': d.toISOString().slice(0, 10),
    Amount: Math.round((r() * 20000 - 10000)) / 100,
    'Source No.': r() < 0.6 ? customers[Math.floor(r() * (N_CUST - 500))]['No.'] : null,
    Description: 'Movimento ' + i,
  };
});
const tables = {
  Customer: { rows: customers, cols: { 'No.': 'text', Name: 'text', 'Country/Region Code': 'text', Blocked: 'int' } },
  'G/L Entry': { rows: gl, cols: { 'Entry No.': 'int', 'G/L Account No.': 'text', 'Posting Date': 'date', Amount: 'dec', 'Source No.': 'text', Description: 'text' } },
};

const queries = {
  top_order: "SELECT TOP 5 [Entry No.], Amount FROM [G/L Entry] ORDER BY Amount DESC, [Entry No.]",
  group_having: "SELECT [G/L Account No.], COUNT(*) AS N, ROUND(SUM(Amount),2) AS Tot FROM [G/L Entry] GROUP BY [G/L Account No.] HAVING COUNT(*) > 100 ORDER BY [G/L Account No.]",
  join_group: "SELECT TOP 5 c.[No.], c.Name, COUNT(*) AS N FROM Customer c JOIN [G/L Entry] g ON g.[Source No.] = c.[No.] GROUP BY c.[No.], c.Name ORDER BY N DESC, c.[No.]",
  left_join_null: "SELECT COUNT(*) AS SenzaMovimenti FROM Customer c LEFT JOIN [G/L Entry] g ON g.[Source No.] = c.[No.] WHERE g.[Entry No.] IS NULL",
  subquery_in: "SELECT COUNT(*) AS N FROM Customer WHERE [No.] IN (SELECT [Source No.] FROM [G/L Entry] WHERE Amount > 99)",
  case_insensitive: "SELECT COUNT(*) AS N FROM Customer WHERE [Country/Region Code] = 'it'",
  like_ci: "SELECT COUNT(*) AS N FROM Customer WHERE Name LIKE 'ROSSI%'",
  count_nulls: "SELECT COUNT(*) AS Tutti, COUNT([Source No.]) AS ConCliente FROM [G/L Entry]",
  int_division: "SELECT TOP 1 7/2 AS Div FROM Customer",
  case_expr: "SELECT TOP 3 [No.], CASE WHEN Blocked = 1 THEN 'Bloccato' ELSE 'Attivo' END AS Stato FROM Customer ORDER BY [No.]",
  isnull_fn: "SELECT COUNT(*) AS N FROM [G/L Entry] WHERE ISNULL([Source No.], '') = ''",
  year_fn: "SELECT YEAR([Posting Date]) AS Anno, COUNT(*) AS N FROM [G/L Entry] GROUP BY YEAR([Posting Date]) ORDER BY Anno",
  distinct: "SELECT COUNT(*) AS N FROM (SELECT DISTINCT [G/L Account No.] FROM [G/L Entry]) x",
  between_dates: "SELECT COUNT(*) AS N FROM [G/L Entry] WHERE [Posting Date] BETWEEN '2025-01-01' AND '2025-01-31'",
  full_join: "SELECT COUNT(*) AS N FROM (SELECT TOP 10 [No.] FROM Customer ORDER BY [No.]) a FULL OUTER JOIN (SELECT DISTINCT [Source No.] AS S FROM [G/L Entry] WHERE [Source No.] < 'C00005') b ON b.S = a.[No.]",
};

// ---------- reference answers computed in plain JS ----------
const isIT = c => c['Country/Region Code'].toLowerCase() === 'it';
const glByCust = new Map(); gl.forEach(g => g['Source No.'] && glByCust.set(g['Source No.'], (glByCust.get(g['Source No.']) || 0) + 1));
const expected = {
  case_insensitive: customers.filter(isIT).length,
  like_ci: customers.filter(c => c.Name.toLowerCase().startsWith('rossi')).length,
  left_join_null: customers.filter(c => !glByCust.has(c['No.'])).length,
  count_nulls: [gl.length, gl.filter(g => g['Source No.'] !== null).length],
  int_division: 3,
  isnull_fn: gl.filter(g => g['Source No.'] === null).length,
};

// ---------- engine 1: alasql (runs T-SQL text) ----------
function loadAlasql() {
  const db = new alasql.Database();
  for (const [name, t] of Object.entries(tables)) {
    db.exec(`CREATE TABLE [${name}]`);
    db.tables[name].data = t.rows;
  }
  return db;
}

// ---------- engine 2: SQLite via AST translation ----------
const FN_RENAME = { ISNULL: 'IFNULL', LEN: 'LENGTH', GETDATE: 'SQM_GETDATE' };
function translate(node) {
  if (Array.isArray(node)) return node.forEach(translate);
  if (!node || typeof node !== 'object') return;
  if (node.type === 'select' && node.top) {
    node.limit = { seperator: '', value: [{ type: 'number', value: node.top.value }] };
    node.top = null;
  }
  if (node.type === 'function' && node.name?.name?.[0]) {
    const n = node.name.name[0].value.toUpperCase();
    if (FN_RENAME[n]) node.name.name[0].value = FN_RENAME[n];
  }
  for (const k of Object.keys(node)) translate(node[k]);
}
function toSqlite(sql) {
  const ast = parser.astify(sql, TSQL);
  translate(ast);
  return parser.sqlify(ast, { database: 'sqlite' });
}
const SQLTYPE = { text: 'TEXT COLLATE NOCASE', int: 'INTEGER', dec: 'NUMERIC', date: 'TEXT' };
async function loadSqlite() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.create_function('YEAR', d => d == null ? null : Number(String(d).slice(0, 4)));
  db.create_function('MONTH', d => d == null ? null : Number(String(d).slice(5, 7)));
  db.create_function('DAY', d => d == null ? null : Number(String(d).slice(8, 10)));
  for (const [name, t] of Object.entries(tables)) {
    const cols = Object.keys(t.cols);
    db.run(`CREATE TABLE "${name}" (${cols.map(c => `"${c}" ${SQLTYPE[t.cols[c]]}`).join(', ')})`);
    const stmt = db.prepare(`INSERT INTO "${name}" VALUES (${cols.map(() => '?').join(',')})`);
    db.run('BEGIN');
    for (const row of t.rows) stmt.run(cols.map(c => row[c]));
    db.run('COMMIT');
    stmt.free();
  }
  return db;
}
function runSqlite(db, sql) {
  const res = db.exec(toSqlite(sql));
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

// ---------- run ----------
const ms = t0 => (performance.now() - t0).toFixed(1);
let t0 = performance.now(); const adb = loadAlasql(); const aLoad = ms(t0);
t0 = performance.now(); const sdb = await loadSqlite(); const sLoad = ms(t0);
console.log(`righe: Customer ${N_CUST}, G/L Entry ${N_GL}`);
console.log(`caricamento  alasql ${aLoad} ms | sqlite ${sLoad} ms`);
const firstVals = rows => rows.length === 1 ? Object.values(rows[0]) : rows;
const fmt = v => JSON.stringify(v).slice(0, 90);
for (const [k, q] of Object.entries(queries)) {
  let a, s, ta, ts;
  try { t0 = performance.now(); a = adb.exec(q); ta = ms(t0); } catch (e) { a = 'ERR ' + e.message.slice(0, 60); ta = '-'; }
  try { t0 = performance.now(); s = runSqlite(sdb, q); ts = ms(t0); } catch (e) { s = 'ERR ' + e.message.slice(0, 60); ts = '-'; }
  const exp = expected[k];
  const chk = v => exp === undefined ? '' : (JSON.stringify(firstVals(v)) === JSON.stringify([exp].flat()) ? ' OK' : ' SBAGLIATO');
  const same = JSON.stringify(a) === JSON.stringify(s) ? '=' : '≠';
  console.log(`\n${k} ${same}`);
  console.log(`  alasql ${ta.padStart(7)} ms${chk(a)}  ${fmt(a)}`);
  console.log(`  sqlite ${ts.padStart(7)} ms${chk(s)}  ${fmt(s)}`);
  if (exp !== undefined) console.log(`  atteso ${fmt(exp)}`);
}
