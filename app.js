(() => {
'use strict';
const CFG = window.OFFICINA_CONFIG || {};
const app = document.getElementById('app');
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const dstr = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const hm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
const hhmm = ms => { const m = Math.round(Math.max(0, ms) / 60000); return Math.floor(m / 60) + ':' + pad(m % 60); };
const dec = ms => (Math.round(ms / 36000) / 100).toString().replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const at = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); };
const ddmm = d => d.slice(8) + '/' + d.slice(5, 7);
const iso = ms => new Date(ms).toISOString();

/* ---------- stato ---------- */
const S = {
  ready: false, fatal: '', offline: false, off: 0,
  workers: [],            // elenco pubblico per la schermata di accesso
  role: null, token: '', wid: '', name: '', tab: 'timer',
  login: { mode: 'pick', wid: '', pin: '', err: '', busy: false },
  jobs: [], vehicles: [], busy: [], segs: [],      // operaio
  o: { workers: [], segs: [] },                      // titolare
  sel: '', jq: '', jf: '', confirm: '', rescueOpen: {},
  rep: { mode: 'day', date: dstr(Date.now()), month: dstr(Date.now()).slice(0, 7), by: 'person' }
};
const nowMs = () => Date.now() + S.off;
const J = id => S.jobs.find(j => j.id === id);
const W = id => S.o.workers.find(w => w.id === id);
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'it');
const normJob = j => ({ id: j.id, type: j.kind, code: j.code || '', plate: j.plate || '', barcode: j.barcode || '', desc: j.description || '', open: j.is_open, created: Date.parse(j.created_at) });
const normSeg = s => ({ id: s.id, wid: s.worker_id || S.wid, jobId: s.job_id, kind: s.kind, start: Date.parse(s.started_at), end: s.ended_at ? Date.parse(s.ended_at) : 0, parts: s.parts || '', note: s.note || '', rescues: s.rescues || [] });
const jobHead = j => j ? `${j.code ? `<span class="tag ${j.type === 'gen' ? 'g' : ''}">${esc(j.code)}</span>` : ''}${j.plate ? `<span class="plate">${esc(j.plate)}</span>` : ''}<span>${esc(j.desc)}</span>` : '<span class="mut">(lavoro eliminato)</span>';
const jobText = j => j ? [j.code, j.plate, j.desc].filter(Boolean).join(' · ') : '(lavoro eliminato)';

/* ---------- rete ---------- */
async function rpc(fn, args) {
  let r;
  try {
    r = await fetch(CFG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
  } catch (e) { const err = new Error('Nessuna connessione. Riprova tra poco.'); err.net = true; throw err; }
  let body = null;
  try { body = await r.json(); } catch (e) { /* risposta vuota */ }
  if (!r.ok) { const err = new Error((body && body.message) || 'Errore del server'); err.expired = /Sessione scaduta/.test(err.message); throw err; }
  return body;
}
async function call(fn, args) {
  try { return await rpc(fn, { p_token: S.token, ...args }); }
  catch (e) { if (e.expired) { toast(e.message); logout(); } throw e; }
}
async function act2(fn, args) {          // azione + aggiornamento dati
  try { await call(fn, args); await refresh(); return true; }
  catch (e) { if (!e.expired) toast(e.message); return false; }
}
const rangeOf = () => {
  const r = S.rep;
  if (r.mode === 'day') return [r.date, r.date];
  const [y, m] = r.month.split('-').map(Number);
  return [r.month + '-01', r.month + '-' + pad(new Date(y, m, 0).getDate())];
};
async function refresh() {
  if (!S.token) return;
  try {
    if (S.role === 'owner') {
      const [from, to] = rangeOf();
      const r = await call('o_state', { p_from: from, p_to: to });
      S.off = Date.parse(r.now) - Date.now();
      S.jobs = r.jobs.map(normJob); S.vehicles = r.vehicles; S.o.workers = r.workers;
      S.o.segs = r.segments.map(normSeg);
    } else {
      const r = await call('w_state', {});
      S.off = Date.parse(r.now) - Date.now();
      S.jobs = r.jobs.map(normJob); S.vehicles = r.vehicles; S.busy = r.busy || [];
      S.segs = r.segments.map(normSeg);
    }
    S.offline = false;
  } catch (e) { if (e.expired) return; S.offline = true; }
  softRender();
}

/* ---------- utilita' interfaccia ---------- */
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3000); }
let dirty = false;
const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && app.contains(a); };
function softRender() { if (typing()) { dirty = true; return; } render(); }
document.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (dirty && !typing()) { dirty = false; render(); } }, 350); });

/* ---------- accesso ---------- */
async function submitPin() {
  const L = S.login;
  if (L.busy || L.pin.length < 4) { if (L.pin.length < 4) { L.err = 'Il PIN ha almeno 4 cifre'; render(); } return; }
  L.busy = true; render();
  try {
    const r = L.mode === 'owner' ? await rpc('login_owner', { p_pin: L.pin }) : await rpc('login_worker', { p_worker: L.wid, p_pin: L.pin });
    if (r.error) { L.pin = ''; L.err = r.error; L.busy = false; render(); return; }
    S.token = r.token; S.role = r.role; S.name = r.name; S.wid = r.worker_id || '';
    S.tab = r.role === 'owner' ? 'report' : 'timer'; S.sel = '';
    try { if (r.role === 'worker') localStorage.setItem('of_last', S.wid); } catch (e) { /* ignora */ }
    S.login = { mode: 'pick', wid: '', pin: '', err: '', busy: false };
    await refresh(); render();
  } catch (e) { L.pin = ''; L.err = e.message; L.busy = false; render(); }
}
function logout() {
  if (S.token) rpc('logout', { p_token: S.token }).catch(() => {});
  Object.assign(S, { token: '', role: null, wid: '', name: '', jobs: [], segs: [], busy: [], sel: '', confirm: '', rescueOpen: {} });
  S.o = { workers: [], segs: [] };
  S.login = { mode: 'pick', wid: '', pin: '', err: '', busy: false };
  loadWorkers();
}
async function loadWorkers() {
  try { S.workers = await rpc('list_workers'); S.fatal = ''; S.ready = true; } catch (e) { S.fatal = e.message; }
  render();
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.token && hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) { logout(); return; }
  if (S.token) refresh();
});
setInterval(() => { if (S.token && !document.hidden) refresh(); }, 15000);

/* ---------- viste ---------- */
function render() {
  let html;
  if (S.fatal === 'config') html = shell('<div class="card"><h2>Configurazione mancante</h2><p>Apri il file <b>config.js</b> e inserisci l\'indirizzo e la chiave del tuo progetto Supabase (guida, passo 4).</p></div>');
  else if (S.fatal) html = shell(`<div class="card"><h2>Connessione non riuscita</h2><p>${esc(S.fatal)}</p><button class="btn" data-act="reload">Riprova</button></div>`);
  else if (!S.ready) html = shell('<div class="empty">Collegamento all\'officina…</div>');
  else if (!S.role) html = shell(loginView());
  else html = S.role === 'owner' ? ownerShell() : workerShell();
  app.innerHTML = html;
}
const brand = '<img class="logo" src="icons/logo.png" alt="CVP"><h1>Ore Officina</h1>';
const shell = inner => `<header><div class="bar">${brand}</div></header><main>${inner}</main>`;
function header() {
  return `<header><div class="bar">${brand}<span class="who-chip">${esc(S.name)}</span><button class="btn-out" data-act="logout">Esci</button></div></header>`;
}
const tabbar = tabs => `<nav class="tabbar" aria-label="Sezioni"><div>${tabs.map(([k, l]) => `<button data-act="tab" data-t="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div></nav>`;
const offlineBanner = () => S.offline ? '<div class="warn">Connessione assente: i dati mostrati potrebbero non essere aggiornati. Le azioni non vengono salvate finché non torna la rete.</div>' : '';

function loginView() {
  const L = S.login;
  if (L.mode === 'pick') {
    let last = ''; try { last = localStorage.getItem('of_last') || ''; } catch (e) { /* ignora */ }
    const list = [...S.workers].sort((a, b) => (b.id === last) - (a.id === last) || byName(a, b));
    return `<img class="biglogo" src="icons/logo.png" alt="CVP"><h2 class="hello">Chi sei?</h2>
    ${list.length ? `<div class="whos">${list.map(w => `<button data-act="who" data-id="${w.id}">${esc(w.name)}</button>`).join('')}</div>` : '<div class="empty">Nessun operaio inserito. Il titolare li aggiunge da Anagrafiche.</div>'}
    <p style="margin-top:22px"><button class="linkb" data-act="ownerlogin">Accesso titolare</button></p>`;
  }
  const name = L.mode === 'owner' ? 'Titolare' : ((S.workers.find(w => w.id === L.wid) || {}).name || '');
  return `<h2 class="hello" style="text-align:center">${esc(name)}</h2>
  <div class="dots" aria-label="${L.pin.length} cifre inserite">${Array.from({ length: L.pin.length }, () => '<i></i>').join('')}</div>
  <p class="err" style="text-align:center" role="alert">${esc(L.err)}</p>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-act="key" data-k="${k}" ${L.busy ? 'disabled' : ''}>${k}</button>`).join('')}<button class="fn" data-act="del" ${L.busy ? 'disabled' : ''}>Canc.</button><button data-act="key" data-k="0" ${L.busy ? 'disabled' : ''}>0</button><button class="go" data-act="go" ${L.busy ? 'disabled' : ''}>${L.busy ? '…' : 'OK'}</button></div>
  <p style="text-align:center"><button class="linkb" data-act="back">Indietro</button></p>`;
}

/* ----- operaio ----- */
function workerShell() {
  const body = S.tab === 'today' ? workerToday() : workerTimer();
  return header() + `<main>${offlineBanner()}${body}</main>` + tabbar([['timer', 'Timer'], ['today', 'Oggi']]);
}
const todaySegs = () => S.segs.filter(s => dstr(s.start) === dstr(nowMs()));
function totals(list) { const n = nowMs(); let w = 0, b = 0; for (const s of list) { const ms = Math.max(0, (s.end || n) - s.start); if (s.kind === 'break') b += ms; else w += ms; } return { w, b }; }
function rescueBlock(s) {
  const open = S.rescueOpen[s.id] ?? s.rescues.length > 0;
  return `<div class="resc"><label class="chk"><input type="checkbox" data-in="resc" data-s="${s.id}" ${open ? 'checked' : ''}> Soccorso stradale su questo lavoro</label>
  ${open ? (S.vehicles.length ? `<div class="chips">${S.vehicles.map(v => `<button data-act="veh" data-s="${s.id}" data-v="${esc(v)}" aria-pressed="${s.rescues.includes(v)}">${esc(v)}</button>`).join('')}</div>${s.rescues.length ? '' : '<p class="note" style="margin:8px 0 0">Scegli il mezzo usato.</p>'}` : '<p class="note" style="margin:8px 0 0">Nessun mezzo in elenco: il titolare li aggiunge da Anagrafiche.</p>') : ''}</div>`;
}
function jobListHtml() {
  const q = S.jq.trim().toLowerCase();
  const used = new Set(todaySegs().map(s => s.jobId));
  let list = S.jobs.filter(j => j.open && (!q || [j.code, j.plate, j.barcode, j.desc].some(x => x && String(x).toLowerCase().includes(q))));
  list = [...list].sort((a, b) => (used.has(b.id) ? 1 : 0) - (used.has(a.id) ? 1 : 0));
  if (!list.length) return `<div class="empty">${q ? 'Nessun lavoro corrisponde alla ricerca.' : 'Nessun lavoro aperto. Il titolare li inserisce da Lavori.'}</div>`;
  return list.slice(0, 40).map(j => {
    const others = S.busy.filter(b => b.job_id === j.id && b.worker_id !== S.wid).map(b => b.name);
    return `<button data-act="pick" data-id="${j.id}" aria-pressed="${S.sel === j.id}">${jobHead(j)}${others.length ? `<div class="note">Già in lavorazione: ${esc(others.join(', '))}</div>` : ''}</button>`;
  }).join('');
}
function workerTimer() {
  const now = nowMs(), run = S.segs.find(s => !s.end), t = totals(todaySegs());
  let main = '';
  if (run && dstr(run.start) !== dstr(now)) {
    main = `<section class="card run"><h2>Timer rimasto acceso</h2><p>Il timer ${run.kind === 'break' ? 'della pausa' : 'di'} ${run.kind === 'break' ? '' : jobHead(J(run.jobId))} è partito il ${ddmm(dstr(run.start))} alle ${hm(run.start)} e non è stato fermato.</p>
    <div class="row"><div><label for="oldt">Ora a cui hai finito</label><input id="oldt" type="time" value="17:00"></div><button class="btn" data-act="closeold">Chiudi timer</button></div></section>`;
  } else if (run && run.kind === 'work') {
    main = `<section class="card run"><div class="note">In lavorazione dalle ${hm(run.start)}</div><div class="jobline">${jobHead(J(run.jobId))}</div>
    <div class="clock" data-tick="${run.start}">${hms(now - run.start)}</div>
    <div class="row"><div style="flex:2 1 200px"><label for="rp">Ricambi (uno per riga)</label><textarea id="rp" data-in="segf" data-f="parts" data-s="${run.id}" placeholder="es. Filtro olio ×1">${esc(run.parts)}</textarea></div>
    <div style="flex:2 1 200px"><label for="rn">Note</label><textarea id="rn" data-in="segf" data-f="note" data-s="${run.id}">${esc(run.note)}</textarea></div></div>
    ${rescueBlock(run)}
    <div class="btns"><button class="btn big steel" data-act="pause">Pausa</button><button class="btn big stop" data-act="stop">Stop</button></div></section>`;
  } else if (run) {
    const j = J(run.jobId);
    main = `<section class="card run brk"><div class="note">In pausa dalle ${hm(run.start)}</div>${j ? `<div class="jobline mut">Lavoro in sospeso: ${jobHead(j)}</div>` : ''}
    <div class="clock" data-tick="${run.start}">${hms(now - run.start)}</div>
    <div class="btns ${j ? '' : 'one'}">${j ? '<button class="btn big" data-act="resume">Riprendi</button>' : ''}<button class="btn big stop" data-act="stop">${j ? 'Fine giornata' : 'Fine pausa'}</button></div></section>`;
  } else {
    const sj = J(S.sel);
    main = `<section class="card"><h2>Scegli il lavoro</h2>
    <label for="jq">Codice, targa o codice a barre</label><input id="jq" data-live="jq" value="${esc(S.jq)}" placeholder="Digita o scansiona, poi Invio" autocomplete="off">
    <div class="pick" id="joblist">${jobListHtml()}</div>
    <div class="btns" style="margin-top:14px"><button class="btn big" data-act="start" ${sj ? '' : 'disabled'}>${sj ? 'Avvia' : 'Scegli un lavoro'}</button><button class="btn big steel" data-act="startbreak">Pausa</button></div></section>`;
  }
  return main + `<div class="sumline"><span>Lavorato oggi <b>${hhmm(t.w)}</b></span><span>Pause <b>${hhmm(t.b)}</b></span></div>`;
}
function workerToday() {
  const segs = todaySegs().sort((a, b) => a.start - b.start), t = totals(segs), now = nowMs();
  return `<div class="sumline"><span>Lavorato <b>${hhmm(t.w)}</b></span><span>Pause <b>${hhmm(t.b)}</b></span></div>
  ${segs.length ? segs.map(s => `<div class="seg ${s.kind === 'break' ? 'brk' : ''}"><div class="t"><span>${hm(s.start)} – ${s.end ? hm(s.end) : 'in corso'}</span><span class="d">${hhmm((s.end || now) - s.start)}</span></div>
  <div>${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}</div>
  ${s.kind === 'work' ? `<div class="row" style="margin-top:8px"><div><label for="p${s.id}">Ricambi</label><textarea id="p${s.id}" rows="2" data-in="segf" data-f="parts" data-s="${s.id}">${esc(s.parts)}</textarea></div><div><label for="n${s.id}">Note</label><textarea id="n${s.id}" rows="2" data-in="segf" data-f="note" data-s="${s.id}">${esc(s.note)}</textarea></div></div>${rescueBlock(s)}` : ''}</div>`).join('') : '<div class="empty">Nessun tempo registrato oggi. Avvia un lavoro dalla scheda Timer.</div>'}
  <p class="note">Se hai dimenticato di avviare o fermare un timer, avvisa il titolare: può correggere gli orari dal report.</p>`;
}

/* ----- titolare ----- */
function ownerShell() {
  const body = { report: ownerReport, jobs: ownerJobs, people: ownerPeople }[S.tab]();
  return header() + `<main class="wide">${offlineBanner()}${body}</main>` + tabbar([['report', 'Report'], ['jobs', 'Lavori'], ['people', 'Anagrafiche']]);
}
function periodSegs() {
  const [from, to] = rangeOf();
  return S.o.segs.filter(s => { const d = dstr(s.start); return d >= from && d <= to; });
}
function aggPeople(segs, monthMode) {
  const out = {}, now = nowMs();
  for (const s of segs) {
    const date = dstr(s.start);
    const p = out[s.wid] ??= { jobs: {}, work: 0, brk: 0, byDay: {}, first: Infinity, last: 0, running: false };
    const ms = Math.max(0, (s.end || now) - s.start);
    if (!s.end) p.running = true;
    p.first = Math.min(p.first, s.start); p.last = Math.max(p.last, s.end || now);
    if (s.kind === 'break') { p.brk += ms; continue; }
    p.work += ms; p.byDay[date] = (p.byDay[date] || 0) + ms;
    const j = p.jobs[s.jobId || 'none'] ??= { ms: 0, parts: [], notes: [], rescues: [] };
    j.ms += ms; const pre = monthMode ? ddmm(date) + ' ' : '';
    if (s.parts) j.parts.push(...s.parts.split('\n').map(x => x.trim()).filter(Boolean).map(x => pre + x));
    if (s.note) j.notes.push(pre + s.note);
    if (s.rescues.length) j.rescues.push(pre + s.rescues.join(', '));
  }
  return out;
}
function aggJobs(segs) {
  const out = {}, now = nowMs();
  for (const s of segs) {
    if (s.kind === 'break') continue;
    const ms = Math.max(0, (s.end || now) - s.start), a = out[s.jobId || 'none'] ??= { ms: 0, byW: {}, parts: [], notes: [], rescues: [] }, who = (W(s.wid) || {}).name || '?';
    a.ms += ms; a.byW[s.wid] = (a.byW[s.wid] || 0) + ms;
    if (s.parts) a.parts.push(...s.parts.split('\n').map(x => x.trim()).filter(Boolean).map(x => x + ' (' + who + ')'));
    if (s.note) a.notes.push(who + ': ' + s.note);
    if (s.rescues.length) a.rescues.push(who + ': ' + s.rescues.join(', '));
  }
  return out;
}
function ownerReport() {
  const r = S.rep, segs = periodSegs(), now = nowMs();
  const label = r.mode === 'day' ? new Date(r.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : new Date(r.month + '-01T12:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const people = aggPeople(segs, r.mode === 'month');
  const total = Object.values(people).reduce((a, p) => a + p.work, 0), brk = Object.values(people).reduce((a, p) => a + p.brk, 0);
  const running = S.o.segs.filter(s => !s.end);
  const resc = segs.filter(s => s.rescues.length);
  return `${running.length ? `<div class="card"><h2>In corso adesso</h2>${running.map(s => `<div class="live"><span><b>${esc((W(s.wid) || {}).name || '?')}</b> ${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}</span><span class="c" data-tick="${s.start}">${hms(now - s.start)}</span></div>`).join('')}</div>` : ''}
  <div class="card noprint"><div class="row" style="align-items:center">
  <div class="seggroup" style="flex:0 0 auto"><button data-act="rmode" data-v="day" aria-pressed="${r.mode === 'day'}">Giornaliero</button><button data-act="rmode" data-v="month" aria-pressed="${r.mode === 'month'}">Mensile</button></div>
  <div class="seggroup" style="flex:0 0 auto"><button data-act="rby" data-v="person" aria-pressed="${r.by === 'person'}">Per persona</button><button data-act="rby" data-v="job" aria-pressed="${r.by === 'job'}">Per lavoro</button></div>
  <div>${r.mode === 'day' ? `<input type="date" id="rd" data-in="rd" value="${r.date}" aria-label="Data">` : `<input type="month" id="rm" data-in="rm" value="${r.month}" aria-label="Mese">`}</div>
  <button class="btn sec" data-act="csv" style="flex:0 0 auto">Esporta CSV</button><button class="btn sec" data-act="print" style="flex:0 0 auto">Stampa</button></div></div>
  <div class="card"><div class="row" style="align-items:center"><h2 style="flex:3 1 200px;text-transform:capitalize;margin:0">${label}</h2><div class="total" style="flex:0 0 auto">${hhmm(total)} <small>ore lavorate · pause ${hhmm(brk)}</small></div></div>
  ${resc.length ? `<p><span class="tag r">Soccorso stradale</span>${resc.map(s => `${esc((W(s.wid) || {}).name || '?')} su ${esc(jobText(J(s.jobId)))} (${esc(s.rescues.join(', '))}${r.mode === 'month' ? ', ' + ddmm(dstr(s.start)) : ''})`).join(' · ')}</p>` : ''}
  ${segs.length ? (r.by === 'person' ? reportByPerson(people, segs) : reportByJob(segs)) : '<div class="empty" style="margin-top:12px">Nessun tempo registrato in questo periodo.</div>'}</div>`;
}
function reportByPerson(people, segs) {
  const r = S.rep, ids = Object.keys(people).sort((a, b) => byName(W(a) || {}, W(b) || {}));
  return ids.map(id => {
    const p = people[id], name = (W(id) || {}).name || '(operaio eliminato)', days = Object.keys(p.byDay).length;
    const rows = Object.entries(p.jobs).sort((a, b) => b[1].ms - a[1].ms);
    return `<h3 class="sub">${esc(name)}<span class="mut">${r.mode === 'day' ? `${hm(p.first)} – ${p.running ? 'in corso' : hm(p.last)} · ` : `${days} giorni · `}pause ${hhmm(p.brk)}</span></h3>
    <div class="wrapx"><table><tr><th>Lavoro</th><th>Ricambi</th><th>Note</th><th class="n">Ore</th></tr>
    ${rows.map(([jid, x]) => `<tr><td>${jobHead(J(jid))}${x.rescues.length ? `<div><span class="tag r">Soccorso</span>${esc(x.rescues.join(' · '))}</div>` : ''}</td><td>${nl(x.parts.join('\n'))}</td><td>${nl(x.notes.join('\n'))}</td><td class="n">${hhmm(x.ms)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Solo pause registrate.</td></tr>'}
    <tr class="sum"><td colspan="3">Totale lavorato</td><td class="n">${hhmm(p.work)}</td></tr></table></div>
    ${r.mode === 'month' ? `<details><summary>Ore per giorno</summary><div class="wrapx"><table>${Object.entries(p.byDay).sort().map(([d, ms]) => `<tr><td>${ddmm(d)}</td><td class="n">${hhmm(ms)}</td></tr>`).join('')}</table></div></details>` : fixPanel(id, r.date, segs.filter(s => s.wid === id))}`;
  }).join('');
}
function fixPanel(wid, date, list) {
  const segs = [...list].sort((a, b) => a.start - b.start);
  return `<details><summary>Correggi orari</summary>
  ${segs.map(s => `<div class="fix"><span>${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}</span>
  <input type="time" aria-label="Inizio" data-in="segtime" data-s="${s.id}" data-d="${date}" data-which="start" value="${hm(s.start)}">
  <input type="time" aria-label="Fine" data-in="segtime" data-s="${s.id}" data-d="${date}" data-which="end" value="${s.end ? hm(s.end) : ''}">
  <button class="btn del" data-act="delseg" data-s="${s.id}">${S.confirm === 'seg:' + s.id ? 'Conferma' : 'Elimina'}</button></div>`).join('')}
  <h3 style="font-size:19px;margin:14px 0 6px">Aggiungi tempo manuale</h3>
  <div class="row"><div><label for="ak_${wid}">Tipo</label><select id="ak_${wid}"><option value="work">Lavoro</option><option value="break">Pausa</option></select></div>
  <div style="flex:2 1 200px"><label for="aj_${wid}">Lavoro</label><select id="aj_${wid}"><option value="">Scegli…</option>${S.jobs.map(j => `<option value="${j.id}">${esc(jobText(j))}</option>`).join('')}</select></div>
  <div><label for="as_${wid}">Inizio</label><input id="as_${wid}" type="time"></div><div><label for="ae_${wid}">Fine</label><input id="ae_${wid}" type="time"></div>
  <button class="btn sec" data-act="addseg" data-w="${wid}" data-d="${date}">Aggiungi</button></div></details>`;
}
function reportByJob(segs) {
  const agg = aggJobs(segs);
  return Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms).map(([jid, a]) => `<h3 class="sub">${jobHead(J(jid))}</h3>
  <div class="wrapx"><table><tr><th>Operaio</th><th class="n">Ore</th></tr>
  ${Object.entries(a.byW).sort((x, y) => y[1] - x[1]).map(([w, ms]) => `<tr><td>${esc((W(w) || {}).name || '?')}</td><td class="n">${hhmm(ms)}</td></tr>`).join('')}
  <tr class="sum"><td>Totale lavoro</td><td class="n">${hhmm(a.ms)}</td></tr></table></div>
  ${a.rescues.length ? `<p style="margin:8px 0 2px"><span class="tag r">Soccorso stradale</span>${esc(a.rescues.join(' · '))}</p>` : ''}
  ${a.parts.length ? `<p style="margin:8px 0 2px"><b>Ricambi</b><br>${nl(a.parts.join('\n'))}</p>` : ''}${a.notes.length ? `<p style="margin:8px 0 0"><b>Note</b><br>${nl(a.notes.join('\n'))}</p>` : ''}`).join('') || '<div class="empty">Nessun lavoro in questo periodo.</div>';
}
function ownerJobs() {
  return `<div class="card"><h2>Nuovo lavoro</h2>
  <div class="row"><div style="flex:0 1 200px"><label for="jt">Tipo</label><select id="jt"><option value="veh">Veicolo</option><option value="gen">Generico (pulizia, varie…)</option></select></div>
  <div><label for="jc">Codice lavoro</label><input id="jc" placeholder="es. L-2026-118"></div>
  <div><label for="jp">Targa</label><input id="jp" placeholder="AB123CD" style="text-transform:uppercase"></div>
  <div><label for="jbc">Codice a barre</label><input id="jbc" placeholder="Scansiona qui"></div></div>
  <div class="row" style="margin-top:10px"><div style="flex:3 1 260px"><label for="jd">Descrizione</label><input id="jd" placeholder="es. Tagliando + freni anteriori"></div><button class="btn" data-act="addjob">Aggiungi lavoro</button></div></div>
  <div class="card"><div class="row" style="align-items:center"><h2 style="flex:1 1 auto;margin:0">Elenco lavori</h2><div style="flex:2 1 200px"><input id="jf" type="search" data-live="jf" placeholder="Cerca codice, targa, barcode…" value="${esc(S.jf)}"></div></div>
  <div id="jobsadmin">${jobsAdminList()}</div>
  <p class="note" style="margin-bottom:0">I lavori chiusi non compaiono agli operai ma restano nei report. Eliminare un lavoro lo toglie anche dai report già fatti: di solito conviene chiuderlo.</p></div>`;
}
function jobsAdminList() {
  const q = S.jf.toLowerCase();
  const list = S.jobs.filter(j => !q || (jobText(j) + ' ' + j.barcode).toLowerCase().includes(q));
  return list.length ? list.map(j => `<div class="item"><div>${jobHead(j)}${j.barcode ? ` <span class="mut">▮ ${esc(j.barcode)}</span>` : ''}${j.open ? '' : ' <span class="tag">chiuso</span>'}</div>
  <div class="acts"><button class="btn sec sm" data-act="togjob" data-id="${j.id}">${j.open ? 'Chiudi' : 'Riapri'}</button><button class="btn del" data-act="deljob" data-id="${j.id}">${S.confirm === 'job:' + j.id ? 'Conferma' : 'Elimina'}</button></div></div>`).join('') : '<div class="empty" style="margin-top:10px">Nessun lavoro trovato.</div>';
}
function ownerPeople() {
  return `<div class="card"><h2>Operai</h2>
  <div class="row"><div style="flex:2 1 200px"><label for="nw">Nome e cognome</label><input id="nw"></div><div><label for="nwp">PIN (4–6 cifre)</label><input id="nwp" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div><button class="btn" data-act="addw">Aggiungi</button></div>
  ${S.o.workers.length ? S.o.workers.map(w => `<div class="item"><div>${esc(w.name)}${w.active ? '' : ' <span class="tag">disattivato</span>'}</div>
  <div class="acts"><input id="pp_${w.id}" type="password" inputmode="numeric" maxlength="6" placeholder="Nuovo PIN" aria-label="Nuovo PIN per ${esc(w.name)}"><button class="btn sec sm" data-act="setpin" data-id="${w.id}">Cambia PIN</button><button class="btn sec sm" data-act="togw" data-id="${w.id}">${w.active ? 'Disattiva' : 'Riattiva'}</button></div></div>`).join('') : '<div class="empty" style="margin-top:12px">Nessun operaio inserito.</div>'}</div>
  <div class="card"><h2>Mezzi soccorso stradale</h2><div class="row"><div><label for="nv">Nome mezzo</label><input id="nv" placeholder="es. Carro attrezzi 2"></div><button class="btn" data-act="addv">Aggiungi</button></div>
  ${S.vehicles.map(v => `<div class="item"><span>${esc(v)}</span><button class="btn del" data-act="delv" data-v="${esc(v)}">Elimina</button></div>`).join('')}</div>
  <div class="card"><h2>PIN del titolare</h2><div class="row"><div><label for="opn">Nuovo PIN (4–6 cifre)</label><input id="opn" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div><button class="btn sec" data-act="setowner">Cambia PIN</button></div></div>`;
}

/* ---------- azioni ---------- */
const pinOk = v => /^\d{4,6}$/.test(v);
const get = (arr, id) => arr.find(x => x.id === id);
const act = {
  reload() { location.reload(); },
  who(b) { S.login = { mode: 'pin', wid: b.dataset.id, pin: '', err: '', busy: false }; render(); },
  ownerlogin() { S.login = { mode: 'owner', wid: '', pin: '', err: '', busy: false }; render(); },
  back() { S.login = { mode: 'pick', wid: '', pin: '', err: '', busy: false }; render(); },
  key(b) { const L = S.login; if (L.pin.length < 6) { L.pin += b.dataset.k; L.err = ''; render(); } },
  del() { S.login.pin = S.login.pin.slice(0, -1); render(); },
  go() { submitPin(); },
  logout() { logout(); },
  tab(b) { S.tab = b.dataset.t; S.confirm = ''; render(); },
  /* timer */
  pick(b) { S.sel = S.sel === b.dataset.id ? '' : b.dataset.id; render(); },
  start() { if (!S.sel || S.segs.some(s => !s.end)) return; const jid = S.sel; S.sel = ''; S.jq = ''; act2('w_start', { p_kind: 'work', p_job: jid }); },
  startbreak() { if (S.segs.some(s => !s.end)) return; act2('w_start', { p_kind: 'break', p_job: null }); },
  pause() { act2('w_pause', {}); },
  resume() { act2('w_resume', {}); },
  stop() { act2('w_stop', {}); },
  closeold() { const run = S.segs.find(s => !s.end); const v = $('#oldt').value; if (!run || !v) { toast("Indica l'ora"); return; } let end = at(dstr(run.start), v); if (end <= run.start) end += 864e5; act2('w_close_at', { p_end: iso(Math.min(end, nowMs())) }); },
  veh(b) {
    const s = get(S.segs, b.dataset.s); if (!s) return; const v = b.dataset.v, on = !s.rescues.includes(v);
    s.rescues = on ? [...s.rescues, v] : s.rescues.filter(x => x !== v); render();
    act2('w_set_rescue', { p_seg: s.id, p_vehicle: v, p_on: on });
  },
  /* report */
  rmode(b) { S.rep.mode = b.dataset.v; render(); refresh(); },
  rby(b) { S.rep.by = b.dataset.v; render(); },
  print() { window.print(); },
  csv() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', now = nowMs();
    const rows = [['Data', 'Operaio', 'Tipo', 'Codice', 'Targa', 'Descrizione', 'Inizio', 'Fine', 'Ore decimali', 'Ricambi', 'Note', 'Soccorso (mezzi)']];
    [...periodSegs()].sort((a, b) => a.start - b.start).forEach(s => {
      const j = J(s.jobId) || {};
      rows.push([dstr(s.start), (W(s.wid) || {}).name || '', s.kind === 'break' ? 'Pausa' : 'Lavoro', j.code || '', j.plate || '', j.desc || '', hm(s.start), s.end ? hm(s.end) : '', dec((s.end || now) - s.start), (s.parts || '').replace(/\n/g, ' | '), s.note || '', s.rescues.join(' | ')]);
    });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'report-ore-' + (S.rep.mode === 'day' ? S.rep.date : S.rep.month) + '.csv'; document.body.append(a); a.click(); a.remove();
  },
  delseg(b) {
    const key = 'seg:' + b.dataset.s; if (S.confirm !== key) { S.confirm = key; render(); return; }
    S.confirm = ''; act2('o_delete_segment', { p_seg: b.dataset.s });
  },
  addseg(b) {
    const w = b.dataset.w, d = b.dataset.d, job = $('#aj_' + w).value, kind = $('#ak_' + w).value, s = $('#as_' + w).value, e = $('#ae_' + w).value;
    if (!s || !e) { toast('Inserisci inizio e fine'); return; }
    if (kind === 'work' && !job) { toast('Scegli il lavoro'); return; }
    const st = at(d, s); let en = at(d, e); if (en <= st) en += 864e5;
    act2('o_add_segment', { p_worker: w, p_job: kind === 'work' ? job : null, p_kind: kind, p_start: iso(st), p_end: iso(en) });
  },
  /* lavori */
  addjob() {
    const code = $('#jc').value.trim(), plate = $('#jp').value.trim(), barcode = $('#jbc').value.trim();
    if (!code && !plate && !barcode) { toast('Inserisci almeno codice, targa o codice a barre'); return; }
    act2('o_add_job', { p_kind: $('#jt').value, p_code: code, p_plate: plate, p_barcode: barcode, p_desc: $('#jd').value.trim() }).then(ok => { if (ok) toast('Lavoro aggiunto'); });
  },
  togjob(b) { const j = get(S.jobs, b.dataset.id); if (j) act2('o_set_job_open', { p_job: j.id, p_open: !j.open }); },
  deljob(b) { const key = 'job:' + b.dataset.id; if (S.confirm !== key) { S.confirm = key; render(); return; } S.confirm = ''; act2('o_delete_job', { p_job: b.dataset.id }); },
  /* anagrafiche */
  addw() { const n = $('#nw').value.trim(), p = $('#nwp').value; if (!n) { toast('Inserisci il nome'); return; } if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_add_worker', { p_name: n, p_pin: p }).then(ok => { if (ok) toast('Operaio aggiunto'); }); },
  setpin(b) { const p = $('#pp_' + b.dataset.id).value; if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_set_worker_pin', { p_worker: b.dataset.id, p_pin: p }).then(ok => { if (ok) toast('PIN cambiato'); }); },
  togw(b) { const w = get(S.o.workers, b.dataset.id); if (w) act2('o_set_worker_active', { p_worker: w.id, p_active: !w.active }); },
  addv() { const n = $('#nv').value.trim(); if (n) act2('o_add_vehicle', { p_name: n }); },
  delv(b) { act2('o_del_vehicle', { p_name: b.dataset.v }); },
  setowner() { const p = $('#opn').value; if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_set_owner_pin', { p_pin: p }).then(ok => { if (ok) toast('PIN del titolare cambiato'); }); }
};
const chg = {
  segf(t) {
    const s = get(S.segs, t.dataset.s); if (!s) return; s[t.dataset.f] = t.value;
    call('w_set_text', { p_seg: s.id, p_parts: s.parts, p_note: s.note }).catch(e => { if (!e.expired) toast('Non salvato: ' + e.message); });
  },
  resc(t) {
    const s = get(S.segs, t.dataset.s); if (!s) return;
    S.rescueOpen[s.id] = t.checked;
    if (!t.checked && s.rescues.length) { const old = s.rescues; s.rescues = []; render(); Promise.all(old.map(v => call('w_set_rescue', { p_seg: s.id, p_vehicle: v, p_on: false }))).then(refresh).catch(e => toast(e.message)); }
    else render();
  },
  rd(t) { S.rep.date = t.value || dstr(Date.now()); dirty = false; render(); refresh(); },
  rm(t) { S.rep.month = t.value || dstr(Date.now()).slice(0, 7); dirty = false; render(); refresh(); },
  segtime(t) {
    const s = get(S.o.segs, t.dataset.s); if (!s) return; const v = t.value, d = t.dataset.d;
    let st = s.start, en = s.end;
    if (t.dataset.which === 'start') { if (!v) return; st = at(d, v); }
    else if (!v) en = 0; else { en = at(d, v); if (en <= st) en += 864e5; }
    act2('o_fix_segment', { p_seg: s.id, p_start: iso(st), p_end: en ? iso(en) : null });
  }
};
const live = {
  jq(t) { S.jq = t.value; const l = $('#joblist'); if (l) l.innerHTML = jobListHtml(); },
  jf(t) { S.jf = t.value; const l = $('#jobsadmin'); if (l) l.innerHTML = jobsAdminList(); }
};
app.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const f = act[b.dataset.act]; if (f) f(b, e); });
app.addEventListener('change', e => { const f = chg[e.target.dataset.in]; if (f) f(e.target); });
app.addEventListener('input', e => { const f = live[e.target.dataset.live]; if (f) f(e.target); });
app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'jq') {
    e.preventDefault(); const v = e.target.value.trim().toLowerCase(); if (!v) return;
    const j = S.jobs.find(j => j.open && [j.code, j.plate, j.barcode].some(x => x && String(x).toLowerCase() === v));
    if (j) { S.sel = j.id; S.jq = ''; render(); } else toast('Nessun lavoro aperto con questo codice');
  }
});
document.addEventListener('keydown', e => {
  if (S.role || S.login.mode === 'pick' || S.login.busy) return;
  if (/^[0-9]$/.test(e.key) && S.login.pin.length < 6) { S.login.pin += e.key; S.login.err = ''; render(); }
  else if (e.key === 'Backspace') { S.login.pin = S.login.pin.slice(0, -1); render(); }
  else if (e.key === 'Enter') submitPin();
});
setInterval(() => { const n = nowMs(); document.querySelectorAll('[data-tick]').forEach(el => { el.textContent = hms(n - Number(el.dataset.tick)); }); }, 1000);

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { S.fatal = 'config'; render(); } else { render(); loadWorkers(); }
})();
