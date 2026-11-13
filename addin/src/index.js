// Entry point of the control add-in "SQM Query Editor".
// Business Central calls the global functions defined at the bottom (one per AL procedure)
// and receives events through Microsoft.Dynamics.NAV.InvokeExtensibilityMethod.
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import { SqliteEngine } from './engine.js';
import { QueryRunner } from './runner.js';
import { renderGrid } from './grid.js';
import { toCsv, toTsv } from './export.js';
import { setLanguageId, t } from './i18n.js';

const state = { engine: null, runner: null, rowLimit: 1000, lastResult: null, info: null, ui: {} };

function raise(event, ...args) {
  const nav = globalThis.Microsoft?.Dynamics?.NAV;
  if (nav) nav.InvokeExtensibilityMethod(event, args);
  else console.log('[SQM event]', event, args);
}

function buildUi() {
  const root = document.getElementById('controlAddIn') || document.body;
  root.innerHTML = `
    <div class="sqm">
      <div class="sqm-toolbar">
        <button type="button" class="sqm-run"></button>
        <span class="sqm-engine"></span>
        <span class="sqm-spacer"></span>
        <button type="button" class="sqm-copy"></button>
        <button type="button" class="sqm-csv"></button>
      </div>
      <textarea class="sqm-editor" spellcheck="false" autocomplete="off"></textarea>
      <div class="sqm-status"></div>
      <div class="sqm-messages"></div>
      <div class="sqm-result"></div>
    </div>`;
  const $ = s => root.querySelector(s);
  state.ui = { run: $('.sqm-run'), engine: $('.sqm-engine'), copy: $('.sqm-copy'), csv: $('.sqm-csv'), editor: $('.sqm-editor'), status: $('.sqm-status'), messages: $('.sqm-messages'), result: $('.sqm-result') };
  applyTexts();
  state.ui.run.addEventListener('click', () => raise('RunRequested'));
  state.ui.editor.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); raise('RunRequested'); }
    if (e.key === 'Tab') { // insert spaces instead of leaving the editor
      e.preventDefault();
      const ed = state.ui.editor, s = ed.selectionStart;
      ed.value = ed.value.slice(0, s) + '    ' + ed.value.slice(ed.selectionEnd);
      ed.selectionStart = ed.selectionEnd = s + 4;
    }
  });
  state.ui.copy.addEventListener('click', copyResult);
  state.ui.csv.addEventListener('click', downloadCsv);
}

function applyTexts() {
  const u = state.ui;
  u.run.textContent = t('run');
  u.copy.textContent = t('copy');
  u.csv.textContent = t('downloadCsv');
  u.editor.placeholder = t('placeholder');
  if (!state.lastResult) u.result.innerHTML = `<div class="sqm-empty">${t('noResult')}</div>`;
  if (state.info) {
    u.engine.textContent = state.info.ok ? t('engineReady', { version: state.info.version }) : t('engineFailed', { error: state.info.error });
    u.engine.classList.toggle('sqm-error-text', !state.info.ok);
  }
}

function setStatus(text) { state.ui.status.textContent = text; }
function setMessages(list, kind = 'warning') {
  state.ui.messages.innerHTML = list.map(m => `<div class="sqm-msg sqm-${kind}"></div>`).join('');
  [...state.ui.messages.children].forEach((el, i) => (el.textContent = list[i]));
}
function busy(on) { state.ui.run.disabled = on; state.ui.run.textContent = on ? t('running') : t('run'); }

function showError(message) {
  busy(false);
  state.runner?.cancel();
  setStatus('');
  setMessages([message], 'error');
}

async function copyResult() {
  if (!state.lastResult) return;
  try {
    await navigator.clipboard.writeText(toTsv(state.lastResult));
    setMessages([t('copied')], 'info');
  } catch (e) {
    setMessages([t('copyFailed', { error: e.message })], 'error');
  }
}

function downloadCsv() {
  if (!state.lastResult) return;
  try {
    const blob = new Blob(['﻿' + toCsv(state.lastResult)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sqm-result.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) {
    setMessages([t('downloadFailed', { error: e.message })], 'error');
  }
}

async function start() {
  buildUi();
  const info = { engine: 'sqlite-wasm', ok: false, version: '', error: '', webAssembly: typeof WebAssembly === 'object' };
  try {
    state.engine = await SqliteEngine.create(wasmBinary);
    state.runner = new QueryRunner(state.engine, json => raise('DataRequested', json));
    info.ok = true;
    info.version = state.engine.version;
  } catch (e) {
    info.error = String((e && e.message) || e);
  }
  state.info = info;
  applyTexts();
  raise('ControlReady', JSON.stringify(info));
}

// ----- procedures called from AL -----
Object.assign(globalThis, {
  SQMStart: start,
  SetLanguage(lcid) { setLanguageId(lcid); applyTexts(); },
  SetQuery(text) { state.ui.editor.value = text || ''; },
  Execute(rowLimit) {
    if (!state.runner) return showError(state.ui.engine.textContent);
    state.rowLimit = rowLimit;
    setMessages([]);
    busy(true);
    setStatus(t('readingData'));
    try {
      state.runner.start(state.ui.editor.value, rowLimit);
    } catch (e) {
      showError(e.message);
    }
  },
  ReceiveTable(chunkJson) {
    try { state.runner.receiveTable(chunkJson); } catch (e) { showError(e.message); }
  },
  DataComplete() {
    try {
      const res = state.runner.complete();
      if (!res) return;
      state.lastResult = res;
      renderGrid(state.ui.result, res);
      const count = res.truncated ? t('rowsTruncated', { count: res.rows.length }) : t('rows', { count: res.rows.length });
      setStatus(`${count} · ${t('timing', { read: res.stats.readMs, load: res.stats.loadMs, exec: res.stats.execMs })}`);
      setMessages(res.warnings);
      busy(false);
      raise('QueryCompleted', JSON.stringify({ rows: res.rows.length, truncated: res.truncated, ...res.stats }));
    } catch (e) {
      showError(e.message);
    }
  },
  ShowError: showError,
});
