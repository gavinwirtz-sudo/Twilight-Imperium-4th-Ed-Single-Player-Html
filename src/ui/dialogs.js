// Modal dialogs and on-map picking. Everything returns promises so the async game loop can wait on a human.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const $ = (id) => document.getElementById(id);

  // modal({ title, body: string|Node, actions: [{label, value, cls}] }) -> { promise, body, buttons, close }
  ui.modal = function (opts) {
    const rootEl = $('modal-root'), title = $('modal-title'), body = $('modal-body'), actions = $('modal-actions');
    title.textContent = opts.title || '';
    body.innerHTML = '';
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    actions.innerHTML = '';
    let resolve, reject;
    const promise = new Promise((r, j) => { resolve = r; reject = j; });
    rootEl.classList.remove('peek'); document.getElementById('modal').classList.remove('wide');
    $('peek-title').textContent = opts.title || '';
    const abort = (err) => { rootEl.hidden = true; rootEl.classList.remove('peek'); if (ui.currentAbort === abort) ui.currentAbort = null; reject(err); };
    const close = (v) => { rootEl.hidden = true; rootEl.classList.remove('peek'); if (ui.currentAbort === abort) ui.currentAbort = null; resolve(v); };
    ui.currentAbort = abort;
    const buttons = (opts.actions || []).map((a) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      b.addEventListener('click', () => close(typeof a.value === 'function' ? a.value() : a.value));
      actions.appendChild(b);
      return b;
    });
    rootEl.hidden = false;
    return { promise, body, buttons, close };
  };

  // "Tile 26 · Jord, Sol" — the tile number plus its planets (or what else is there), instead of raw board coordinates.
  ui.sysLabel = function (state, id) {
    const sys = state && state.map.systems[id];
    if (!sys) return String(id);
    const names = sys.planets.map((pl) => pl.name);
    const what = names.length ? names.join(', ') : (sys.anomaly ? sys.anomaly.replace(/-/g, ' ') : 'empty space');
    return `Tile ${sys.tile || id} · ${what}`;
  };

  // ui.viewer({ title, body, wide }): read-only reference pages. Independent of the decision dialog (ui.modal), so they work
  // while a decision is pending, hidden ("See board") or not.
  ui.viewer = function (opts) {
    const root = $('viewer-root'), box = $('viewer'), body = $('viewer-body');
    $('viewer-title').textContent = opts.title || '';
    body.innerHTML = '';
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    box.classList.toggle('wide', !!opts.wide);
    root.hidden = false; box.scrollTop = 0;
    $('viewer-close').focus();
  };
  ui.closeViewer = function () { $('viewer-root').hidden = true; };
  ui.initViewer = function () {
    $('viewer-close').addEventListener('click', ui.closeViewer);
    $('viewer-root').addEventListener('click', (e) => { if (e.target === $('viewer-root')) ui.closeViewer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('viewer-root').hidden) { ui.closeViewer(); e.stopPropagation(); } }, true);
  };

  // Hide / show the open dialog so the board can be studied (and zoomed, inspected) before deciding.
  ui.togglePeek = function () { const r = $('modal-root'); if (!r.hidden) r.classList.toggle('peek'); };
  document.addEventListener('DOMContentLoaded', () => {
    $('modal-peek').addEventListener('click', ui.togglePeek);
    $('peek-tab').addEventListener('click', ui.togglePeek);
  });

  // choose(title, options[{label, sub, value, disabled}], {note, cancel}) -> value
  ui.choose = function (title, options, extra) {
    extra = extra || {};
    const wrap = document.createElement('div');
    if (extra.note) { const n = document.createElement('div'); n.className = 'note'; n.innerHTML = extra.note; wrap.appendChild(n); }
    const m = { close: null };
    options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'opt' + (o.disabled ? ' disabled' : '');
      b.innerHTML = ui.esc(o.label) + (o.sub ? `<span class="sub">${o.sub}</span>` : '');
      b.addEventListener('click', () => m.close(o.value));
      wrap.appendChild(b);
    });
    const handle = ui.modal({ title, body: wrap, actions: extra.cancel ? [{ label: extra.cancel, value: null, cls: 'secondary' }] : [] });
    m.close = handle.close;
    return handle.promise;
  };

  // chooseValue(title, text, [{label, value}]) -> value, or undefined if cancelled. (null/false values are allowed.)
  ui.chooseValue = function (title, text, options) {
    return ui.choose(title, options.slice(0, 40).map((o, i) => ({ label: o.label, value: i })), { note: ui.esc(text || ''), cancel: 'Back' })
      .then((i) => (i === null || i === undefined ? undefined : options[i].value));
  };

  ui.confirm = function (title, text, yes, no) {
    return ui.modal({ title, body: `<p>${text}</p>`, actions: [{ label: no || 'No', value: false, cls: 'secondary' }, { label: yes || 'Yes', value: true }] }).promise;
  };

  // ---- hint bar + picking systems on the board ------------------------------------------------
  ui.setHint = function (html) {
    const h = $('hint');
    if (!html) { h.className = 'hint'; h.innerHTML = ''; return; }
    h.className = 'hint on';
    h.innerHTML = html;
  };

  // pickSystem(state, ids, message, cancelLabel?) -> id | null
  ui.pickSystem = function (state, ids, message, cancelLabel) {
    return new Promise((resolve, reject) => {
      const abort = (err) => { ui.setHint(''); ui.refresh(); if (ui.currentAbort === abort) ui.currentAbort = null; reject(err); };
      const done = (v) => { ui.setHint(''); ui.refresh(); if (ui.currentAbort === abort) ui.currentAbort = null; resolve(v); };
      ui.currentAbort = abort;
      ui.refresh({ pick: new Set(ids), onPick: (id) => done(id) });
      ui.setHint(`<b>${message}</b> ` + (cancelLabel ? '<button id="hint-cancel" class="secondary" style="margin-left:10px">' + ui.esc(cancelLabel) + '</button>' : ''));
      const c = $('hint-cancel');
      if (c) c.addEventListener('click', () => done(null));
    });
  };

  // Undo: abandon whatever decision is open and go back (see TI.undo in phases.js). Only during the human's own turn.
  ui.canUndo = () => !!(ui.currentAbort && TI.undo && TI.undo.canUndo());
  ui.doUndo = function () {
    if (!ui.canUndo()) return false;
    const text = TI.undo.request();
    if (!text) return false;
    const abort = ui.currentAbort; ui.currentAbort = null;
    abort(TI.undo.signal(text));
    return true;
  };

  // number stepper helper for dialogs: returns { node, get, set }
  ui.stepper = function (min, max, value, onChange) {
    const node = document.createElement('span');
    node.style.whiteSpace = 'nowrap';
    const minus = document.createElement('button'), plus = document.createElement('button'), val = document.createElement('span');
    minus.textContent = '−'; plus.textContent = '+';
    minus.className = plus.className = 'secondary';
    minus.style.padding = plus.style.padding = '2px 10px';
    val.style.cssText = 'display:inline-block;min-width:28px;text-align:center;font-weight:700';
    let v = value;
    const draw = () => { val.textContent = v; minus.disabled = v <= min; plus.disabled = v >= max; };
    minus.addEventListener('click', () => { v = Math.max(min, v - 1); draw(); onChange && onChange(v); });
    plus.addEventListener('click', () => { v = Math.min(max, v + 1); draw(); onChange && onChange(v); });
    node.append(minus, val, plus);
    draw();
    return { node, get: () => v, set: (x) => { v = Math.max(min, Math.min(max, x)); draw(); onChange && onChange(v); }, setMax: (m) => { max = m; if (v > max) v = max; draw(); } };
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
