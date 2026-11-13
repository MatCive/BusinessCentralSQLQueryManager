// Parses a T-SQL query, checks it is a single read-only SELECT, finds the BC tables and
// columns it needs, and translates it to the SQLite dialect run by the engine.
import sqlParser from 'node-sql-parser/build/transactsql.js';
const { Parser } = sqlParser;
import { SqmError } from './errors.js';

const parser = new Parser();
const TSQL = { database: 'TransactSQL' };

// T-SQL functions mapped to SQLite built-ins or to SQM_* functions registered in functions.js.
const FUNCTION_MAP = {
  ISNULL: 'IFNULL',
  SUBSTRING: 'SUBSTR',
  LEN: 'SQM_LEN',
  LEFT: 'SQM_LEFT',
  RIGHT: 'SQM_RIGHT',
  CHARINDEX: 'SQM_CHARINDEX',
  GETDATE: 'SQM_GETDATE',
  YEAR: 'SQM_YEAR',
  MONTH: 'SQM_MONTH',
  DAY: 'SQM_DAY',
  DATEADD: 'SQM_DATEADD',
  DATEDIFF: 'SQM_DATEDIFF',
  DATEPART: 'SQM_DATEPART',
};
// Functions whose first argument is a date part keyword (day, month, ...), not a column.
const DATEPART_FUNCTIONS = new Set(['DATEADD', 'DATEDIFF', 'DATEPART']);

export function splitTableKey(key) {
  const i = key.lastIndexOf('$');
  return i > 0 ? { company: key.slice(0, i), table: key.slice(i + 1) } : { company: '', table: key };
}

function parse(sql) {
  if (!sql || !sql.trim()) throw new SqmError('emptyQuery');
  try {
    return parser.astify(sql, TSQL);
  } catch (e) {
    const loc = e.location?.start;
    throw new SqmError('syntaxError', { line: loc?.line ?? '?', column: loc?.column ?? '?' });
  }
}

function assertSingleSelect(ast) {
  const statements = Array.isArray(ast) ? ast.filter(Boolean) : [ast];
  if (statements.length !== 1) throw new SqmError('singleStatement');
  const st = statements[0];
  if (st.type !== 'select') throw new SqmError('readOnly', { statement: String(st.type).toUpperCase() });
  if (st.into?.expr || st.into?.type) throw new SqmError('readOnly', { statement: 'SELECT INTO' });
  return st;
}

// Collect the date-part arguments so they are not mistaken for column names.
function collectDatepartWords(node, out = new Set()) {
  if (Array.isArray(node)) { node.forEach(n => collectDatepartWords(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'function') {
    const name = node.name?.name?.[0]?.value?.toUpperCase();
    const first = node.args?.value?.[0];
    if (DATEPART_FUNCTIONS.has(name) && first?.type === 'column_ref' && !first.table) out.add(String(first.column).toLowerCase());
  }
  for (const k of Object.keys(node)) collectDatepartWords(node[k], out);
  return out;
}

/** Tables and columns the query needs, keyed by table name as written (e.g. "CRONUS$Customer"). */
function collectTables(sql, ast) {
  const tables = new Map(); // lower-case key -> entry
  for (const item of parser.tableList(sql, TSQL)) {
    const [, , name] = item.split('::');
    const lk = name.toLowerCase();
    if (!tables.has(lk)) tables.set(lk, { key: name, ...splitTableKey(name), allColumns: false, columns: new Set() });
  }
  if (tables.size === 0) throw new SqmError('noTable');
  const dateparts = collectDatepartWords(ast);
  for (const item of parser.columnList(sql, TSQL)) {
    const [, table, column] = item.split('::');
    const targets = table === 'null' ? [...tables.values()] : [tables.get(table.toLowerCase())].filter(Boolean);
    if (column === '(.*)') { targets.forEach(t => (t.allColumns = true)); continue; }
    if (table === 'null' && dateparts.has(column.toLowerCase())) continue;
    targets.forEach(t => t.columns.add(column));
  }
  return [...tables.values()].map(t => ({ ...t, columns: [...t.columns] }));
}

const fn = (name, args) => ({ type: 'function', name: { name: [{ type: 'default', value: name }] }, args: { type: 'expr_list', value: args }, over: null });

function translate(node) {
  if (Array.isArray(node)) { node.forEach(translate); return; }
  if (!node || typeof node !== 'object') return;
  // Children first, so replacements below see already-translated sub-trees.
  for (const k of Object.keys(node)) translate(node[k]);

  if (node.type === 'select' && node.top) {
    if (node.top.percent) throw new SqmError('unsupported', { feature: 'TOP ... PERCENT' });
    node.limit = { seperator: '', value: [{ type: 'number', value: node.top.value }] };
    node.top = null;
  }
  if (node.table_hint) node.table_hint = null; // WITH (NOLOCK) and similar: meaningless here
  if (node.type === 'var_string') node.type = 'single_quote_string'; // N'text'
  if (node.type === 'function') {
    const name = node.name?.name?.[0]?.value?.toUpperCase();
    if (DATEPART_FUNCTIONS.has(name)) {
      const first = node.args?.value?.[0];
      if (first?.type === 'column_ref') node.args.value[0] = { type: 'single_quote_string', value: String(first.column) };
    }
    if (FUNCTION_MAP[name]) node.name.name[0].value = FUNCTION_MAP[name];
  }
  // T-SQL '+' concatenates strings and adds numbers: decided at run time by SQM_PLUS.
  if (node.type === 'binary_expr' && node.operator === '+') {
    const replacement = fn('SQM_PLUS', [node.left, node.right]);
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, replacement);
  }
}

/**
 * @returns {{ sqliteSql: string, tables: Array<{key, company, table, allColumns, columns}> }}
 */
export function analyze(sql) {
  const ast = assertSingleSelect(parse(sql));
  const tables = collectTables(sql, ast);
  translate(ast);
  let sqliteSql;
  try {
    sqliteSql = parser.sqlify(ast, { database: 'sqlite' });
  } catch (e) {
    throw new SqmError('unsupported', { feature: e.message });
  }
  return { sqliteSql, tables };
}
