// In-memory SQLite database (sql.js, WebAssembly) that holds the BC tables of one query.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { registerFunctions } from './functions.js';

// BC column type (as sent by AL) -> SQLite column definition.
// Text uses NOCASE so '=' and ORDER BY ignore case, as the BC database collation does.
// Decimals are REAL so that Amount / 2 is not an integer division.
const SQLITE_TYPE = {
  text: 'TEXT COLLATE NOCASE',
  int: 'INTEGER',
  bool: 'INTEGER',
  dec: 'REAL',
  date: 'TEXT',
  datetime: 'TEXT',
  time: 'TEXT',
  guid: 'TEXT COLLATE NOCASE',
};
const q = name => `"${String(name).replace(/"/g, '""')}"`;

export class SqliteEngine {
  static async create(wasmBinary) {
    const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : undefined);
    return new SqliteEngine(SQL);
  }

  constructor(SQL) {
    this.SQL = SQL;
    this.db = null;
    this.reset();
  }

  get version() {
    return this.db.exec('SELECT sqlite_version()')[0].values[0][0];
  }

  reset() {
    if (this.db) this.db.close();
    this.db = new this.SQL.Database();
    registerFunctions(this.db);
    this.columns = new Map();
  }

  /** @param columns Array<{name, type}> */
  createTable(name, columns) {
    // A query like SELECT COUNT(*) needs no column, but SQLite tables need at least one.
    if (!columns.length) columns = [{ name: '__sqm_row', type: 'int', placeholder: true }];
    const defs = columns.map(c => `${q(c.name)} ${SQLITE_TYPE[c.type] || 'TEXT'}`);
    this.db.run(`CREATE TABLE ${q(name)} (${defs.join(', ')})`);
    this.columns.set(name.toLowerCase(), columns);
  }

  /** @param rows Array<Array<value>> in the column order given to createTable */
  insertRows(name, rows) {
    if (!rows.length) return;
    const cols = this.columns.get(name.toLowerCase());
    const placeholder = cols.length === 1 && cols[0].placeholder;
    const stmt = this.db.prepare(`INSERT INTO ${q(name)} VALUES (${cols.map(() => '?').join(',')})`);
    this.db.run('BEGIN');
    try {
      for (const row of rows) stmt.run(placeholder ? [null] : row);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    } finally {
      stmt.free();
    }
  }

  /** Runs a SQLite SELECT and returns at most rowLimit rows. */
  query(sql, rowLimit = 1000) {
    const stmt = this.db.prepare(sql);
    try {
      const columns = stmt.getColumnNames();
      const rows = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= rowLimit) { truncated = true; break; }
        rows.push(stmt.get());
      }
      return { columns, rows, truncated };
    } finally {
      stmt.free();
    }
  }
}
