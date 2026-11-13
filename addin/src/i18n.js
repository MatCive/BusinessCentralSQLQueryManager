// UI texts of the control add-in. English is the base language; Italian is selected
// when Business Central runs in Italian (LCID 1040).
const MESSAGES = {
  en: {
    emptyQuery: 'Write a query first.',
    syntaxError: 'Syntax error near line {line}, column {column}.',
    singleStatement: 'Only one statement at a time is supported.',
    readOnly: '{statement} is not allowed: SQM is read-only and runs SELECT statements only.',
    noTable: 'The query does not read any table.',
    unsupported: 'Not supported yet: {feature}',
    run: 'Run',
    running: 'Running…',
    readingData: 'Reading data from Business Central…',
    rows: '{count} rows',
    rowsTruncated: 'first {count} rows shown (row limit reached)',
    sourceTruncated: 'Table {table}: only the first {count} rows were read (limit per table). Results may be incomplete.',
    timing: 'BC read {read} ms · load {load} ms · query {exec} ms',
    engineReady: 'SQLite {version} ready',
    engineFailed: 'The SQL engine could not start: {error}',
    copy: 'Copy',
    downloadCsv: 'CSV',
    copied: 'Copied to clipboard.',
    copyFailed: 'Copy to clipboard is not allowed here: {error}',
    downloadFailed: 'Download is not allowed here: {error}',
    noResult: 'Run a query to see results.',
    placeholder: 'SELECT TOP 100 [No.], Name FROM Customer ORDER BY Name',
  },
  it: {
    emptyQuery: 'Scrivi prima una query.',
    syntaxError: 'Errore di sintassi vicino a riga {line}, colonna {column}.',
    singleStatement: 'È supportata una sola istruzione alla volta.',
    readOnly: '{statement} non è consentito: SQM è in sola lettura ed esegue solo istruzioni SELECT.',
    noTable: 'La query non legge nessuna tabella.',
    unsupported: 'Non ancora supportato: {feature}',
    run: 'Esegui',
    running: 'Esecuzione…',
    readingData: 'Lettura dei dati da Business Central…',
    rows: '{count} righe',
    rowsTruncated: 'mostrate le prime {count} righe (limite raggiunto)',
    sourceTruncated: 'Tabella {table}: lette solo le prime {count} righe (limite per tabella). Il risultato può essere incompleto.',
    timing: 'lettura BC {read} ms · caricamento {load} ms · query {exec} ms',
    engineReady: 'SQLite {version} pronto',
    engineFailed: 'Il motore SQL non è partito: {error}',
    copy: 'Copia',
    downloadCsv: 'CSV',
    copied: 'Copiato negli appunti.',
    copyFailed: 'La copia negli appunti non è consentita qui: {error}',
    downloadFailed: 'Il download non è consentito qui: {error}',
    noResult: 'Esegui una query per vedere i risultati.',
    placeholder: 'SELECT TOP 100 [No.], Name FROM Customer ORDER BY Name',
  },
};

let lang = 'en';
export function setLanguageId(lcid) { lang = Number(lcid) === 1040 ? 'it' : 'en'; }
export function t(key, params = {}) {
  const text = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, p) => (p in params ? String(params[p]) : `{${p}}`));
}
