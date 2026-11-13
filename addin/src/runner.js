// Coordinates one query run: analysis, data requests to AL, loading into SQLite, execution.
// Independent from the DOM and from Business Central so it can be tested in Node.
import { analyze } from './analyzer.js';
import { t } from './i18n.js';

export class QueryRunner {
  /**
   * @param engine   SqliteEngine
   * @param requestData (requestJson: string) => void  asks AL for the tables
   */
  constructor(engine, requestData) {
    this.engine = engine;
    this.requestData = requestData;
    this.pending = null;
  }

  /** Starts a run. Returns the request sent to AL. */
  start(sql, rowLimit) {
    const plan = analyze(sql);
    this.engine.reset();
    this.pending = {
      plan,
      rowLimit: Math.max(1, Number(rowLimit) || 1000),
      created: new Set(),
      warnings: [],
      readMs: 0,
      loadMs: 0,
      startedAt: now(),
    };
    const request = {
      tables: plan.tables.map(({ key, company, table, allColumns, columns }) => ({ key, company, table, allColumns, columns })),
    };
    this.requestData(JSON.stringify(request));
    return request;
  }

  /** Receives one chunk of table data from AL. */
  receiveTable(chunkJson) {
    const p = this.pending;
    if (!p) return;
    const chunk = typeof chunkJson === 'string' ? JSON.parse(chunkJson) : chunkJson;
    const t0 = now();
    if (!p.created.has(chunk.key.toLowerCase())) {
      this.engine.createTable(chunk.key, chunk.columns);
      p.created.add(chunk.key.toLowerCase());
    }
    this.engine.insertRows(chunk.key, chunk.rows);
    p.loadMs += now() - t0;
    if (chunk.last) {
      p.readMs += chunk.readMs || 0;
      if (chunk.truncated) p.warnings.push(t('sourceTruncated', { table: chunk.key, count: chunk.rowCount }));
    }
  }

  /** All tables received: run the query. */
  complete() {
    const p = this.pending;
    this.pending = null;
    if (!p) return null;
    const t0 = now();
    const result = this.engine.query(p.plan.sqliteSql, p.rowLimit);
    const execMs = now() - t0;
    return {
      ...result,
      warnings: p.warnings,
      stats: { readMs: Math.round(p.readMs), loadMs: Math.round(p.loadMs), execMs: Math.round(execMs), totalMs: Math.round(now() - p.startedAt) },
    };
  }

  cancel() { this.pending = null; }
}

const now = () => (globalThis.performance ? performance.now() : Date.now());
