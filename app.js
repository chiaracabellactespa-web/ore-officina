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
  o: { workers: [], segs: [], subs: [], wt: [], cc: [], today: '' },   // titolare
  sel: '', jq: '', jf: '', confirm: '', rescueOpen: {},
  draft: null, openJob: '', files: {},
  sched: null, sch: null, alerts: [], pushReady: false, pushOn: false, open: {},
  wt: [], cc: [], days: [], today: '', hard: '', typeSel: '', tbl: null, csel: {}, an: 'm3',
  rep: { mode: 'day', date: dstr(Date.now()), month: dstr(Date.now()).slice(0, 7), by: 'person' }
};
const nowMs = () => Date.now() + S.off;
const J = id => S.jobs.find(j => j.id === id);
const W = id => S.o.workers.find(w => w.id === id);
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'it');
const normJob = j => ({ id: j.id, type: j.kind, code: j.code || '', plate: j.plate || '', barcode: j.barcode || '', desc: j.description || '', open: j.is_open, created: Date.parse(j.created_at),
  sheet: j.sheet_no || '', customer: j.customer || '', model: j.model || '', vin: j.vin || '', km: j.km ?? '', due: j.due_date || '', request: j.request || '', nfiles: j.nfiles || 0 });
const emptyDraft = () => ({ id: '', kind: 'veh', code: '', plate: '', barcode: '', desc: '', sheet: '', customer: '', model: '', vin: '', km: '', due: '', request: '', file: null, note: '' });
S.draft = emptyDraft();
const Sc = () => window.OfficinaScheda;
const itDate = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '';
function jobInfo(j, owner) {                     // dati della scheda sotto al lavoro (il cliente solo al titolare)
  if (!j) return '';
  const rows = [['Veicolo', j.model && j.model !== j.desc ? j.model : ''], ['Telaio', j.vin], ['Km', j.km !== '' ? Number(j.km).toLocaleString('it-IT') : ''], ['Consegna prevista', itDate(j.due)],
    ...(owner ? [['Cliente', j.customer], ['Scheda n.', j.sheet]] : [])].filter(r => r[1]);
  if (!rows.length && !j.request) return '';
  return `<div class="jinfo">${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}${j.request ? `<p><span>Lavoro richiesto</span>${nl(j.request)}</p>` : ''}</div>`;
}
const toB64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => ko(new Error('File non leggibile')); r.readAsDataURL(blob); });
const normSeg = s => ({ id: s.id, wid: s.worker_id || S.wid, jobId: s.job_id, kind: s.kind, start: Date.parse(s.started_at), end: s.ended_at ? Date.parse(s.ended_at) : 0, parts: s.parts || '', note: s.note || '', rescues: s.rescues || [], ot: !!s.overtime, auto: !!s.auto_stopped, wt: s.work_type_id || '' });
const jobHead = j => j ? `${j.code ? `<span class="tag ${j.type === 'gen' ? 'g' : ''}">${esc(j.code)}</span>` : ''}${j.plate ? `<span class="plate">${esc(j.plate)}</span>` : ''}<span>${esc(j.desc)}</span>` : '<span class="mut">(lavoro eliminato)</span>';
/* ---------- orario dell'officina ---------- */
const ROME = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYNAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
function romeNow(ms) { const p = {}; ROME.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; }); return { dow: DOW.indexOf(p.weekday) + 1, min: (Number(p.hour) % 24) * 60 + Number(p.minute) }; }
const dOpen = (k, def) => (S.open[k] ?? def) ? ' open' : '';   // i pannelli <details> restano aperti quando la pagina si aggiorna
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const schedOn = () => !!(S.sched && S.sched.enabled);
const slotsOf = d => !Array.isArray(d) || !d.length ? [] : (typeof d[0] === 'string' ? [d] : d);   // accetta anche il vecchio formato ["08:00","18:00"]
const dayHours = ms => { const s = schedOn() && S.sched.days ? slotsOf(S.sched.days[romeNow(ms).dow]) : []; return s.length ? s : null; };   // fasce del giorno: [[inizio,fine],...]
const slotTxt = s => s.map(x => x[0] + '–' + x[1]).join(' e ');
function inHours(ms) { if (!schedOn()) return true; const d = dayHours(ms); if (!d) return false; const m = romeNow(ms).min; return d.some(x => m >= toMin(x[0]) && m < toMin(x[1])); }
function slotEnd(ms) { const d = dayHours(ms); if (!d) return ''; const m = romeNow(ms).min, x = d.find(x => m >= toMin(x[0]) && m < toMin(x[1])); return x ? x[1] : ''; }   // fine della fascia in cui si trova ms
function nextSlotStart(ms) { const d = dayHours(ms); if (!d) return ''; const m = romeNow(ms).min, x = d.find(x => toMin(x[0]) > m); return x ? x[0] : ''; }
const urlB64ToBytes = v => { const raw = atob(String(v).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(v).length / 4) * 4, '=')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const pushOk = () => !!(CFG.VAPID_PUBLIC_KEY && S.pushReady && schedOn() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
function refreshPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(sub => { S.pushOn = !!sub; softRender(); }).catch(() => {});
}
const wtName = id => ((S.o.wt.find(t => t.id === id) || S.wt.find(t => t.id === id)) || {}).name || '';
const ccLabel = c => c ? `${c.code} ${c.name}` : '?';
const fmtM = m => Math.floor(m / 60) + ':' + pad(m % 60);                      // minuti -> h:mm
const parseH = v => { v = String(v || '').trim().replace(',', '.'); if (!v) return 0; let m; if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(v))) return Number(m[1]) * 60 + Number(m[2]); return /^\d+(\.\d+)?$/.test(v) ? Math.round(parseFloat(v) * 60) : NaN; };
const pastHard = () => !!(S.hard && schedOn() && romeNow(nowMs()).min >= toMin(S.hard));
// straordinario "vero": la parte di un periodo in straordinario che cade dentro le fasce ordinarie conta come ordinaria
function otMs(s, now) {
  if (!s.ot || s.kind === 'break') return 0;
  const end = s.end || now || nowMs(), tot = Math.max(0, end - s.start);
  if (!schedOn() || !S.sched.days) return tot;
  const d = dstr(s.start), dow = (new Date(s.start).getDay() + 6) % 7 + 1; let ov = 0;
  for (const x of slotsOf(S.sched.days[dow])) { const a = Math.max(s.start, at(d, x[0])), b = Math.min(end, at(d, x[1])); if (b > a) ov += b - a; }
  return Math.max(0, tot - ov);
}
const jobText = j => j ? [j.code, j.plate, j.desc].filter(Boolean).join(' · ') : '(lavoro eliminato)';

/* ---------- rete ---------- */
async function rpc(fn, args) {
  let r;
  try {
    // usa solo l'indirizzo base (https://xxxx.supabase.co), anche se in config.js c'e' altro dopo
    const key = String(CFG.SUPABASE_ANON_KEY).trim();
    r = await fetch(new URL(String(CFG.SUPABASE_URL).trim()).origin + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      // le chiavi nuove (sb_publishable_...) vanno solo in "apikey"; quelle vecchie (eyJ...) anche in Authorization
      headers: key.startsWith('sb_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
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
  if (S.role === 'owner' && S.tab === 'analysis') { const k = { m1: 0, m3: 2, m6: 5, y: 11 }[S.an] ?? 2, t = new Date(); return [dstr(new Date(t.getFullYear(), t.getMonth() - k, 1)), dstr(new Date(t.getFullYear(), t.getMonth() + 1, 0))]; }
  if (r.mode === 'day' && S.tab === 'report') return [r.date, r.date];
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
      S.o.segs = r.segments.map(normSeg); S.sched = r.schedule;
      S.o.subs = r.subs || []; S.o.wt = r.work_types || []; S.o.cc = r.cost_centers || []; S.o.today = r.today || ''; S.hard = r.hard_stop || '';
    } else {
      const r = await call('w_state', {});
      S.off = Date.parse(r.now) - Date.now();
      S.jobs = r.jobs.map(normJob); S.vehicles = r.vehicles; S.busy = r.busy || [];
      S.segs = r.segments.map(normSeg); S.sched = r.schedule; S.alerts = r.alerts || []; S.pushReady = !!r.push_ready;
      S.wt = r.work_types || []; S.cc = r.cost_centers || []; S.days = r.days || []; S.today = r.today || dstr(nowMs()); S.hard = r.hard_stop || '';
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
    await refresh(); render(); if (r.role === 'worker') refreshPush();
  } catch (e) { L.pin = ''; L.err = e.message; L.busy = false; render(); }
}
function logout() {
  if (S.token) rpc('logout', { p_token: S.token }).catch(() => {});
  Object.assign(S, { token: '', role: null, wid: '', name: '', jobs: [], segs: [], busy: [], sel: '', confirm: '', rescueOpen: {}, draft: emptyDraft(), openJob: '', files: {}, sched: null, sch: null, alerts: [], pushReady: false, pushOn: false, open: {}, wt: [], cc: [], days: [], today: '', hard: '', typeSel: '', tbl: null, csel: {} });
  S.o = { workers: [], segs: [], subs: [], wt: [], cc: [], today: '' };
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
  const body = S.tab === 'today' ? workerToday() : S.tab === 'hours' ? workerHours() : workerTimer();
  const todo = pendingDays().length || (!S.days.some(d => d.day === S.today) && todaySegs().some(x => x.kind === 'work' && x.end)) ? 1 : 0;
  return header() + `<main>${offlineBanner()}${body}</main>` + tabbar([['timer', 'Timer'], ['today', 'Oggi'], ['hours', 'Ore' + (todo ? ' <i class="bdg">!</i>' : '')]]);
}
const todaySegs = () => S.segs.filter(s => dstr(s.start) === dstr(nowMs()));
function totals(list) { const n = nowMs(); let w = 0, b = 0, o = 0; for (const s of list) { const ms = Math.max(0, (s.end || n) - s.start); if (s.kind === 'break') b += ms; else { w += ms; o += otMs(s, n); } } return { w, b, o }; }
const otSum = t => t.o ? `<span>Straordinario <b>${hhmm(t.o)}</b></span>` : '';
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
function alertsHtml() {
  const run = S.segs.some(s => !s.end);
  return S.alerts.map(a => {
    if (a.kind === 'reminder') return `<section class="card alert" role="alert"><h2>Compila le ore di oggi</h2><p>Indica quante ore hai fatto su ogni commessa (officina, carrozzeria, revisioni…).</p>
    <div class="btns"><button class="btn big" data-act="gohours" data-id="${a.id}">Apri la tabella</button><button class="btn big sec" data-act="ackalert" data-id="${a.id}">Più tardi</button></div></section>`;
    const j = J(a.job_id), t = Date.parse(a.stopped_at);
    if (a.kind === 'hard') return `<section class="card alert" role="alert"><h2>Timer fermato alle ${hm(t)}</h2><p>Alle ${hm(t)} tutti i timer si fermano da soli${j ? ': quello su ' + jobHead(j) : ''}. Ricordati di compilare le ore per commessa.</p>
    <div class="btns"><button class="btn big" data-act="gohours" data-id="${a.id}">Apri la tabella</button><button class="btn big sec" data-act="ackalert" data-id="${a.id}">Ok</button></div></section>`;
    const canOt = !run && j && j.open && !inHours(nowMs()) && !pastHard();
    const nx = dstr(t) === dstr(nowMs()) ? nextSlotStart(t) : '', brk = nx && toMin(nx) > romeNow(nowMs()).min;   // fermato per la pausa di mezzogiorno
    return `<section class="card alert" role="alert"><h2>${brk ? 'Timer fermato per la pausa' : 'Timer fermato a fine orario'}</h2><p>Il timer su ${jobHead(j)} è stato fermato alle <b>${hm(t)}</b>, ${brk ? `alla fine della fascia della mattina. Alle ${nx} potrai riavviarlo normalmente.` : "alla fine dell'orario dell'officina."}${canOt ? ' Se stai ancora lavorando, avvia lo straordinario.' : ''}</p>
    <div class="btns ${canOt ? '' : 'one'}">${canOt ? `<button class="btn big amber" data-act="startot" data-id="${a.id}" data-job="${a.job_id}">Avvia straordinario</button>` : ''}<button class="btn big sec" data-act="ackalert" data-id="${a.id}">${canOt ? 'Ho finito' : 'Ok'}</button></div></section>`;
  }).join('');
}
function typeSelect(s, owner, id) {
  const list = (owner ? S.o.wt : S.wt).filter(t => t.active !== false || t.id === s.wt);
  return `<select ${id ? `id="${id}" ` : ''}class="tsel" aria-label="Tipo di lavoro" data-in="${owner ? 'otype' : 'wtype'}" data-s="${s.id}"><option value="">Tipo non indicato</option>${list.map(t => `<option value="${t.id}" ${t.id === s.wt ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
}
const typeTag = s => s.kind === 'work' && s.wt ? ` <span class="tag t">${esc(wtName(s.wt))}</span>` : '';
function workerTimer() {
  const now = nowMs(), run = S.segs.find(s => !s.end), t = totals(todaySegs());
  const out = schedOn() && !inHours(now), dh = dayHours(now);
  let main = '';
  if (run && dstr(run.start) !== dstr(now)) {
    main = `<section class="card run"><h2>Timer rimasto acceso</h2><p>Il timer ${run.kind === 'break' ? 'della pausa' : 'di'} ${run.kind === 'break' ? '' : jobHead(J(run.jobId))} è partito il ${ddmm(dstr(run.start))} alle ${hm(run.start)} e non è stato fermato.</p>
    <div class="row"><div><label for="oldt">Ora a cui hai finito</label><input id="oldt" type="time" value="17:00"></div><button class="btn" data-act="closeold">Chiudi timer</button></div></section>`;
  } else if (run && run.kind === 'work') {
    const rd = slotEnd(run.start);
    main = `<section class="card run"><div class="note">In lavorazione dalle ${hm(run.start)}${run.ot ? ' <span class="tag ot">Straordinario</span>' : ''}</div><div class="jobline">${jobHead(J(run.jobId))}</div>
    <div class="clock" data-tick="${run.start}">${hms(now - run.start)}</div>
    ${S.wt.length ? `<div style="margin:0 0 12px"><label for="rt">Tipo di lavoro</label>${typeSelect(run, false, 'rt')}</div>` : ''}
    ${!run.ot && rd ? `<p class="note" style="margin:0 0 10px">Il timer si ferma da solo alle ${rd}. Per continuare dopo, avvia lo straordinario.</p>` : ''}
    <div class="row"><div style="flex:2 1 200px"><label for="rp">Ricambi (uno per riga)</label><textarea id="rp" data-in="segf" data-f="parts" data-s="${run.id}" placeholder="es. Filtro olio ×1">${esc(run.parts)}</textarea></div>
    <div style="flex:2 1 200px"><label for="rn">Note</label><textarea id="rn" data-in="segf" data-f="note" data-s="${run.id}">${esc(run.note)}</textarea></div></div>
    ${rescueBlock(run)}
    ${jobInfo(J(run.jobId)) ? `<details class="jd" data-k="jd"${dOpen('jd', false)}><summary>Scheda del lavoro</summary>${jobInfo(J(run.jobId))}</details>` : ''}
    <div class="btns"><button class="btn big steel" data-act="pause">Pausa</button><button class="btn big stop" data-act="stop">Stop</button></div></section>`;
  } else if (run) {
    const j = J(run.jobId);
    main = `<section class="card run brk"><div class="note">In pausa dalle ${hm(run.start)}${run.ot ? ' <span class="tag ot">Straordinario</span>' : ''}</div>${j ? `<div class="jobline mut">Lavoro in sospeso: ${jobHead(j)}</div>` : ''}
    <div class="clock" data-tick="${run.start}">${hms(now - run.start)}</div>
    <div class="btns ${j ? '' : 'one'}">${j ? '<button class="btn big" data-act="resume">Riprendi</button>' : ''}<button class="btn big stop" data-act="stop">${j ? 'Fine giornata' : 'Fine pausa'}</button></div></section>`;
  } else {
    const sj = J(S.sel), needT = !!(sj && sj.type !== 'gen' && S.wt.length), ph = pastHard();
    if (ph) main = `<section class="card"><h2>Giornata chiusa</h2><p>Dopo le ${S.hard} i timer non si possono più avviare. Compila ora le ore per commessa.</p><div class="btns one"><button class="btn big" data-act="gohours">Apri la tabella ore</button></div></section>`;
    else main = `<section class="card"><h2>Scegli il lavoro</h2>
    ${out ? `<div class="warn" role="status">${dh ? `Siamo fuori dall'orario dell'officina (${slotTxt(dh)}).` : "Oggi l'officina è chiusa."} Il tempo che avvii ora sarà registrato come <b>straordinario</b>${S.hard ? `; alle ${S.hard} tutti i timer si fermano da soli` : ''}.</div>` : ''}
    <label for="jq">Codice, targa o codice a barre</label><div class="bcrow"><input id="jq" data-live="jq" value="${esc(S.jq)}" placeholder="Digita o scansiona, poi Invio" autocomplete="off"><button class="btn sec" data-act="scanw">Scansiona</button></div>
    <div class="pick" id="joblist">${jobListHtml()}</div>${jobInfo(sj)}
    ${needT ? `<div style="margin-top:12px"><label for="wts">Tipo di lavoro</label><select id="wts" class="tsel" data-in="wt"><option value="">Scegli il tipo…</option>${S.wt.map(t => `<option value="${t.id}" ${S.typeSel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
    <div class="btns ${out ? 'one' : ''}" style="margin-top:14px"><button class="btn big ${out ? 'amber' : ''}" data-act="start" ${sj && (!needT || S.typeSel) ? '' : 'disabled'}>${!sj ? 'Scegli un lavoro' : needT && !S.typeSel ? 'Scegli il tipo di lavoro' : (out ? 'Avvia straordinario' : 'Avvia')}</button>${out ? '' : '<button class="btn big steel" data-act="startbreak">Pausa</button>'}</div></section>`;
  }
  return alertsHtml() + main + `<div class="sumline"><span>Lavorato oggi <b>${hhmm(t.w)}</b></span>${otSum(t)}<span>Pause <b>${hhmm(t.b)}</b></span></div>`;
}
function workerToday() {
  const segs = todaySegs().sort((a, b) => a.start - b.start), t = totals(segs), now = nowMs();
  return `<div class="sumline"><span>Lavorato <b>${hhmm(t.w)}</b></span>${otSum(t)}<span>Pause <b>${hhmm(t.b)}</b></span></div>
  ${segs.length ? segs.map(s => `<div class="seg ${s.kind === 'break' ? 'brk' : ''}"><div class="t"><span>${hm(s.start)} – ${s.end ? hm(s.end) : 'in corso'}</span><span class="d">${hhmm((s.end || now) - s.start)}</span></div>
  <div>${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}${s.ot ? ' <span class="tag ot">Straordinario</span>' : ''}${s.auto ? ' <span class="tag s">Fermato a fine orario</span>' : ''}</div>
  ${s.kind === 'work' && S.wt.length ? `<div style="margin-top:8px">${typeSelect(s, false)}</div>` : ''}
  ${s.kind === 'work' ? `<div class="row" style="margin-top:8px"><div><label for="p${s.id}">Ricambi</label><textarea id="p${s.id}" rows="2" data-in="segf" data-f="parts" data-s="${s.id}">${esc(s.parts)}</textarea></div><div><label for="n${s.id}">Note</label><textarea id="n${s.id}" rows="2" data-in="segf" data-f="note" data-s="${s.id}">${esc(s.note)}</textarea></div></div>${rescueBlock(s)}` : ''}</div>`).join('') : '<div class="empty">Nessun tempo registrato oggi. Avvia un lavoro dalla scheda Timer.</div>'}
  <p class="note">Se hai dimenticato di avviare o fermare un timer, avvisa il titolare: può correggere gli orari dal report.</p>${pushCard()}`;
}
const dayName = d => new Date(d + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
function pendingDays() {          // giorni recenti con lavoro registrato e tabella non ancora inviata
  const have = new Set(S.days.map(d => d.day)), today = S.today || dstr(nowMs());
  return [...new Set(S.segs.filter(x => x.kind === 'work' && x.end).map(x => dstr(x.start)))].filter(d => d < today && !have.has(d)).sort();
}
function tblGet() {
  const day = (S.tbl && S.tbl.day) || S.today || dstr(nowMs());
  if (!S.tbl || S.tbl.init !== day) { const sub = S.days.find(d => d.day === day), vals = {}; if (sub) sub.entries.forEach(e => { vals[e.cc] = fmtM(e.minutes); }); S.tbl = { day, init: day, vals }; }
  return S.tbl;
}
function tblSum() { const T = tblGet(); let t = 0; for (const v of Object.values(T.vals)) { const m = parseH(v); if (m > 0) t += m; } return t; }
function tblTotalHtml() {
  const T = tblGet(), t = tblSum(), tm = Math.round(totals(S.segs.filter(x => dstr(x.start) === T.day)).w / 60000), diff = t - tm;
  return `Totale inserito <b>${fmtM(t)}</b>${tm ? ` · timer ${fmtM(tm)}` : ''}${tm && Math.abs(diff) >= 30 ? ` <span class="tag ot">${diff > 0 ? '+' : '−'}${fmtM(Math.abs(diff))} rispetto al timer</span>` : ''}`;
}
function workerHours() {
  const T = tblGet(), sub = S.days.find(d => d.day === T.day), locked = !!(sub && sub.confirmed_at), today = S.today || dstr(nowMs());
  const from = dstr(Date.parse(today + 'T12:00') - 7 * 864e5);
  const opts = [...new Set([today, ...pendingDays(), ...S.days.filter(d => d.day >= from).map(d => d.day), T.day])].sort().reverse();
  const list = [...S.cc];
  (sub ? sub.entries : []).forEach(e => { if (!list.some(c => c.id === e.cc)) list.push({ id: e.cc, code: e.code, name: e.name }); });
  const pend = pendingDays().filter(d => d !== T.day);
  return `${pend.length ? `<div class="warn" role="status">Hai ${pend.length === 1 ? 'un giorno' : pend.length + ' giorni'} senza tabella ore: ${pend.map(d => `<button class="linkb" data-act="goday" data-d="${d}">${dayName(d)}</button>`).join(', ')}.</div>` : ''}
  <section class="card"><h2>Ore per commessa</h2>
  <p class="note" style="margin-top:0">A fine giornata scrivi quante ore hai fatto su ogni commessa. Puoi scrivere <b>1:30</b> oppure <b>1,5</b>. Lascia vuote le commesse che non hai fatto.</p>
  <label for="tday">Giorno</label><select id="tday" data-in="tday">${opts.map(d => `<option value="${d}" ${d === T.day ? 'selected' : ''}>${d === today ? 'Oggi · ' : ''}${dayName(d)}</option>`).join('')}</select>
  ${locked ? '<div class="okbox" role="status"><b>Confermato dal titolare.</b> Per correggere chiedi al titolare di riaprire la giornata.</div>' : sub ? `<p class="note">Inviata il ${new Date(sub.submitted_at).toLocaleDateString('it-IT')} alle ${hm(Date.parse(sub.submitted_at))}. In attesa di conferma del titolare${T.day >= today ? ' (da domani)' : ''}. Puoi ancora modificarla.</p>` : ''}
  <div class="hgrid">${list.map(c => `<div class="hrow"><label for="h_${c.id}"><b>${esc(c.code)}</b> ${esc(c.name)}</label><input id="h_${c.id}" inputmode="decimal" autocomplete="off" placeholder="0:00" data-live="tb" data-c="${c.id}" value="${esc(T.vals[c.id] || '')}" ${locked ? 'disabled' : ''}></div>`).join('') || '<div class="empty">Nessuna commessa: il titolare le aggiunge da Anagrafiche.</div>'}</div>
  <div class="tbltot" id="tbltot">${tblTotalHtml()}</div>
  ${locked ? '' : `<div class="btns one" style="margin-top:12px"><button class="btn big" data-act="saveday">${sub ? 'Aggiorna le ore' : 'Invia le ore'}</button></div>`}</section>
  <section class="card"><h2>Le mie ore inserite</h2>
  ${S.days.length ? S.days.map(d => `<div class="hist"><div class="hh"><b>${dayName(d.day)}</b><span class="chip ${d.confirmed_at ? 'ok' : 'wait'}">${d.confirmed_at ? 'Confermato' : 'In attesa'}</span><span class="ht">${fmtM(d.entries.reduce((a, e) => a + e.minutes, 0))}</span></div>
    <div class="hl">${d.entries.map(e => `<span>${esc(e.code)} ${esc(e.name)} <b>${fmtM(e.minutes)}</b></span>`).join('')}</div></div>`).join('') : '<div class="empty">Non hai ancora inserito ore. Comincia stasera.</div>'}
  <p class="note" style="margin-bottom:0">Qui vedi sempre quello che hai inserito e se il titolare lo ha confermato.</p></section>`;
}
function pushCard() {
  if (!pushOk()) return '';
  if (S.pushOn) return `<div class="card"><h2>Notifiche attive</h2><p class="note" style="margin-top:0">Questo telefono riceve un avviso quando un timer viene fermato e il promemoria per compilare le ore.</p><button class="btn sec" data-act="pushoff">Disattiva notifiche</button></div>`;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  return `<div class="card"><h2>Notifiche</h2><p class="note" style="margin-top:0">Ricevi un avviso sul telefono quando un timer viene fermato a fine orario, anche con l'app chiusa.${ios ? ' Su iPhone aggiungi prima l\'app alla schermata Home e aprila da lì.' : ''}</p><button class="btn" data-act="pushon" ${ios ? 'disabled' : ''}>Attiva notifiche</button></div>`;
}

/* ----- titolare ----- */
function ownerShell() {
  const body = { report: ownerReport, confirm: ownerConfirm, analysis: ownerAnalysis, jobs: ownerJobs, people: ownerPeople }[S.tab]();
  const today = S.o.today || dstr(nowMs()), np = S.o.subs.filter(x => !x.confirmed_at && x.day < today).length;
  return header() + `<main class="wide">${offlineBanner()}${body}</main>` + tabbar([['report', 'Report'], ['confirm', 'Ore' + (np ? ` <i class="bdg">${np}</i>` : '')], ['analysis', 'Analisi'], ['jobs', 'Lavori'], ['people', 'Anagrafiche']]);
}
function periodSegs() {
  const [from, to] = rangeOf();
  return S.o.segs.filter(s => { const d = dstr(s.start); return d >= from && d <= to; });
}
function aggPeople(segs, monthMode) {
  const out = {}, now = nowMs();
  for (const s of segs) {
    const date = dstr(s.start);
    const p = out[s.wid] ??= { jobs: {}, work: 0, ot: 0, brk: 0, byDay: {}, byDayOt: {}, types: {}, first: Infinity, last: 0, running: false };
    const ms = Math.max(0, (s.end || now) - s.start);
    if (!s.end) p.running = true;
    p.first = Math.min(p.first, s.start); p.last = Math.max(p.last, s.end || now);
    if (s.kind === 'break') { p.brk += ms; continue; }
    p.work += ms; p.byDay[date] = (p.byDay[date] || 0) + ms;
    const j = p.jobs[s.jobId || 'none'] ??= { ms: 0, ot: 0, parts: [], notes: [], rescues: [], types: {} };
    const om = otMs(s, now); if (om) { p.ot += om; p.byDayOt[date] = (p.byDayOt[date] || 0) + om; j.ot += om; }
    const tk = s.wt || '-'; p.types[tk] = (p.types[tk] || 0) + ms; j.types[tk] = (j.types[tk] || 0) + ms;
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
    const ms = Math.max(0, (s.end || now) - s.start), a = out[s.jobId || 'none'] ??= { ms: 0, ot: 0, byW: {}, byWot: {}, types: {}, parts: [], notes: [], rescues: [] }, who = (W(s.wid) || {}).name || '?';
    a.ms += ms; a.byW[s.wid] = (a.byW[s.wid] || 0) + ms;
    const tk = s.wt || '-'; a.types[tk] = (a.types[tk] || 0) + ms;
    const om = otMs(s, now); if (om) { a.ot += om; a.byWot[s.wid] = (a.byWot[s.wid] || 0) + om; }
    if (s.parts) a.parts.push(...s.parts.split('\n').map(x => x.trim()).filter(Boolean).map(x => x + ' (' + who + ')'));
    if (s.note) a.notes.push(who + ': ' + s.note);
    if (s.rescues.length) a.rescues.push(who + ': ' + s.rescues.join(', '));
  }
  return out;
}
const kpi = (l, v, sub) => `<div class="kpi"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const typeChips = types => Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, ms]) => `<span class="tc">${k === '-' ? 'Tipo non indicato' : esc(wtName(k))} <b>${hhmm(ms)}</b></span>`).join('');
function ownerReport() {
  const r = S.rep, segs = periodSegs(), now = nowMs();
  const label = r.mode === 'day' ? new Date(r.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : new Date(r.month + '-01T12:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const people = aggPeople(segs, r.mode === 'month');
  const totOt = Object.values(people).reduce((a, p) => a + p.ot, 0);
  const total = Object.values(people).reduce((a, p) => a + p.work, 0), brk = Object.values(people).reduce((a, p) => a + p.brk, 0);
  const njobs = new Set(segs.filter(s => s.kind === 'work' && s.jobId).map(s => s.jobId)).size;
  const running = S.o.segs.filter(s => !s.end);
  const resc = segs.filter(s => s.rescues.length);
  return `${running.length ? `<div class="card"><h2>In corso adesso</h2>${running.map(s => `<div class="live"><span><b>${esc((W(s.wid) || {}).name || '?')}</b> ${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}${s.ot ? ' <span class="tag ot">Straordinario</span>' : ''}</span><span class="c" data-tick="${s.start}">${hms(now - s.start)}</span></div>`).join('')}</div>` : ''}
  <div class="card noprint"><div class="row" style="align-items:center">
  <div class="seggroup" style="flex:0 0 auto"><button data-act="rmode" data-v="day" aria-pressed="${r.mode === 'day'}">Giornaliero</button><button data-act="rmode" data-v="month" aria-pressed="${r.mode === 'month'}">Mensile</button></div>
  <div class="seggroup" style="flex:0 0 auto"><button data-act="rby" data-v="person" aria-pressed="${r.by === 'person'}">Per persona</button><button data-act="rby" data-v="job" aria-pressed="${r.by === 'job'}">Per lavoro</button></div>
  <div>${r.mode === 'day' ? `<input type="date" id="rd" data-in="rd" value="${r.date}" aria-label="Data">` : `<input type="month" id="rm" data-in="rm" value="${r.month}" aria-label="Mese">`}</div>
  <button class="btn sec" data-act="csv" style="flex:0 0 auto">Esporta CSV</button><button class="btn sec" data-act="print" style="flex:0 0 auto">Stampa</button></div></div>
  <h2 class="rtitle" style="text-transform:capitalize">${label}</h2>
  <div class="kpis">${kpi('Ore lavorate', hhmm(total))}${kpi('Straordinario', hhmm(totOt))}${kpi('Pause', hhmm(brk))}${kpi(r.by === 'person' ? 'Persone' : 'Lavori', r.by === 'person' ? Object.keys(people).length : njobs)}</div>
  ${resc.length ? `<div class="card"><span class="tag r">Soccorso stradale</span> ${resc.map(s => `${esc((W(s.wid) || {}).name || '?')} su ${esc(jobText(J(s.jobId)))} (${esc(s.rescues.join(', '))}${r.mode === 'month' ? ', ' + ddmm(dstr(s.start)) : ''})`).join(' · ')}</div>` : ''}
  ${segs.length ? (r.by === 'person' ? reportByPerson(people, segs) : reportByJob(segs)) : '<div class="empty" style="margin-top:12px">Nessun tempo registrato in questo periodo.</div>'}`;
}
function ccBlock(wid) {
  const r = S.rep, [from, to] = rangeOf(), today = S.o.today || dstr(nowMs());
  const subs = S.o.subs.filter(x => x.worker_id === wid && x.day >= from && x.day <= to);
  const head = (chip) => `<h4>Ore per commessa ${chip}</h4>`;
  if (!subs.length) return `<div class="bsec">${head(r.mode === 'day' && r.date >= today ? '<span class="chip wait">Non ancora compilata</span>' : '<span class="chip no">Non compilata</span>')}</div>`;
  const sum = {}; let tot = 0;
  subs.forEach(x => x.entries.forEach(e => { sum[e.cc] = (sum[e.cc] || 0) + e.minutes; tot += e.minutes; }));
  const conf = subs.filter(x => x.confirmed_at).length;
  let chip, btn = '';
  if (r.mode === 'day') {
    const x = subs[0];
    chip = x.confirmed_at ? '<span class="chip ok">Confermato</span>' : x.day < today ? '<span class="chip wait">Da confermare</span>' : '<span class="chip wait">Inviata · si conferma da domani</span>';
    btn = x.confirmed_at ? `<button class="btn sec sm" data-act="reopen" data-w="${wid}" data-d="${x.day}">Riapri</button>` : x.day < today ? `<button class="btn sm" data-act="confirm1" data-w="${wid}" data-d="${x.day}">Conferma</button>` : '';
  } else chip = `<span class="chip ${conf === subs.length ? 'ok' : 'wait'}">${conf}/${subs.length} giorni confermati</span>`;
  const rows = Object.entries(sum).sort((a, b) => b[1] - a[1]);
  return `<div class="bsec">${head(chip)}<div class="ccg">${rows.map(([id, m]) => `<div class="ccb"><span>${esc(ccLabel(S.o.cc.find(c => c.id === id)))}</span><b>${fmtM(m)}</b></div>`).join('')}</div>
  <div class="cmp">Tabella <b>${fmtM(tot)}</b>${btn ? ' ' + btn : ''}</div></div>`;
}
function reportByPerson(people, segs) {
  const r = S.rep, ids = Object.keys(people).sort((a, b) => byName(W(a) || {}, W(b) || {}));
  return ids.map(id => {
    const p = people[id], name = (W(id) || {}).name || '(operaio eliminato)', days = Object.keys(p.byDay).length;
    const rows = Object.entries(p.jobs).sort((a, b) => b[1].ms - a[1].ms);
    return `<section class="box"><div class="bh"><div><h3 class="pn">${esc(name)}</h3><div class="meta">${r.mode === 'day' ? `${hm(p.first)} – ${p.running ? 'in corso' : hm(p.last)}` : `${days} giorni`} · pause ${hhmm(p.brk)}</div></div>
    <div class="bt"><b>${hhmm(p.work)}</b><small>ore lavorate</small>${p.ot ? `<span class="tag ot">straordinario ${hhmm(p.ot)}</span>` : ''}</div></div>
    ${Object.keys(p.types).length > 1 || !p.types['-'] ? `<div class="tcs">${typeChips(p.types)}</div>` : ''}
    <div class="bb">${rows.map(([jid, x]) => `<div class="jr"><div class="jm">${jobHead(J(jid))}</div><div class="jh"><b>${hhmm(x.ms)}</b>${x.ot ? `<span class="otl">str. ${hhmm(x.ot)}</span>` : ''}</div>
      ${Object.keys(x.types).some(k => k !== '-') ? `<div class="jx">${typeChips(x.types)}</div>` : ''}
      ${x.rescues.length ? `<div class="jx"><span class="tag r">Soccorso</span> ${esc(x.rescues.join(' · '))}</div>` : ''}
      ${x.parts.length ? `<div class="jx"><span class="lb">Ricambi</span> ${nl(x.parts.join('\n'))}</div>` : ''}${x.notes.length ? `<div class="jx"><span class="lb">Note</span> ${nl(x.notes.join('\n'))}</div>` : ''}</div>`).join('') || '<div class="mut" style="padding:8px 0">Solo pause registrate.</div>'}</div>
    ${ccBlock(id)}
    ${r.mode === 'month' ? `<details data-k="days:${id}"${dOpen('days:' + id, false)}><summary>Ore per giorno</summary><div class="wrapx"><table>${Object.entries(p.byDay).sort().map(([d, ms]) => `<tr><td>${ddmm(d)}</td><td class="n">${hhmm(ms)}${p.byDayOt[d] ? ` <span class="otl">(str. ${hhmm(p.byDayOt[d])})</span>` : ''}</td></tr>`).join('')}</table></div></details>` : fixPanel(id, r.date, segs.filter(s => s.wid === id))}</section>`;
  }).join('');
}
function fixPanel(wid, date, list) {
  const segs = [...list].sort((a, b) => a.start - b.start);
  return `<details data-k="fix:${wid}"${dOpen('fix:' + wid, false)}><summary>Correggi orari</summary>
  ${segs.map(s => `<div class="fix"><span>${s.kind === 'break' ? '<span class="tag s">Pausa</span>' : jobHead(J(s.jobId))}${s.auto ? ' <span class="tag s">fermato a fine orario</span>' : ''}${s.kind === 'work' ? `<br><label class="chk sm"><input type="checkbox" data-in="segot" data-s="${s.id}" ${s.ot ? 'checked' : ''}> Straordinario</label>${S.o.wt.length ? `<br>${typeSelect(s, true)}` : ''}` : ''}</span>
  <input type="time" aria-label="Inizio" data-in="segtime" data-s="${s.id}" data-d="${date}" data-which="start" value="${hm(s.start)}">
  <input type="time" aria-label="Fine" data-in="segtime" data-s="${s.id}" data-d="${date}" data-which="end" value="${s.end ? hm(s.end) : ''}">
  <button class="btn del" data-act="delseg" data-s="${s.id}">${S.confirm === 'seg:' + s.id ? 'Conferma' : 'Elimina'}</button></div>`).join('')}
  <h3 style="font-size:19px;margin:14px 0 6px">Aggiungi tempo manuale</h3>
  <div class="row"><div><label for="ak_${wid}">Tipo</label><select id="ak_${wid}"><option value="work">Lavoro</option><option value="break">Pausa</option></select></div>
  <div style="flex:2 1 200px"><label for="aj_${wid}">Lavoro</label><select id="aj_${wid}"><option value="">Scegli…</option>${S.jobs.map(j => `<option value="${j.id}">${esc(jobText(j))}</option>`).join('')}</select></div>
  <div><label for="at_${wid}">Tipo di lavoro</label><select id="at_${wid}"><option value="">Non indicato</option>${S.o.wt.filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
  <div><label for="ao_${wid}">Fascia</label><select id="ao_${wid}"><option value="0">Ordinario</option><option value="1">Straordinario</option></select></div>
  <div><label for="as_${wid}">Inizio</label><input id="as_${wid}" type="time"></div><div><label for="ae_${wid}">Fine</label><input id="ae_${wid}" type="time"></div>
  <button class="btn sec" data-act="addseg" data-w="${wid}" data-d="${date}">Aggiungi</button></div></details>`;
}
function reportByJob(segs) {
  const agg = aggJobs(segs);
  return Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms).map(([jid, a]) => `<section class="box"><div class="bh"><div class="jm big">${jobHead(J(jid))}</div><div class="bt"><b>${hhmm(a.ms)}</b><small>ore sul lavoro</small>${a.ot ? `<span class="tag ot">straordinario ${hhmm(a.ot)}</span>` : ''}</div></div>
  ${Object.keys(a.types).some(k => k !== '-') ? `<div class="tcs">${typeChips(a.types)}</div>` : ''}
  <div class="bb">${Object.entries(a.byW).sort((x, y) => y[1] - x[1]).map(([w, ms]) => `<div class="jr"><div class="jm"><b>${esc((W(w) || {}).name || '?')}</b></div><div class="jh"><b>${hhmm(ms)}</b>${a.byWot[w] ? `<span class="otl">str. ${hhmm(a.byWot[w])}</span>` : ''}</div></div>`).join('')}
  ${a.rescues.length ? `<div class="jx"><span class="tag r">Soccorso</span> ${esc(a.rescues.join(' · '))}</div>` : ''}
  ${a.parts.length ? `<div class="jx"><span class="lb">Ricambi</span> ${nl(a.parts.join('\n'))}</div>` : ''}${a.notes.length ? `<div class="jx"><span class="lb">Note</span> ${nl(a.notes.join('\n'))}</div>` : ''}</div></section>`).join('') || '<div class="empty">Nessun lavoro in questo periodo.</div>';
}
/* ----- conferme ore per commessa ----- */
const subKey = x => x.worker_id + '|' + x.day;
const subMin = x => x.entries.reduce((a, e) => a + e.minutes, 0);
function ownerConfirm() {
  const today = S.o.today || dstr(nowMs()), [from, to] = rangeOf(), r = S.rep;
  const label = new Date(r.month + '-01T12:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const pend = S.o.subs.filter(x => !x.confirmed_at && x.day < today).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : byName(W(a.worker_id) || {}, W(b.worker_id) || {}));
  const todayS = S.o.subs.filter(x => !x.confirmed_at && x.day >= today);
  const done = S.o.subs.filter(x => x.confirmed_at && x.day >= from && x.day <= to).sort((a, b) => a.day < b.day ? 1 : -1);
  const have = new Set(S.o.subs.map(subKey)), miss = new Set();
  S.o.segs.forEach(s => { const d = dstr(s.start); if (s.kind === 'work' && s.end && d < today && d >= from && d <= to && !have.has(s.wid + '|' + d)) miss.add(s.wid + '|' + d); });
  const entries = x => x.entries.map(e => `<span>${esc(ccLabel(S.o.cc.find(c => c.id === e.cc)))} <b>${fmtM(e.minutes)}</b></span>`).join('');
  const timerMin = x => Math.round(S.o.segs.filter(s => s.wid === x.worker_id && s.kind === 'work' && dstr(s.start) === x.day).reduce((a, s) => a + Math.max(0, (s.end || nowMs()) - s.start), 0) / 60000);
  const nsel = pend.filter(x => S.csel[subKey(x)]).length;
  const row = (x, withBox) => { const t = timerMin(x), m = subMin(x), df = m - t; return `<div class="crow">${withBox ? `<label class="cbox"><input type="checkbox" data-in="csel" data-k="${subKey(x)}" ${S.csel[subKey(x)] ? 'checked' : ''} aria-label="Seleziona"></label>` : ''}
    <div class="cm"><div class="ch"><b>${esc((W(x.worker_id) || {}).name || '?')}</b> <span class="mut">${dayName(x.day)}</span></div><div class="hl">${entries(x)}</div>
    <div class="cmp">Tabella <b>${fmtM(m)}</b>${t ? ` · timer ${fmtM(t)}${Math.abs(df) >= 30 ? ` <span class="tag ot">${df > 0 ? '+' : '−'}${fmtM(Math.abs(df))}</span>` : ''}` : ''}</div></div>
    <div class="ca">${x.confirmed_at ? `<button class="btn sec sm" data-act="reopen" data-w="${x.worker_id}" data-d="${x.day}">Riapri</button>` : x.day < today ? `<button class="btn sm" data-act="confirm1" data-w="${x.worker_id}" data-d="${x.day}">Conferma</button>` : ''}</div></div>`; };
  return `<div class="card"><div class="row" style="align-items:center"><h2 style="flex:1 1 auto;margin:0">Conferma ore per commessa</h2><div><input type="month" id="rm" data-in="rm" value="${r.month}" aria-label="Mese"></div></div>
  <p class="note" style="margin-bottom:0">Gli operai compilano la tabella a fine giornata. Dal giorno successivo puoi confermarla: da quel momento non possono più modificarla (puoi sempre riaprirla).</p></div>
  <section class="box"><div class="bh"><div><h3 class="pn">Da confermare</h3><div class="meta">${pend.length ? pend.length + ' tabelle' : 'Tutto confermato'}</div></div>
  ${pend.length ? `<div class="bt"><button class="btn sm sec" data-act="selall">Seleziona tutte</button> <button class="btn sm" data-act="confsel" ${nsel ? '' : 'disabled'}>Conferma selezionate (${nsel})</button></div>` : ''}</div>
  <div class="bb">${pend.map(x => row(x, true)).join('') || '<div class="mut" style="padding:8px 0">Nessuna tabella in attesa.</div>'}</div></section>
  ${miss.size ? `<section class="box"><div class="bh"><div><h3 class="pn">Non compilate</h3><div class="meta">Giorni di ${label} con timer ma senza tabella</div></div></div><div class="bb">${[...miss].sort().reverse().map(k => { const [w, d] = k.split('|'); return `<div class="crow"><div class="cm"><b>${esc((W(w) || {}).name || '?')}</b> <span class="mut">${dayName(d)}</span></div><span class="chip no">manca</span></div>`; }).join('')}</div></section>` : ''}
  ${todayS.length ? `<section class="box"><div class="bh"><div><h3 class="pn">Inviate oggi</h3><div class="meta">Si potranno confermare da domani</div></div></div><div class="bb">${todayS.map(x => row(x, false)).join('')}</div></section>` : ''}
  <section class="box"><div class="bh"><div><h3 class="pn">Confermate</h3><div class="meta" style="text-transform:capitalize">${label}</div></div><div class="bt"><button class="btn sm sec" data-act="csvcc">Esporta CSV</button></div></div>
  <div class="bb">${done.map(x => row(x, false)).join('') || '<div class="mut" style="padding:8px 0">Nessuna tabella confermata in questo mese.</div>'}</div></section>`;
}
/* ----- analisi ----- */
function ownerAnalysis() {
  const now = nowMs(), [from, to] = rangeOf(), today = S.o.today || dstr(nowMs());
  const all = periodSegs(), work = all.filter(s => s.kind === 'work' && s.jobId);
  const names = { m1: 'Questo mese', m3: 'Ultimi 3 mesi', m6: 'Ultimi 6 mesi', y: 'Ultimo anno' };
  // per tipo di lavoro
  const T = {};
  for (const s of work) { const k = s.wt || '-', ms = Math.max(0, (s.end || now) - s.start), t = T[k] ??= { ms: 0, jobs: new Set(), w: {} }, w = t.w[s.wid] ??= { ms: 0, jobs: new Set() }; t.ms += ms; t.jobs.add(s.jobId); w.ms += ms; w.jobs.add(s.jobId); }
  const tkeys = Object.keys(T).sort((a, b) => T[b].ms - T[a].ms);
  const typeBoxes = tkeys.map(k => {
    const t = T[k], ws = Object.entries(t.w).sort((a, b) => b[1].ms / b[1].jobs.size - a[1].ms / a[1].jobs.size);
    const sumJ = ws.reduce((a, [, w]) => a + w.jobs.size, 0), team = sumJ ? t.ms / sumJ : 0;
    return `<section class="box"><div class="bh"><div><h3 class="pn">${k === '-' ? 'Tipo non indicato' : esc(wtName(k))}</h3><div class="meta">${t.jobs.size} lavori · ${hhmm(t.ms)} in totale</div></div><div class="bt"><b>${hhmm(t.ms / t.jobs.size)}</b><small>tempo medio per lavoro</small></div></div>
    <div class="bb">${ws.map(([wid, w]) => { const avg = w.ms / w.jobs.size, d = team && ws.length > 1 && w.jobs.size >= 2 ? Math.round((avg / team - 1) * 100) : null;
      return `<div class="jr"><div class="jm"><b>${esc((W(wid) || {}).name || '?')}</b> <span class="mut">${w.jobs.size} ${w.jobs.size === 1 ? 'lavoro' : 'lavori'}</span></div><div class="jh"><b>${hhmm(avg)}</b>${d === null ? '<span class="otl">—</span>' : `<span class="dl ${d <= -8 ? 'fast' : d >= 8 ? 'slow' : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}% vs media</span>`}</div></div>`; }).join('')}</div></section>`;
  }).join('');
  // ore per commessa (tabelle)
  const subs = S.o.subs.filter(x => x.day >= from && x.day <= to), C = {};
  subs.forEach(x => x.entries.forEach(e => { const c = C[e.cc] ??= { m: 0, conf: 0, w: {} }; c.m += e.minutes; if (x.confirmed_at) c.conf += e.minutes; c.w[x.worker_id] = (c.w[x.worker_id] || 0) + e.minutes; }));
  const ckeys = Object.keys(C).sort((a, b) => C[b].m - C[a].m), cmax = ckeys.length ? C[ckeys[0]].m : 1, ctot = ckeys.reduce((a, k) => a + C[k].m, 0);
  // persone
  const P = {};
  for (const s of all) { const p = P[s.wid] ??= { w: 0, b: 0, ot: 0, days: new Set(), tdays: 0 }; const ms = Math.max(0, (s.end || now) - s.start); if (s.kind === 'break') p.b += ms; else { p.w += ms; p.ot += otMs(s, now); p.days.add(dstr(s.start)); } }
  const sk = new Set(subs.map(subKey));
  Object.entries(P).forEach(([wid, p]) => { p.tm = subs.filter(x => x.worker_id === wid).reduce((a, x) => a + subMin(x), 0); p.tdays = [...p.days].filter(d => sk.has(wid + '|' + d)).length; p.miss = [...p.days].filter(d => d < today && !sk.has(wid + '|' + d)).length;
    p.timerOn = Math.round(all.filter(s => s.wid === wid && s.kind === 'work' && sk.has(wid + '|' + dstr(s.start))).reduce((a, s) => a + Math.max(0, (s.end || now) - s.start), 0) / 60000); });
  const pk = Object.keys(P).sort((a, b) => byName(W(a) || {}, W(b) || {}));
  // lavori piu' lunghi
  const J2 = aggJobs(all), top = Object.entries(J2).filter(([k]) => k !== 'none').sort((a, b) => b[1].ms - a[1].ms).slice(0, 8);
  const avgJob = Object.keys(J2).length ? Object.values(J2).reduce((a, x) => a + x.ms, 0) / Object.keys(J2).filter(k => k !== 'none').length : 0;
  return `<div class="card noprint"><div class="seggroup">${Object.entries(names).map(([k, l]) => `<button data-act="an" data-v="${k}" aria-pressed="${S.an === k}">${l}</button>`).join('')}</div>
  <p class="note" style="margin:10px 0 0">Periodo: ${itDate(from)} – ${itDate(to)}. I tempi sono quelli dei timer, divisi per tipo di lavoro scelto all'avvio.</p></div>
  <div class="kpis">${kpi('Ore lavorate', hhmm(Object.values(P).reduce((a, p) => a + p.w, 0)))}${kpi('Lavori seguiti', new Set(work.map(s => s.jobId)).size)}${kpi('Tempo medio per lavoro', hhmm(top.length ? avgJob : 0), 'ore su ciascun lavoro')}${kpi('Ore in tabella', fmtM(ctot))}</div>
  <h2 class="rtitle">Efficienza per tipo di lavoro</h2>
  ${typeBoxes || '<div class="empty">Nessun lavoro nel periodo.</div>'}
  ${typeBoxes ? '<p class="note">La percentuale confronta il tempo medio della persona con la media dell\'officina per lo stesso tipo (compare solo con almeno 2 lavori): verde = più veloce, arancio = più lento. Servono molti lavori per un dato affidabile, e conta quanto i lavori sono simili tra loro.</p>' : ''}
  <h2 class="rtitle">Ore per commessa</h2>
  <section class="box"><div class="bb">${ckeys.map(k => { const c = C[k], cc = S.o.cc.find(x => x.id === k); return `<div class="barrow"><div class="bl"><span>${esc(ccLabel(cc))}</span><b>${fmtM(c.m)}</b></div><div class="pbar"><i style="width:${Math.max(2, Math.round(c.m / cmax * 100))}%"></i></div>
    <div class="hl">${Object.entries(c.w).sort((a, b) => b[1] - a[1]).map(([w, m]) => `<span>${esc((W(w) || {}).name || '?')} <b>${fmtM(m)}</b></span>`).join('')}${c.conf < c.m ? `<span class="mut">da confermare ${fmtM(c.m - c.conf)}</span>` : ''}</div></div>`; }).join('') || '<div class="mut" style="padding:8px 0">Nessuna tabella nel periodo.</div>'}</div></section>
  <h2 class="rtitle">Persone</h2>
  ${pk.map(w => { const p = P[w], dd = p.tm - p.timerOn; return `<section class="box"><div class="bh"><div><h3 class="pn">${esc((W(w) || {}).name || '?')}</h3><div class="meta">${p.days.size} giorni con timer${p.miss ? ` · <span class="warnt">${p.miss} senza tabella</span>` : ''}</div></div><div class="bt"><b>${hhmm(p.w)}</b><small>ore lavorate</small></div></div>
    <div class="stats">${kpi('Media al giorno', p.days.size ? hhmm(p.w / p.days.size) : '—')}${kpi('Straordinario', hhmm(p.ot))}${kpi('Pause', hhmm(p.b))}${kpi('Tabella ore', fmtM(p.tm), p.tdays && Math.abs(dd) >= 30 ? (dd > 0 ? '+' : '−') + fmtM(Math.abs(dd)) + ' vs timer' : p.tdays ? 'in linea col timer' : '')}</div></section>`; }).join('') || '<div class="empty">Nessun dato.</div>'}
  <h2 class="rtitle">Lavori che hanno richiesto più ore</h2>
  <section class="box"><div class="bb">${top.map(([jid, a]) => `<div class="jr"><div class="jm">${jobHead(J(jid))}</div><div class="jh"><b>${hhmm(a.ms)}</b></div>${Object.keys(a.types).some(k => k !== '-') ? `<div class="jx">${typeChips(a.types)}</div>` : ''}</div>`).join('') || '<div class="mut" style="padding:8px 0">Nessun lavoro nel periodo.</div>'}</div></section>`;
}
function draftForm() {
  const d = S.draft, fld = (k, label, ph, attrs) => `<div><label for="d_${k}">${label}</label><input id="d_${k}" data-live="dr" data-f="${k}" value="${esc(d[k])}" placeholder="${ph}" autocomplete="off" ${attrs || ''}></div>`;
  const extra = !!(d.sheet || d.customer || d.model || d.vin || d.km || d.due || d.request || d.id);
  return `<div class="row"><div style="flex:0 1 200px"><label for="d_kind">Tipo</label><select id="d_kind" data-live="dr" data-f="kind"><option value="veh" ${d.kind === 'veh' ? 'selected' : ''}>Veicolo</option><option value="gen" ${d.kind === 'gen' ? 'selected' : ''}>Generico (pulizia, varie…)</option></select></div>
  ${fld('code', 'Codice lavoro', 'es. 2776/2026')}${fld('plate', 'Targa', 'AB123CD', 'style="text-transform:uppercase"')}</div>
  <div class="row" style="margin-top:10px"><div style="flex:2 1 220px"><label for="d_barcode">Codice a barre</label><div class="bcrow"><input id="d_barcode" data-live="dr" data-f="barcode" value="${esc(d.barcode)}" placeholder="Scansiona o digita" autocomplete="off"><button class="btn sec" data-act="scanbc">Scansiona</button></div></div>
  <div style="flex:3 1 260px"><label for="d_desc">Descrizione</label><input id="d_desc" data-live="dr" data-f="desc" value="${esc(d.desc)}" placeholder="es. Tagliando + freni anteriori" autocomplete="off"></div></div>
  <details class="more" data-k="more"${dOpen('more', extra)}><summary>Dati della scheda (modello, cliente, km, lavoro richiesto)</summary>
  <div class="row" style="margin-top:10px">${fld('model', 'Veicolo', 'es. FIAT DUCATO 2.2 MULTIJET')}${fld('vin', 'Telaio', '', 'style="text-transform:uppercase"')}${fld('km', 'Km', '', 'inputmode="numeric"')}</div>
  <div class="row" style="margin-top:10px">${fld('customer', 'Cliente (solo titolare)', '')}${fld('sheet', 'Scheda n.', '')}<div><label for="d_due">Consegna prevista</label><input id="d_due" type="date" data-live="dr" data-f="due" value="${esc(d.due)}"></div></div>
  <div style="margin-top:10px"><label for="d_request">Lavoro richiesto</label><textarea id="d_request" rows="3" data-live="dr" data-f="request">${esc(d.request)}</textarea></div></details>
  ${d.file ? `<p class="note"><span class="tag">${d.file.kind === 'pdf' ? 'PDF' : 'Foto'}</span> ${esc(d.file.name)} verrà archiviato con il lavoro.</p>` : ''}
  <div class="btns" style="margin-top:12px"><button class="btn" data-act="savejob">${d.id ? 'Salva modifiche' : 'Aggiungi lavoro'}</button>${d.id || d.file || d.code || d.plate || d.barcode ? '<button class="btn sec" data-act="canceldraft">Annulla</button>' : ''}</div>`;
}
function ownerJobs() {
  return `<div class="card"><h2>Da scheda di accettazione</h2>
  <p class="note" style="margin-top:0">Carica il PDF della scheda: l'app legge codice a barre, targa, veicolo, km, consegna e lavoro richiesto e compila il lavoro qui sotto. Puoi anche caricare una foto: viene archiviata e l'app ne legge il codice a barre.</p>
  <label class="btn" for="impf">Carica PDF o foto</label><input id="impf" type="file" accept="application/pdf,image/*" data-in="imp" hidden>
  ${S.draft.note ? `<p class="note" role="status">${esc(S.draft.note)}</p>` : ''}</div>
  <div class="card"><h2>${S.draft.id ? 'Modifica lavoro' : 'Nuovo lavoro'}</h2>${draftForm()}</div>
  <div class="card"><div class="row" style="align-items:center"><h2 style="flex:1 1 auto;margin:0">Elenco lavori</h2><div style="flex:2 1 200px"><input id="jf" type="search" data-live="jf" placeholder="Cerca codice, targa, barcode…" value="${esc(S.jf)}"></div></div>
  <div id="jobsadmin">${jobsAdminList()}</div>
  <p class="note" style="margin-bottom:0">I lavori chiusi non compaiono agli operai ma restano nei report. Eliminare un lavoro lo toglie anche dai report già fatti e cancella i suoi documenti: di solito conviene chiuderlo. Gli operai vedono i dati del veicolo e il lavoro richiesto, non il cliente né i documenti.</p></div>`;
}
function filesHtml(j) {
  const fs = S.files[j.id];
  if (!fs) return '<p class="note">Caricamento…</p>';
  return (fs.length ? fs.map(f => `<div class="fl"><span><span class="tag">${f.kind === 'pdf' ? 'PDF' : 'Foto'}</span> ${esc(f.name)} <span class="mut">${Math.max(1, Math.round(f.size / 1024))} KB</span></span>
    <span class="acts"><button class="btn sec sm" data-act="openfile" data-f="${f.id}">Apri</button><button class="btn del sm" data-act="delfile" data-f="${f.id}" data-j="${j.id}">${S.confirm === 'file:' + f.id ? 'Conferma' : 'Elimina'}</button></span></div>`).join('') : '<p class="note">Nessun documento archiviato.</p>')
    + `<label class="btn sec sm" for="af_${j.id}">Aggiungi PDF o foto</label><input id="af_${j.id}" type="file" accept="application/pdf,image/*" data-in="addf" data-j="${j.id}" hidden>`;
}
function jobsAdminList() {
  const q = S.jf.toLowerCase();
  const list = S.jobs.filter(j => !q || (jobText(j) + ' ' + j.barcode + ' ' + j.customer + ' ' + j.model + ' ' + j.vin).toLowerCase().includes(q));
  return list.length ? list.map(j => `<div class="item"><div>${jobHead(j)}${j.barcode ? ` <span class="mut">▮ ${esc(j.barcode)}</span>` : ''}${j.open ? '' : ' <span class="tag">chiuso</span>'}${j.customer ? `<div class="mut" style="font-size:13px">${esc(j.customer)}</div>` : ''}</div>
  <div class="acts"><button class="btn sec sm" data-act="openjob" data-id="${j.id}" aria-expanded="${S.openJob === j.id}">Scheda${j.nfiles ? ' · ' + j.nfiles : ''}</button><button class="btn sec sm" data-act="editjob" data-id="${j.id}">Modifica</button><button class="btn sec sm" data-act="togjob" data-id="${j.id}">${j.open ? 'Chiudi' : 'Riapri'}</button><button class="btn del" data-act="deljob" data-id="${j.id}">${S.confirm === 'job:' + j.id ? 'Conferma' : 'Elimina'}</button></div></div>
  ${S.openJob === j.id ? `<div class="jpanel">${jobInfo(j, true) || '<p class="note" style="margin-top:0">Nessun dato di scheda inserito.</p>'}<h3 class="sub" style="margin:12px 0 6px">Documenti</h3>${filesHtml(j)}</div>` : ''}`).join('') : '<div class="empty" style="margin-top:10px">Nessun lavoro trovato.</div>';
}
function schedDraft() {
  const c = S.sched && S.sched.days ? S.sched : null, days = {};
  for (let i = 1; i <= 7; i++) {
    const x = c ? slotsOf(c.days[i]) : [];
    days[i] = x.length ? { on: true, af: x[0][0], at: x[0][1], bf: x[1] ? x[1][0] : '', bt: x[1] ? x[1][1] : '' }
                       : { on: !c && i <= 5, af: '08:00', at: '12:00', bf: '14:00', bt: '18:00' };
  }
  const hv = c && Object.prototype.hasOwnProperty.call(c, 'hard_stop') ? c.hard_stop : '19:00', rv = c && Object.prototype.hasOwnProperty.call(c, 'reminder') ? c.reminder : '17:50';
  return { en: !!(c && c.enabled), days, hs: hv, rm: rv };
}
function schedCard() {
  const d = S.sch ??= schedDraft();
  return `<div class="card"><h2>Orario dell'officina</h2>
  <label class="chk"><input type="checkbox" data-live="sch" data-f="en" ${d.en ? 'checked' : ''}> Ferma i timer a fine orario e registra lo straordinario</label>
  <p class="note">Con l'opzione attiva, alla fine dell'orario i timer si fermano da soli all'ora esatta e l'operaio riceve un avviso. Per continuare deve avviare lo straordinario, che nei report compare a parte. Nei giorni senza spunta l'officina è chiusa e tutto il lavoro è straordinario.</p>
  ${DAYNAMES.map((n, i) => { const k = i + 1, x = d.days[k], dis = x.on ? '' : 'disabled', t = (f, lab, v) => `<input type="time" aria-label="${n}, ${lab}" data-live="sch" data-f="${f}${k}" value="${v}" ${dis}>`;
    return `<div class="schedday"><label class="chk"><input type="checkbox" data-live="sch" data-f="on${k}" ${x.on ? 'checked' : ''}> ${n}${x.on ? '' : ' <span class="note" style="margin:0">chiuso</span>'}</label>
    <div class="slot"><span>Mattina</span>${t('af', 'mattina, inizio', x.af)}<i aria-hidden="true">–</i>${t('at', 'mattina, fine', x.at)}</div>
    <div class="slot"><span>Pomeriggio</span>${t('bf', 'pomeriggio, inizio', x.bf)}<i aria-hidden="true">–</i>${t('bt', 'pomeriggio, fine', x.bt)}</div></div>`; }).join('')}
  <p class="note">Per un orario continuato (senza pausa pranzo) lascia vuoto il pomeriggio: cancella i due orari.</p>
  <div class="row" style="margin-top:10px"><div><label for="s_hs">Stop di tutti i timer alle</label><input id="s_hs" type="time" data-live="sch" data-f="hs" value="${esc(d.hs)}"></div><div><label for="s_rm">Promemoria ore commesse alle</label><input id="s_rm" type="time" data-live="sch" data-f="rm" value="${esc(d.rm)}"></div></div>
  <p class="note">Allo stop (di norma 19:00) si fermano da soli anche i timer in straordinario, e dopo quell'ora non se ne possono avviare altri. Il promemoria arriva una volta al giorno agli operai che hanno usato i timer e non hanno ancora compilato la tabella. Lascia vuoto per non usarli.</p>
  <div class="btns one" style="margin-top:12px"><button class="btn" data-act="savesched">Salva orario</button></div></div>`;
}
function ownerPeople() {
  return `<div class="card"><h2>Operai</h2>
  <div class="row"><div style="flex:2 1 200px"><label for="nw">Nome e cognome</label><input id="nw"></div><div><label for="nwp">PIN (4–6 cifre)</label><input id="nwp" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div><button class="btn" data-act="addw">Aggiungi</button></div>
  ${S.o.workers.length ? S.o.workers.map(w => `<div class="item"><div>${esc(w.name)}${w.active ? '' : ' <span class="tag">disattivato</span>'}</div>
  <div class="acts"><input id="pp_${w.id}" type="password" inputmode="numeric" maxlength="6" placeholder="Nuovo PIN" aria-label="Nuovo PIN per ${esc(w.name)}"><button class="btn sec sm" data-act="setpin" data-id="${w.id}">Cambia PIN</button><button class="btn sec sm" data-act="togw" data-id="${w.id}">${w.active ? 'Disattiva' : 'Riattiva'}</button></div></div>`).join('') : '<div class="empty" style="margin-top:12px">Nessun operaio inserito.</div>'}</div>
  <div class="card"><h2>Mezzi soccorso stradale</h2><div class="row"><div><label for="nv">Nome mezzo</label><input id="nv" placeholder="es. Carro attrezzi 2"></div><button class="btn" data-act="addv">Aggiungi</button></div>
  ${S.vehicles.map(v => `<div class="item"><span>${esc(v)}</span><button class="btn del" data-act="delv" data-v="${esc(v)}">Elimina</button></div>`).join('')}</div>
  <div class="card"><h2>Commesse (tabella ore)</h2><p class="note" style="margin-top:0">Gli operai indicano a fine giornata le ore su ciascuna commessa attiva.</p>
  <div class="row"><div style="flex:0 1 130px"><label for="ncc_c">Codice</label><input id="ncc_c" placeholder="es. 20508" autocomplete="off"></div><div style="flex:2 1 200px"><label for="ncc_n">Nome</label><input id="ncc_n" placeholder="es. Gommista" autocomplete="off"></div><button class="btn" data-act="addcc">Aggiungi</button></div>
  ${S.o.cc.map(c => `<div class="item cfg ${c.active ? '' : 'off'}"><div class="cf"><input id="cc_c_${c.id}" value="${esc(c.code)}" aria-label="Codice" style="max-width:110px"><input id="cc_n_${c.id}" value="${esc(c.name)}" aria-label="Nome"></div>
  <div class="acts">${c.active ? '' : '<span class="tag">disattivata</span>'}<button class="btn sec sm" data-act="savecc" data-id="${c.id}">Salva</button><button class="btn sec sm" data-act="togcc" data-id="${c.id}">${c.active ? 'Disattiva' : 'Riattiva'}</button><button class="btn del" data-act="delcc" data-id="${c.id}">${S.confirm === 'cc:' + c.id ? 'Conferma' : 'Elimina'}</button></div></div>`).join('')}</div>
  <div class="card"><h2>Tipi di lavoro</h2><p class="note" style="margin-top:0">Si sceglie dal menù a tendina quando l'operaio avvia il timer. Servono per i report di efficienza.</p>
  <div class="row"><div style="flex:2 1 200px"><label for="nwt">Nuovo tipo</label><input id="nwt" placeholder="es. Diagnosi" autocomplete="off"></div><button class="btn" data-act="addwt">Aggiungi</button></div>
  ${S.o.wt.map(t => `<div class="item cfg ${t.active ? '' : 'off'}"><div class="cf"><input id="wt_n_${t.id}" value="${esc(t.name)}" aria-label="Nome"></div>
  <div class="acts">${t.active ? '' : '<span class="tag">disattivato</span>'}<button class="btn sec sm" data-act="savewt" data-id="${t.id}">Salva</button><button class="btn sec sm" data-act="togwt" data-id="${t.id}">${t.active ? 'Disattiva' : 'Riattiva'}</button><button class="btn del" data-act="delwt" data-id="${t.id}">${S.confirm === 'wt:' + t.id ? 'Conferma' : 'Elimina'}</button></div></div>`).join('')}</div>
  ${schedCard()}
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
  tab(b) { S.tab = b.dataset.t; S.confirm = ''; render(); if (S.role === 'owner' && ['analysis', 'confirm', 'report'].includes(S.tab)) refresh(); },
  /* timer */
  pick(b) { S.sel = S.sel === b.dataset.id ? '' : b.dataset.id; render(); },
  start() { if (!S.sel || S.segs.some(s => !s.end)) return; const jid = S.sel; S.sel = ''; S.jq = ''; const jb = J(jid), ty = jb && jb.type !== 'gen' ? S.typeSel || null : null; S.typeSel = ''; act2('w_start', { p_kind: 'work', p_job: jid, p_overtime: schedOn() && !inHours(nowMs()), p_type: ty }); },
  async startot(b) {
    const last = [...S.segs].reverse().find(x => x.jobId === b.dataset.job && x.wt), ok = await act2('w_start', { p_kind: 'work', p_job: b.dataset.job, p_overtime: true, p_type: last ? last.wt : null });
    if (ok) { S.alerts = S.alerts.filter(a => a.id !== b.dataset.id); render(); call('w_ack_alert', { p_id: b.dataset.id }).catch(() => {}); }
  },
  gohours(b) { S.tab = 'hours'; S.tbl = null; if (b.dataset.id) { S.alerts = S.alerts.filter(a => a.id !== b.dataset.id); call('w_ack_alert', { p_id: b.dataset.id }).catch(() => {}); } render(); },
  goday(b) { S.tbl = { day: b.dataset.d, init: '', vals: {} }; render(); },
  async saveday() {
    const T = tblGet(), items = []; let tot = 0;
    for (const [cc, v] of Object.entries(T.vals)) { const m = parseH(v); if (Number.isNaN(m)) { toast('Ore non valide: scrivi per esempio 1:30 oppure 1,5'); return; } if (m > 0) { items.push({ cc, m }); tot += m; } }
    if (!items.length) { toast('Inserisci le ore di almeno una commessa'); return; }
    if (tot > 1440) { toast('Il totale supera le 24 ore'); return; }
    const ok = await act2('w_save_day', { p_day: T.day, p_entries: JSON.stringify(items) });
    if (ok) { S.tbl = null; toast('Ore inviate: ' + fmtM(tot)); render(); }
  },
  ackalert(b) { S.alerts = S.alerts.filter(a => a.id !== b.dataset.id); render(); act2('w_ack_alert', { p_id: b.dataset.id }); },
  async pushon() {
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('Notifiche non consentite. Abilitale nelle impostazioni del telefono.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(CFG.VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      await call('w_push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      S.pushOn = true; toast('Notifiche attivate'); render();
    } catch (e) { if (!e.expired) toast(e.message || 'Impossibile attivare le notifiche'); }
  },
  async pushoff() {
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { await call('w_push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      S.pushOn = false; render();
    } catch (e) { toast(e.message); }
  },
  startbreak() { if (S.segs.some(s => !s.end) || (schedOn() && !inHours(nowMs())) || pastHard()) return; act2('w_start', { p_kind: 'break', p_job: null }); },
  pause() { act2('w_pause', {}); },
  resume() { act2('w_resume', {}); },
  stop() { act2('w_stop', {}); },
  closeold() { const run = S.segs.find(s => !s.end); const v = $('#oldt').value; if (!run || !v) { toast("Indica l'ora"); return; } let end = at(dstr(run.start), v); if (end <= run.start) end += 864e5; act2('w_close_at', { p_end: iso(Math.min(end, nowMs())) }); },
  veh(b) {
    const s = get(S.segs, b.dataset.s); if (!s) return; const v = b.dataset.v, on = !s.rescues.includes(v);
    s.rescues = on ? [...s.rescues, v] : s.rescues.filter(x => x !== v); render();
    act2('w_set_rescue', { p_seg: s.id, p_vehicle: v, p_on: on });
  },
  /* ore per commessa (titolare) */
  an(b) { S.an = b.dataset.v; render(); refresh(); },
  confirm1(b) { act2('o_confirm_days', { p_items: JSON.stringify([{ w: b.dataset.w, d: b.dataset.d }]) }).then(ok => { if (ok) toast('Confermato'); }); },
  reopen(b) { act2('o_reopen_day', { p_worker: b.dataset.w, p_day: b.dataset.d }).then(ok => { if (ok) toast('Giornata riaperta: l\'operaio può correggere'); }); },
  selall() { const today = S.o.today || dstr(nowMs()), list = S.o.subs.filter(x => !x.confirmed_at && x.day < today), all = list.every(x => S.csel[subKey(x)]); list.forEach(x => { S.csel[subKey(x)] = !all; }); render(); },
  confsel() {
    const today = S.o.today || dstr(nowMs()), items = S.o.subs.filter(x => !x.confirmed_at && x.day < today && S.csel[subKey(x)]).map(x => ({ w: x.worker_id, d: x.day }));
    if (!items.length) return; S.csel = {};
    act2('o_confirm_days', { p_items: JSON.stringify(items) }).then(ok => { if (ok) toast(items.length + (items.length === 1 ? ' tabella confermata' : ' tabelle confermate')); });
  },
  csvcc() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', [from, to] = rangeOf(), rows = [['Data', 'Operaio', 'Codice commessa', 'Commessa', 'Ore decimali', 'Stato']];
    [...S.o.subs].filter(x => x.day >= from && x.day <= to).sort((a, b) => a.day < b.day ? -1 : 1).forEach(x => x.entries.forEach(e => { const c = S.o.cc.find(k => k.id === e.cc) || {}; rows.push([x.day, (W(x.worker_id) || {}).name || '', c.code || '', c.name || '', (Math.round(e.minutes / 6) / 10).toString().replace('.', ','), x.confirmed_at ? 'Confermato' : 'Da confermare']); }));
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ore-commesse-' + S.rep.month + '.csv'; document.body.append(a); a.click(); a.remove();
  },
  addcc() { const c = $('#ncc_c').value.trim(), n = $('#ncc_n').value.trim(); if (!c || !n) { toast('Inserisci codice e nome'); return; } act2('o_save_cost_center', { p_id: null, p_code: c, p_name: n, p_active: true }).then(ok => { if (ok) toast('Commessa aggiunta'); }); },
  savecc(b) { const c = get(S.o.cc, b.dataset.id); if (c) act2('o_save_cost_center', { p_id: c.id, p_code: $('#cc_c_' + c.id).value, p_name: $('#cc_n_' + c.id).value, p_active: c.active }).then(ok => { if (ok) toast('Salvato'); }); },
  togcc(b) { const c = get(S.o.cc, b.dataset.id); if (c) act2('o_save_cost_center', { p_id: c.id, p_code: c.code, p_name: c.name, p_active: !c.active }); },
  delcc(b) { const key = 'cc:' + b.dataset.id; if (S.confirm !== key) { S.confirm = key; render(); return; } S.confirm = ''; act2('o_delete_cost_center', { p_id: b.dataset.id }); },
  addwt() { const n = $('#nwt').value.trim(); if (!n) { toast('Inserisci il nome'); return; } act2('o_save_work_type', { p_id: null, p_name: n, p_active: true }).then(ok => { if (ok) toast('Tipo aggiunto'); }); },
  savewt(b) { const t = get(S.o.wt, b.dataset.id); if (t) act2('o_save_work_type', { p_id: t.id, p_name: $('#wt_n_' + t.id).value, p_active: t.active }).then(ok => { if (ok) toast('Salvato'); }); },
  togwt(b) { const t = get(S.o.wt, b.dataset.id); if (t) act2('o_save_work_type', { p_id: t.id, p_name: t.name, p_active: !t.active }); },
  delwt(b) { const key = 'wt:' + b.dataset.id; if (S.confirm !== key) { S.confirm = key; render(); return; } S.confirm = ''; act2('o_delete_work_type', { p_id: b.dataset.id }); },
  /* report */
  rmode(b) { S.rep.mode = b.dataset.v; render(); refresh(); },
  rby(b) { S.rep.by = b.dataset.v; render(); },
  print() { window.print(); },
  csv() {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', now = nowMs();
    const rows = [['Data', 'Operaio', 'Tipo', 'Codice', 'Targa', 'Descrizione', 'Tipo di lavoro', 'Inizio', 'Fine', 'Ore decimali', 'Ore straordinario', 'Ricambi', 'Note', 'Soccorso (mezzi)']];
    [...periodSegs()].sort((a, b) => a.start - b.start).forEach(s => {
      const j = J(s.jobId) || {};
      rows.push([dstr(s.start), (W(s.wid) || {}).name || '', s.kind === 'break' ? 'Pausa' : 'Lavoro', j.code || '', j.plate || '', j.desc || '', s.kind === 'work' ? wtName(s.wt) : '', hm(s.start), s.end ? hm(s.end) : '', dec((s.end || now) - s.start), otMs(s, now) ? dec(otMs(s, now)) : '', (s.parts || '').replace(/\n/g, ' | '), s.note || '', s.rescues.join(' | ')]);
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
    act2('o_add_segment', { p_worker: w, p_job: kind === 'work' ? job : null, p_kind: kind, p_start: iso(st), p_end: iso(en), p_overtime: kind === 'work' && $('#ao_' + w).value === '1', p_type: kind === 'work' ? $('#at_' + w).value || null : null });
  },
  /* lavori */
  scanw() {
    if (!Sc()) { toast('Aggiorna la pagina e riprova'); return; }
    Sc().scan((code, err) => {
      if (err) { toast(err); return; }
      const j = Sc().matchJob(S.jobs.filter(x => x.open), code);
      if (j) { S.sel = j.id; S.jq = ''; render(); } else toast('Nessun lavoro aperto con il codice ' + code);
    });
  },
  scanbc() {
    if (!Sc()) { toast('Aggiorna la pagina e riprova'); return; }
    Sc().scan((code, err) => { if (err) { toast(err); return; } S.draft.barcode = code; render(); });
  },
  canceldraft() { S.draft = emptyDraft(); render(); },
  editjob(b) {
    const j = get(S.jobs, b.dataset.id); if (!j) return;
    S.draft = { ...emptyDraft(), id: j.id, kind: j.type, code: j.code, plate: j.plate, barcode: j.barcode, desc: j.desc, sheet: j.sheet, customer: j.customer, model: j.model, vin: j.vin, km: String(j.km), due: j.due, request: j.request, note: 'Stai modificando un lavoro esistente.' };
    render(); window.scrollTo(0, 0);
  },
  async savejob() {
    const d = S.draft;
    if (!d.code.trim() && !d.plate.trim() && !d.barcode.trim()) { toast('Inserisci almeno codice, targa o codice a barre'); return; }
    let id = d.id;
    if (!id && d.barcode.trim() && Sc()) { const ex = Sc().matchJob(S.jobs, d.barcode); if (ex) id = ex.id; }   // stesso codice a barre: aggiorna il lavoro esistente
    const km = parseInt(d.km, 10);
    try {
      const jid = await call('o_save_job', { p_job: id || null, p_kind: d.kind, p_code: d.code, p_plate: d.plate, p_barcode: d.barcode, p_desc: d.desc, p_sheet_no: d.sheet, p_customer: d.customer, p_model: d.model, p_vin: d.vin, p_km: Number.isFinite(km) ? km : null, p_due: d.due || null, p_request: d.request });
      if (d.file) {
        try { await call('o_add_file', { p_job: jid, p_kind: d.file.kind, p_name: d.file.name, p_mime: d.file.mime, p_b64: d.file.b64 }); }
        catch (e) { if (e.expired) return; S.draft.id = jid; S.draft.note = 'Lavoro salvato, ma il documento non è stato caricato: ' + e.message + ' Premi Salva modifiche per riprovare.'; await refresh(); render(); return; }
      }
      delete S.files[jid]; S.draft = emptyDraft(); toast(id ? 'Lavoro aggiornato' : 'Lavoro aggiunto'); await refresh(); render();
    } catch (e) { if (!e.expired) toast(e.message); }
  },
  openjob(b) {
    const id = b.dataset.id; S.openJob = S.openJob === id ? '' : id; render();
    if (S.openJob && !S.files[id]) loadFiles(id);
  },
  async openfile(b) {
    const w = window.open('', '_blank');
    try {
      const r = await call('o_get_file', { p_file: b.dataset.f });
      const bin = atob(r.b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: r.mime }));
      if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = r.name; document.body.append(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { if (w) w.close(); if (!e.expired) toast(e.message); }
  },
  async delfile(b) {
    const key = 'file:' + b.dataset.f; if (S.confirm !== key) { S.confirm = key; render(); return; }
    S.confirm = '';
    try { await call('o_delete_file', { p_file: b.dataset.f }); delete S.files[b.dataset.j]; loadFiles(b.dataset.j); await refresh(); } catch (e) { if (!e.expired) toast(e.message); }
  },
  togjob(b) { const j = get(S.jobs, b.dataset.id); if (j) act2('o_set_job_open', { p_job: j.id, p_open: !j.open }); },
  deljob(b) { const key = 'job:' + b.dataset.id; if (S.confirm !== key) { S.confirm = key; render(); return; } S.confirm = ''; act2('o_delete_job', { p_job: b.dataset.id }); },
  /* anagrafiche */
  addw() { const n = $('#nw').value.trim(), p = $('#nwp').value; if (!n) { toast('Inserisci il nome'); return; } if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_add_worker', { p_name: n, p_pin: p }).then(ok => { if (ok) toast('Operaio aggiunto'); }); },
  setpin(b) { const p = $('#pp_' + b.dataset.id).value; if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_set_worker_pin', { p_worker: b.dataset.id, p_pin: p }).then(ok => { if (ok) toast('PIN cambiato'); }); },
  togw(b) { const w = get(S.o.workers, b.dataset.id); if (w) act2('o_set_worker_active', { p_worker: w.id, p_active: !w.active }); },
  addv() { const n = $('#nv').value.trim(); if (n) act2('o_add_vehicle', { p_name: n }); },
  delv(b) { act2('o_del_vehicle', { p_name: b.dataset.v }); },
  savesched() {
    const d = S.sch; if (!d) return; const days = {};
    for (let i = 1; i <= 7; i++) {
      const x = d.days[i]; if (!x.on) continue; const nm = DAYNAMES[i - 1], sl = [];
      if (!x.af || !x.at || x.af >= x.at) { toast(nm + ": l'ora di fine della mattina deve seguire quella di inizio"); return; }
      sl.push([x.af, x.at]);
      if (x.bf || x.bt) {
        if (!x.bf || !x.bt || x.bf >= x.bt) { toast(nm + ": l'ora di fine del pomeriggio deve seguire quella di inizio"); return; }
        if (x.bf < x.at) { toast(nm + ': il pomeriggio deve iniziare dopo la fine della mattina'); return; }
        sl.push([x.bf, x.bt]);
      }
      days[i] = sl;
    }
    if (d.hs && !(d.hs >= '00:00')) d.hs = '';
    act2('o_set_schedule', { p_cfg: JSON.stringify({ enabled: d.en, days, hard_stop: d.hs || '', reminder: d.rm || '' }) }).then(ok => { if (ok) { S.sch = null; toast('Orario salvato'); render(); } });
  },
  setowner() { const p = $('#opn').value; if (!pinOk(p)) { toast('Il PIN deve avere da 4 a 6 cifre'); return; } act2('o_set_owner_pin', { p_pin: p }).then(ok => { if (ok) toast('PIN del titolare cambiato'); }); }
};
async function loadFiles(id) {
  try { S.files[id] = await call('o_list_files', { p_job: id }); } catch (e) { if (!e.expired) toast(e.message); S.files[id] = []; }
  softRender();
}
async function prepFile(f) {              // PDF cosi' com'e', foto ridotta; ritorna { kind, name, mime, b64, blob }
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
    if (f.size > 4 * 1024 * 1024) throw new Error('PDF troppo grande (massimo 4 MB)');
    return { kind: 'pdf', name: f.name, mime: 'application/pdf', b64: await toB64(f), blob: f };
  }
  if (!Sc()) throw new Error('Aggiorna la pagina e riprova');
  const blob = await Sc().shrink(f, 1600, 0.8);
  return { kind: 'photo', name: f.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', b64: await toB64(blob), blob };
}
const chg = {
  async imp(t) {
    const f = t.files && t.files[0]; t.value = ''; if (!f) return;
    if (!Sc()) { toast('Aggiorna la pagina e riprova'); return; }
    S.draft.note = 'Lettura in corso…'; render();
    try {
      const file = await prepFile(f);
      if (file.kind === 'pdf') {
        const r = await Sc().readPdf(f);
        if (!r.barcode && !r.plate && !r.code) throw new Error('Non riesco a leggere questo PDF: non sembra una scheda di accettazione.');
        const ex = r.barcode ? Sc().matchJob(S.jobs, r.barcode) : null;
        S.draft = { ...emptyDraft(), id: ex ? ex.id : '', code: r.code, plate: r.plate, barcode: r.barcode, desc: r.model, sheet: r.sheet_no, customer: r.customer, model: r.model, vin: r.vin, km: r.km, due: r.due, request: r.request,
          file: { kind: file.kind, name: file.name, mime: file.mime, b64: file.b64 },
          note: ex ? 'Questo lavoro esiste già (' + jobText(ex) + '): salvando aggiorno i dati e aggiungo il PDF.' : 'Scheda ' + (r.sheet_no || '') + ' letta. Controlla i dati e premi Aggiungi lavoro.' };
      } else {
        const bc = await Sc().barcodeFromImage(file.blob);
        S.draft = { ...S.draft, barcode: bc || S.draft.barcode, file: { kind: file.kind, name: file.name, mime: file.mime, b64: file.b64 },
          note: bc ? 'Foto allegata. Codice a barre letto: ' + bc + '. Completa gli altri dati e premi Aggiungi lavoro.' : 'Foto allegata, ma non riesco a leggere il codice a barre: usa Scansiona o scrivilo a mano.' };
      }
    } catch (e) { S.draft.note = ''; toast(e.message); }
    render();
  },
  async addf(t) {
    const f = t.files && t.files[0], jid = t.dataset.j; t.value = ''; if (!f) return;
    try {
      const file = await prepFile(f);
      await call('o_add_file', { p_job: jid, p_kind: file.kind, p_name: file.name, p_mime: file.mime, p_b64: file.b64 });
      delete S.files[jid]; toast('Documento archiviato'); loadFiles(jid); refresh();
    } catch (e) { if (!e.expired) toast(e.message); }
  },
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
  tday(t) { S.tbl = { day: t.value, init: '', vals: {} }; render(); },
  wt(t) { S.typeSel = t.value; render(); },
  wtype(t) { const s = get(S.segs, t.dataset.s); if (s) s.wt = t.value; act2('w_set_type', { p_seg: t.dataset.s, p_type: t.value || null }); },
  otype(t) { act2('o_set_segment_type', { p_seg: t.dataset.s, p_type: t.value || null }); },
  csel(t) { S.csel[t.dataset.k] = t.checked; render(); },
  segot(t) { act2('o_set_segment_overtime', { p_seg: t.dataset.s, p_on: t.checked }); },
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
  sch(t) {
    const d = S.sch ??= schedDraft(), f = t.dataset.f; let m;
    if (f === 'en') d.en = t.checked;
    else if (f === 'hs' || f === 'rm') d[f] = t.value;
    else if ((m = /^on(\d)$/.exec(f))) { d.days[m[1]].on = t.checked; render(); }
    else if ((m = /^(af|at|bf|bt)(\d)$/.exec(f))) d.days[m[2]][m[1]] = t.value;
  },
  dr(t) { S.draft[t.dataset.f] = t.value; },
  tb(t) { tblGet().vals[t.dataset.c] = t.value; const e = $('#tbltot'); if (e) e.innerHTML = tblTotalHtml(); },
  jq(t) { S.jq = t.value; const l = $('#joblist'); if (l) l.innerHTML = jobListHtml(); },
  jf(t) { S.jf = t.value; const l = $('#jobsadmin'); if (l) l.innerHTML = jobsAdminList(); }
};
app.addEventListener('toggle', e => { const d = e.target; if (d.tagName === 'DETAILS' && d.dataset.k) S.open[d.dataset.k] = d.open; }, true);
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
