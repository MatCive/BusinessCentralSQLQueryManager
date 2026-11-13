import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, splitTableKey } from '../src/analyzer.js';

const byKey = plan => Object.fromEntries(plan.tables.map(t => [t.key, t]));

test('single table: columns and TOP become LIMIT', () => {
  const p = analyze("SELECT TOP 10 [No.], Name FROM Customer WHERE [Country/Region Code] = 'IT' ORDER BY Name");
  assert.deepEqual(p.tables, [{ key: 'Customer', company: '', table: 'Customer', allColumns: false, columns: ['No.', 'Name', 'Country/Region Code'] }]);
  assert.match(p.sqliteSql, /LIMIT 10$/);
  assert.doesNotMatch(p.sqliteSql, /TOP/);
});

test('join: aliases resolve to tables, unqualified columns go to every table', () => {
  const p = analyze('SELECT c.Name, Amount FROM Customer c JOIN [Cust. Ledger Entry] e ON e.[Customer No.] = c.[No.]');
  const t = byKey(p);
  assert.deepEqual(t.Customer.columns.sort(), ['Amount', 'Name', 'No.']);
  assert.deepEqual(t['Cust. Ledger Entry'].columns.sort(), ['Amount', 'Customer No.']);
});

test('star selects all columns, COUNT(*) does not', () => {
  assert.equal(analyze('SELECT * FROM Customer').tables[0].allColumns, true);
  assert.equal(analyze('SELECT COUNT(*) FROM Customer').tables[0].allColumns, false);
  const t = byKey(analyze('SELECT c.*, v.Name FROM Customer c JOIN Vendor v ON v.Name = c.Name'));
  assert.equal(t.Customer.allColumns, true);
  assert.equal(t.Vendor.allColumns, false);
});

test('company prefix', () => {
  assert.deepEqual(splitTableKey('CRONUS S.p.A.$Customer'), { company: 'CRONUS S.p.A.', table: 'Customer' });
  assert.deepEqual(splitTableKey('Customer'), { company: '', table: 'Customer' });
  const p = analyze('SELECT a.Name FROM [CRONUS$Customer] a');
  assert.equal(p.tables[0].company, 'CRONUS');
  assert.match(p.sqliteSql, /FROM "CRONUS\$Customer"/);
});

test('same table written with different case is requested once', () => {
  const p = analyze('SELECT * FROM Customer WHERE [No.] IN (SELECT [No.] FROM customer)');
  assert.equal(p.tables.length, 1);
});

test('date part words are not requested as columns', () => {
  const p = analyze('SELECT DATEDIFF(day, [Posting Date], GETDATE()) FROM [G/L Entry]');
  assert.deepEqual(p.tables[0].columns, ['Posting Date']);
  assert.match(p.sqliteSql, /SQM_DATEDIFF\('day', "Posting Date", SQM_GETDATE\(\)\)/);
});

test('only one SELECT is accepted', () => {
  for (const q of ['DELETE FROM Customer', 'UPDATE Customer SET Name = 1', "INSERT INTO Customer ([No.]) VALUES ('X')", 'DROP TABLE Customer']) {
    assert.throws(() => analyze(q), /read-only|Syntax/, q);
  }
  assert.throws(() => analyze('SELECT 1 FROM Customer; SELECT 2 FROM Vendor'), /one statement/);
  assert.throws(() => analyze('   '), /Write a query/);
  assert.throws(() => analyze('SELEC * FROM Customer'), /Syntax error near line 1/);
});

test('T-SQL specifics are translated', () => {
  const s = analyze("SELECT LEFT(Name, 3), ISNULL(City, N'n/a'), LEN(Name), Name + ' ' + City FROM Customer WITH (NOLOCK)").sqliteSql;
  assert.match(s, /SQM_LEFT\("Name", 3\)/);
  assert.match(s, /IFNULL\("City", 'n\/a'\)/);
  assert.match(s, /SQM_LEN\("Name"\)/);
  assert.match(s, /SQM_PLUS\(SQM_PLUS\("Name", ' '\), "City"\)/);
  assert.doesNotMatch(s, /NOLOCK/);
  assert.throws(() => analyze('SELECT TOP 10 PERCENT * FROM Customer'), /PERCENT/);
});
