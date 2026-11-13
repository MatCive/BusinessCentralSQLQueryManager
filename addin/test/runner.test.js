// End-to-end in Node: analysis, simulated AL data chunks, SQLite execution.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEngine } from '../src/engine.js';
import { QueryRunner } from '../src/runner.js';

const customer = {
  key: 'Customer',
  columns: [{ name: 'No.', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Country/Region Code', type: 'text' }, { name: 'Blocked', type: 'int' }],
  rows: [['C1', 'Rossi', 'IT', 0], ['C2', 'Bianchi', 'IT', 2], ['C3', 'Smith', 'GB', 0], ['C4', null, 'DE', 0]],
};
const entries = {
  key: 'Cust. Ledger Entry',
  columns: [{ name: 'Entry No.', type: 'int' }, { name: 'Customer No.', type: 'text' }, { name: 'Posting Date', type: 'date' }, { name: 'Amount', type: 'dec' }],
  rows: [[1, 'C1', '2025-01-10', 100], [2, 'C1', '2025-02-10', 50.5], [3, 'C2', '2025-02-11', 5], [4, 'C9', '2024-12-31', -20]],
};

let engine;
before(async () => { engine = await SqliteEngine.create(); });

function run(sql, { rowLimit = 1000, tables = [customer, entries], chunkSize = 2, truncate = {} } = {}) {
  let request;
  const runner = new QueryRunner(engine, json => (request = JSON.parse(json)));
  runner.start(sql, rowLimit);
  for (const req of request.tables) {
    const src = tables.find(t => t.key.toLowerCase() === req.table.toLowerCase());
    for (let i = 0; i < src.rows.length || i === 0; i += chunkSize) {
      const last = i + chunkSize >= src.rows.length;
      runner.receiveTable({ key: req.key, columns: src.columns, rows: src.rows.slice(i, i + chunkSize), last, truncated: last && !!truncate[req.key], rowCount: src.rows.length, readMs: 7 });
    }
  }
  return { request, ...runner.complete() };
}

test('simple select with row limit', () => {
  const r = run('SELECT [No.], Name FROM Customer ORDER BY [No.]', { rowLimit: 2 });
  assert.deepEqual(r.columns, ['No.', 'Name']);
  assert.deepEqual(r.rows, [['C1', 'Rossi'], ['C2', 'Bianchi']]);
  assert.equal(r.truncated, true);
  assert.equal(r.stats.readMs, 7);
});

test('text comparison ignores case like the BC collation', () => {
  assert.deepEqual(run("SELECT COUNT(*) AS N FROM Customer WHERE [Country/Region Code] = 'it'").rows, [[2]]);
});

test('join, group by, having, order by', () => {
  const r = run(`SELECT c.[No.], c.Name, COUNT(*) AS N, SUM(e.Amount) AS Tot
                 FROM Customer c JOIN [Cust. Ledger Entry] e ON e.[Customer No.] = c.[No.]
                 GROUP BY c.[No.], c.Name HAVING SUM(e.Amount) > 10 ORDER BY Tot DESC`);
  assert.deepEqual(r.rows, [['C1', 'Rossi', 2, 150.5]]);
});

test('left, right and full outer joins', () => {
  assert.deepEqual(run('SELECT COUNT(*) FROM Customer c LEFT JOIN [Cust. Ledger Entry] e ON e.[Customer No.] = c.[No.] WHERE e.[Entry No.] IS NULL').rows, [[2]]);
  assert.deepEqual(run('SELECT e.[Entry No.] FROM Customer c RIGHT JOIN [Cust. Ledger Entry] e ON e.[Customer No.] = c.[No.] WHERE c.[No.] IS NULL').rows, [[4]]);
  assert.deepEqual(run('SELECT COUNT(*) FROM Customer c FULL OUTER JOIN [Cust. Ledger Entry] e ON e.[Customer No.] = c.[No.]').rows, [[6]]);
});

test('CASE, subquery, DISTINCT, TOP', () => {
  assert.deepEqual(run("SELECT TOP 2 [No.], CASE WHEN Blocked = 0 THEN 'Attivo' ELSE 'Bloccato' END FROM Customer ORDER BY [No.] DESC").rows, [['C4', 'Attivo'], ['C3', 'Attivo']]);
  assert.deepEqual(run('SELECT Name FROM Customer WHERE [No.] IN (SELECT [Customer No.] FROM [Cust. Ledger Entry] WHERE Amount < 10)').rows, [['Bianchi']]);
  assert.deepEqual(run('SELECT DISTINCT [Country/Region Code] FROM Customer ORDER BY 1').rows, [['DE'], ['GB'], ['IT']]);
});

test('T-SQL functions and semantics', () => {
  const r = run(`SELECT TOP 1 ISNULL(Name, '?') + ' (' + [No.] + ')', LEN('ab  '), LEFT(Name, 2), RIGHT(Name, 2), 7 / 2, CHARINDEX('S', Name)
                 FROM Customer WHERE [No.] = 'C1'`);
  assert.deepEqual(r.rows, [['Rossi (C1)', 2, 'Ro', 'si', 3, 3]]);
  assert.deepEqual(run("SELECT Amount / 2 FROM [Cust. Ledger Entry] WHERE [Entry No.] = 3").rows, [[2.5]]);
  assert.deepEqual(run(`SELECT YEAR([Posting Date]) AS Anno, COUNT(*) FROM [Cust. Ledger Entry] GROUP BY YEAR([Posting Date]) ORDER BY Anno`).rows, [[2024, 1], [2025, 3]]);
  assert.deepEqual(run(`SELECT DATEADD(month, 1, [Posting Date]) FROM [Cust. Ledger Entry] WHERE [Entry No.] = 1`).rows, [['2025-02-10']]);
  assert.deepEqual(run(`SELECT COUNT(*) FROM [Cust. Ledger Entry] WHERE [Posting Date] BETWEEN '2025-01-01' AND '2025-01-31'`).rows, [[1]]);
  assert.deepEqual(run("SELECT COUNT(*), COUNT(Name) FROM Customer").rows, [[4, 3]]);
});

test('warning when a source table was cut by the per-table limit', () => {
  const r = run('SELECT COUNT(*) FROM Customer', { truncate: { Customer: true } });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Customer/);
});

test('request sent to AL lists tables, company and columns', () => {
  const { request } = run('SELECT c.Name FROM Customer c');
  assert.deepEqual(request, { tables: [{ key: 'Customer', company: '', table: 'Customer', allColumns: false, columns: ['Name'] }] });
});

test('empty table still creates the table', () => {
  const r = run('SELECT COUNT(*) FROM Customer', { tables: [{ ...customer, rows: [] }] });
  assert.deepEqual(r.rows, [[0]]);
});

test('COUNT(*) with no columns requested', () => {
  const noCols = { key: 'Customer', columns: [], rows: [[], [], []] };
  const r = run('SELECT COUNT(*) AS N FROM Customer', { tables: [noCols] });
  assert.deepEqual(r.request.tables[0].columns, []);
  assert.deepEqual(r.rows, [[3]]);
});
