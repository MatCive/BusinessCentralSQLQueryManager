// T-SQL functions that SQLite lacks, registered as SQLite user functions.
// Dates travel as ISO text: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS.mmm'.

const DATEPARTS = {
  year: 'year', yy: 'year', yyyy: 'year',
  quarter: 'quarter', qq: 'quarter', q: 'quarter',
  month: 'month', mm: 'month', m: 'month',
  dayofyear: 'dayofyear', dy: 'dayofyear', y: 'dayofyear',
  day: 'day', dd: 'day', d: 'day',
  week: 'week', wk: 'week', ww: 'week',
  weekday: 'weekday', dw: 'weekday',
  hour: 'hour', hh: 'hour',
  minute: 'minute', mi: 'minute', n: 'minute',
  second: 'second', ss: 'second', s: 'second',
  millisecond: 'millisecond', ms: 'millisecond',
};
const part = p => {
  const v = DATEPARTS[String(p).toLowerCase()];
  if (!v) throw new Error(`Unknown date part: ${p}`);
  return v;
};

function toDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (!m) throw new Error(`Not a date: ${s}`);
  const [, y, mo, d, h = 0, mi = 0, se = 0, ms = 0] = m;
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, +String(ms).padEnd(3, '0'))), hasTime: m[4] !== undefined };
}
const pad = (n, l = 2) => String(n).padStart(l, '0');
function formatDate(dt, withTime) {
  const s = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  return withTime ? `${s} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}.${pad(dt.getUTCMilliseconds(), 3)}` : s;
}

export function datePart(p, v) {
  const x = toDate(v); if (!x) return null;
  const d = x.date;
  switch (part(p)) {
    case 'year': return d.getUTCFullYear();
    case 'quarter': return Math.floor(d.getUTCMonth() / 3) + 1;
    case 'month': return d.getUTCMonth() + 1;
    case 'dayofyear': return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
    case 'day': return d.getUTCDate();
    case 'week': { // SQL Server default (DATEFIRST 7): week 1 contains Jan 1, weeks start on Sunday
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.floor((datePart('dayofyear', v) - 1 + jan1.getUTCDay()) / 7) + 1;
    }
    case 'weekday': return d.getUTCDay() + 1; // Sunday = 1
    case 'hour': return d.getUTCHours();
    case 'minute': return d.getUTCMinutes();
    case 'second': return d.getUTCSeconds();
    case 'millisecond': return d.getUTCMilliseconds();
  }
}

// SQL Server keeps the day of month and clamps it to the last day (Jan 31 + 1 month = Feb 28).
function addMonths(d, k) {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + k);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
}

export function dateAdd(p, n, v) {
  const x = toDate(v); if (!x || n == null) return null;
  const d = new Date(x.date); const k = Math.trunc(Number(n));
  switch (part(p)) {
    case 'year': addMonths(d, 12 * k); break;
    case 'quarter': addMonths(d, 3 * k); break;
    case 'month': addMonths(d, k); break;
    case 'dayofyear': case 'day': case 'weekday': d.setUTCDate(d.getUTCDate() + k); break;
    case 'week': d.setUTCDate(d.getUTCDate() + 7 * k); break;
    case 'hour': d.setUTCHours(d.getUTCHours() + k); break;
    case 'minute': d.setUTCMinutes(d.getUTCMinutes() + k); break;
    case 'second': d.setUTCSeconds(d.getUTCSeconds() + k); break;
    case 'millisecond': d.setUTCMilliseconds(d.getUTCMilliseconds() + k); break;
  }
  const timePart = ['hour', 'minute', 'second', 'millisecond'].includes(part(p));
  return formatDate(d, x.hasTime || timePart);
}

export function dateDiff(p, a, b) {
  const x = toDate(a), y = toDate(b); if (!x || !y) return null;
  const d1 = x.date, d2 = y.date;
  // SQL Server counts boundaries crossed, not elapsed intervals.
  const floorDiv = (t, unit) => Math.floor(t / unit);
  switch (part(p)) {
    case 'year': return d2.getUTCFullYear() - d1.getUTCFullYear();
    case 'quarter': return (d2.getUTCFullYear() * 4 + Math.floor(d2.getUTCMonth() / 3)) - (d1.getUTCFullYear() * 4 + Math.floor(d1.getUTCMonth() / 3));
    case 'month': return (d2.getUTCFullYear() * 12 + d2.getUTCMonth()) - (d1.getUTCFullYear() * 12 + d1.getUTCMonth());
    case 'dayofyear': case 'day': case 'weekday': return floorDiv(d2, 86400000) - floorDiv(d1, 86400000);
    case 'week': return floorDiv(+d2 + 4 * 86400000, 7 * 86400000) - floorDiv(+d1 + 4 * 86400000, 7 * 86400000);
    case 'hour': return floorDiv(d2, 3600000) - floorDiv(d1, 3600000);
    case 'minute': return floorDiv(d2, 60000) - floorDiv(d1, 60000);
    case 'second': return floorDiv(d2, 1000) - floorDiv(d1, 1000);
    case 'millisecond': return d2 - d1;
  }
}

/** T-SQL '+': strings concatenate, anything else adds as numbers; NULL propagates. */
export function plus(a, b) {
  if (a == null || b == null) return null;
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  const r = Number(a) + Number(b);
  if (Number.isNaN(r)) throw new Error(`Conversion failed when converting '${typeof a === 'string' ? a : b}' to a number.`);
  return r;
}

export function registerFunctions(db, now = () => new Date()) {
  const f = (name, impl) => db.create_function(name, impl);
  f('SQM_PLUS', plus);
  f('SQM_LEN', s => (s == null ? null : String(s).replace(/ +$/, '').length));
  f('SQM_LEFT', (s, n) => (s == null || n == null ? null : String(s).slice(0, Math.max(0, n))));
  f('SQM_RIGHT', (s, n) => (s == null || n == null ? null : n <= 0 ? '' : String(s).slice(-n)));
  f('SQM_CHARINDEX', (find, s) => (find == null || s == null ? null : String(s).toLowerCase().indexOf(String(find).toLowerCase()) + 1));
  f('SQM_GETDATE', () => formatDate(now(), true));
  f('SQM_YEAR', v => datePart('year', v));
  f('SQM_MONTH', v => datePart('month', v));
  f('SQM_DAY', v => datePart('day', v));
  f('SQM_DATEPART', datePart);
  f('SQM_DATEADD', dateAdd);
  f('SQM_DATEDIFF', dateDiff);
}
