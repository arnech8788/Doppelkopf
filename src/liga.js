// liga.js – Ligabereich (öffentlich, „wie Turniere"). Ligen liegen im offenen Firebase-Pfad
// turniere/LG<code> (kind:'liga'). Jede:r kann anlegen/beitreten. Rollen: globale Admins +
// Liga-Ersteller + per Ersteller ernannte Liga-Admins verwalten. Gesamttabelle = manuelle
// Termin-Punkte + Punkte aus eingetragenen App-Spielen (computeStandings, Match per Name).
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { state, save } from './main.js';
import { showToast, showConfirm, showPrompt, showChoice, ICO } from './ui.js';
import { initFirebase, getOwnSpieler, getDeviceId, isAdmin, generateQR, loadAllLigen } from './turnier.js';
import { loadArchive } from './archiv.js';
import { logChange, renderHistory } from './audit.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ligaRef = code => firebase.database().ref('turniere/LG' + code);
// Runden eines App-Spiels: bevorzugt als JSON-String (roundsJson) gespeichert, da Spielernamen
// als Objekt-Schlüssel in scores sonst Firebase-verbotene Zeichen (. # $ [ ] /) enthalten können.
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return []; } }
const gameRounds = g => (g && (g.rounds || (g.roundsJson ? safeParse(g.roundsJson) : []))) || [];
// Zuordnung Spielname → Roster-pid (als JSON-String gespeichert, da Namen Sonderzeichen haben können).
const gameMap = g => { try { return g && g.mapJson ? JSON.parse(g.mapJson) : {}; } catch (e) { return {}; } };

// Kurze Beschreibungstexte für die Historie.
function fmtDate(v) { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''; }
function gameSummaryText(g) {
  const rounds = gameRounds(g);
  const tot = {}; (g.players || []).forEach(p => tot[p] = 0);
  rounds.forEach(r => (r.playing || []).forEach(p => { tot[p] = (tot[p] || 0) + ((r.scores && r.scores[p]) || 0); }));
  const arr = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  const winner = arr.length ? arr[0] + ' (' + (tot[arr[0]] > 0 ? '+' : '') + tot[arr[0]] + ')' : '';
  const ds = fmtDate(g.date);
  return (ds ? ds + ' · ' : '') + rounds.length + ' Runden · ' + (g.players || []).join(', ') + (winner ? '\nSieger: ' + winner : '');
}
function terminSummaryText(t, players) {
  players = players || {};
  const parts = Object.entries(t.points || {}).map(([pid, v]) => ((players[pid] && players[pid].name) || '?') + ' ' + (v > 0 ? '+' : '') + v);
  const ds = fmtDate(t.date);
  return (ds ? ds + ' · ' : '') + (t.label ? t.label + ' · ' : '') + parts.join(', ');
}

// ── Namens-Ähnlichkeit (für „Bist du das?"-Verknüpfung) ──
function normalizeName(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function similar(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.split(' ')[0] === y.split(' ')[0]) return true; // gleicher Vorname
  // Kurzform/Spitzname: das kürzere ist Präfix des längeren (z. B. „Chris" ↔ „Christoph").
  const short = x.length <= y.length ? x : y, long = x.length <= y.length ? y : x;
  if (short.length >= 3 && long.startsWith(short)) return true;
  const d = lev(x, y);
  return d <= 2 && d < Math.max(x.length, y.length);
}

// ── Lokale Liga-Liste (state.ligen = [{code,name}]) ──
function addLocalLiga(code, name) {
  if (!Array.isArray(state.ligen)) state.ligen = [];
  if (!state.ligen.some(l => l.code === code)) state.ligen.push({ code, name: name || '' });
  else if (name) state.ligen = state.ligen.map(l => l.code === code ? { code, name } : l);
  save();
}

function isLigaAdmin(data, myId, globalAdmin) {
  if (globalAdmin) return true;
  if (!myId) return false;
  if (data.createdBy && data.createdBy === myId) return true;
  return !!(data.admins && data.admins[myId]);
}

// ── Einklappbare Karte im „Mehr"-Screen (analog Turnier) ──
export async function renderLigaSetup() {
  const el = document.getElementById('ligaSetupContent');
  if (!el) return;
  const ligen = state.ligen || [];
  let h = '<div style="font-size:11px;color:var(--tx3);line-height:1.4;margin:2px 0 4px">Dauerhafte Gesamttabelle über mehrere Spielabende – Punkte sammeln, Rangliste. (Ein einzelnes Live-Event mit mehreren Tischen ist dagegen ein „Turnier".)</div>';
  if (ligen.length) {
    h += '<div class="card" style="padding:4px 0;margin-top:4px">';
    ligen.forEach((l, i) => {
      h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;' + (i < ligen.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '" onclick="openLigaDetail(\'' + l.code + '\')">';
      h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(l.name || ('Liga LG-' + l.code)) + '</div><div style="font-size:11px;color:var(--tx3)">LG-' + esc(l.code) + '</div></div>';
      h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--tx3)"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    h += '</div>';
  }
  h += '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="btn btn-primary" style="flex:1" onclick="ligaCreate()">Erstellen</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openLigaJoin()">Beitreten</button></div>';
  el.innerHTML = h;
  // Verwalten: globale Admins → alle Ligen; sonst nur eigene (Ersteller/Liga-Admin).
  try {
    const verwalten = (await isAdmin())
      ? '<button class="btn btn-secondary" style="width:100%;font-size:13px" onclick="ligaAdminAll()">Alle Ligen verwalten</button>'
      : '<button class="btn btn-secondary" style="width:100%;font-size:13px" onclick="ligaMyLeagues()">Meine Ligen verwalten</button>';
    el.innerHTML += '<div style="margin-top:8px">' + verwalten + '</div>';
  } catch (e) { /* ignore */ }
}

function modalHeader(title) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    + '<h3 style="margin:0">' + title + '</h3>'
    + '<button onclick="closeLigaModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">' + ICO.x + '</button></div>';
}
function showLigaModal() {
  const m = document.getElementById('ligaModal');
  if (m && !m.classList.contains('show')) ligaStack = []; // frischer Einstieg → Navigations-Stack leeren
  if (m) m.classList.add('show');
}
export function closeLigaModal() {
  ligaStack = [];
  document.getElementById('ligaModal').classList.remove('show');
  renderLigaSetup();
}

// ── Navigations-Stack (echtes „Zurück" innerhalb des Liga-Fensters) ──
let ligaStack = [];
function ligaNav(entry) {
  const same = e => e.t === entry.t && (e.code || '') === (entry.code || '') && (e.id || '') === (entry.id || '') && (e.gameId || '') === (entry.gameId || '');
  const idx = ligaStack.findIndex(same);
  if (idx >= 0) ligaStack.splice(idx); // schon im Stack → bis dorthin zurückkürzen
  ligaStack.push(entry);
}
function ligaRenderEntry(e) {
  switch (e.t) {
    case 'home': return renderLigaHome();
    case 'join': return openLigaJoin();
    case 'detail': return openLigaDetail(e.code);
    case 'my': return ligaMyLeagues();
    case 'all': return ligaAdminAll();
    case 'history': return openLigaHistory(e.code);
    case 'game': return openLigaGameDetail(e.code, e.gameId);
    case 'gamemap': return ligaGameMapForm(e.code, e.gameId || null);
    case 'termin': return openLigaTerminDetail(e.code, e.id);
    case 'terminForm': return ligaTerminForm(e.code, e.id);
    case 'archive': return ligaAddArchivedGame(e.code);
    default: return renderLigaHome();
  }
}
export function ligaCanGoBack() { return ligaStack.length > 1; }
export function ligaBack() {
  if (ligaStack.length <= 1) { closeLigaModal(); return; }
  ligaStack.pop();
  ligaRenderEntry(ligaStack[ligaStack.length - 1]);
}

// ── Anlegen ──
export async function ligaCreate() {
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  const name = await showPrompt('Wie soll die Liga heißen?', 'z. B. Stammrunde', 'Anlegen');
  if (!name) return;
  const own = await getOwnSpieler().catch(() => null);
  let code = null;
  for (let tries = 0; tries < 8; tries++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    try { const snap = await ligaRef(c).get(); if (!snap.exists()) { code = c; break; } } catch (e) { /* retry */ }
  }
  if (!code) { showToast('Code-Kollision. Bitte erneut versuchen.', 'error'); return; }
  const data = {
    kind: 'liga', name,
    created: firebase.database.ServerValue.TIMESTAMP,
    createdBy: own ? own.id : null,
    createdByDevice: getDeviceId()
  };
  try {
    await ligaRef(code).set(data);
    if (own) {
      await ligaRef(code).child('admins/' + own.id).set(true);
      await ligaRef(code).child('members/' + own.id).set({ name: own.name || '', short: own.short || '', joinedAt: firebase.database.ServerValue.TIMESTAMP });
    }
    try { await firebase.database().ref('turniere/_ligaIndex/' + code).set({ name, created: firebase.database.ServerValue.TIMESTAMP }); } catch (e) { /* Index best effort */ }
    addLocalLiga(code, name);
    showToast('Liga „' + name + '" angelegt (LG-' + code + ').', 'info');
    showLigaModal();
    openLigaDetail(code);
  } catch (e) { console.error('ligaCreate:', e); showToast('Anlegen fehlgeschlagen.', 'error'); }
}

// ── Beitreten (UI analog openJoinTurnier: Code-Feld + QR scannen) ──
export function openLigaJoin() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'join' });
  let h = modalHeader('Liga beitreten');
  h += '<div class="card"><label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Liga-Code</label>'
    + '<div style="display:flex;align-items:center;gap:6px"><span style="font-weight:600;color:var(--tx2)">LG-</span>'
    + '<input type="text" id="ligaJoinCodeInput" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="4729" style="font-size:16px;padding:10px;letter-spacing:4px;text-align:center;flex:1"></div></div>';
  h += '<div style="display:flex;gap:8px;margin-top:10px">'
    + '<button class="btn btn-primary" style="flex:1" onclick="ligaJoinFromInput()">Beitreten</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openQrScanner(\'liga\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;vertical-align:-2px"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg> QR scannen</button></div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
  const inp = document.getElementById('ligaJoinCodeInput');
  if (inp) setTimeout(() => inp.focus(), 100);
}
export function ligaJoinFromInput() {
  const inp = document.getElementById('ligaJoinCodeInput');
  const code = ((inp && inp.value) || '').replace(/[^0-9]/g, '').slice(-4);
  if (!/^\d{4}$/.test(code)) { showToast('Ungültiger Code.', 'error'); return; }
  ligaJoin(code);
}
export async function ligaJoin(code) {
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  let data;
  try { const snap = await ligaRef(code).get(); data = snap.val(); } catch (e) { showToast('Beitritt fehlgeschlagen.', 'error'); return; }
  if (!data || data.kind !== 'liga') { showToast('Liga LG-' + code + ' nicht gefunden.', 'error'); return; }
  const own = await getOwnSpieler().catch(() => null);
  try { if (own) await ligaRef(code).child('members/' + own.id).set({ name: own.name || '', short: own.short || '', joinedAt: firebase.database.ServerValue.TIMESTAMP }); } catch (e) { /* ignore */ }
  try { await firebase.database().ref('turniere/_ligaIndex/' + code).update({ name: data.name || '' }); } catch (e) { /* Index best effort */ }
  addLocalLiga(code, data.name || '');
  showToast('Liga „' + (data.name || ('LG-' + code)) + '" beigetreten.', 'info');
  // Frische Daten (inkl. eigener Mitgliedschaft): namensgleichen Spieler still verbinden,
  // sonst (anderer Name) wie bisher vorschlagen.
  let fresh = data; try { fresh = (await ligaRef(code).get()).val() || data; } catch (e) { /* ignore */ }
  try { await ligaAutoLinkMembers(code, fresh); } catch (e) { /* ignore */ }
  try { fresh = (await ligaRef(code).get()).val() || fresh; } catch (e) { /* ignore */ }
  await ligaSuggestClaim(code, fresh, own);
  openLigaDetail(code);
}
// Beim Beitritt: ähnlich benannten, noch nicht zugeordneten Roster-Spieler vorschlagen.
async function ligaSuggestClaim(code, data, own) {
  if (!own) return;
  const myName = own.name || state.myPlayer || '';
  if (!myName) return;
  const players = data.players || {};
  const cand = Object.entries(players).find(([pid, p]) => !p.claimedBy && similar(p.name, myName));
  if (!cand) return;
  const [pid, p] = cand;
  const ok = await showConfirm('In dieser Liga gibt es den Spieler „' + p.name + '". Bist du das? Dann wird er mit dir verknüpft.', 'Ja, das bin ich');
  if (!ok) return;
  try { await ligaRef(code).child('players/' + pid).update({ claimedBy: own.id, claimedByName: myName }); } catch (e) { /* ignore */ }
}

// ── Gesamttabelle berechnen: ALLES kombiniert je Roster-Spieler (pid). ──
// Spiele werden über mapJson (Spielname→pid) bzw. exakten Namens-Treffer zugeordnet; manuelle
// Termine sind bereits pid-basiert. Zahlbetrag (payMode): pro Abend (Spiel ODER Termin) das
// Netto je Spieler, negative Beträge aufaddiert.
function ligaStandings(data) {
  const players = data.players || {};
  const termine = data.termine || {};
  const games = Object.entries(data.spiele || {}).map(([id, g]) => ({ id, ...g }));
  const payMode = !!(data.settings && data.settings.payMode);
  const nameIdx = {};
  Object.entries(players).forEach(([pid, p]) => { if (p && p.name) nameIdx[String(p.name).toLowerCase()] = pid; });
  const acc = {};
  const row = key => acc[key] || (acc[key] = {
    key, pid: players[key] ? key : null,
    name: players[key] ? (players[key].name || '?') : (String(key).charAt(0) === '~' ? String(key).slice(1) + ' (nicht zugeordnet)' : String(key)),
    claimedByName: players[key] ? (players[key].claimedByName || null) : null,
    total: 0, payment: 0, abende: 0, runden: 0, siege: 0, soloWins: 0, soloTotal: 0
  });
  Object.keys(players).forEach(pid => row(pid)); // alle Roster-Spieler vorab (auch ohne Spiele)
  const resolve = (g, rawName) => {
    const m = gameMap(g);
    if (m[rawName] && players[m[rawName]]) return m[rawName];
    const byName = nameIdx[String(rawName).toLowerCase()];
    if (byName) return byName;
    return '~' + rawName;
  };
  // Manuelle Termine (je Termin ein Abend)
  Object.values(termine).forEach(t => {
    const pts = t.points || {};
    Object.entries(pts).forEach(([pid, v]) => {
      const r = row(players[pid] ? pid : ('~' + pid));
      const val = Number(v) || 0;
      r.total += val; r.abende += 1;
      if (payMode && val < 0) r.payment += -val;
    });
  });
  // App-Spiele (je Spiel ein Abend)
  games.forEach(g => {
    const rounds = gameRounds(g);
    const net = {};
    rounds.forEach(rd => {
      const wins = rd.winners || [];
      let solistKey = null;
      if (rd.solo) {
        const sn = wins.length === 1 ? wins[0] : (rd.playing || []).find(p => !wins.includes(p));
        if (sn) solistKey = resolve(g, sn);
      }
      (rd.playing || []).forEach(p => {
        const key = resolve(g, p);
        const r = row(key);
        const s = (rd.scores && rd.scores[p]) || 0;
        r.total += s; r.runden += 1;
        net[key] = (net[key] || 0) + s;
        if (wins.includes(p)) { r.siege += 1; if (rd.solo && key === solistKey) r.soloWins += 1; }
        if (rd.solo && key === solistKey) r.soloTotal += 1;
      });
    });
    Object.entries(net).forEach(([key, n]) => {
      const r = row(key);
      r.abende += 1;
      if (payMode && n < 0) r.payment += -n;
    });
  });
  // Mitglieder, die (noch) keinem Tabellen-Spieler entsprechen, als 0-Zeile mit aufnehmen.
  const members = data.members || {};
  const claimed = new Set(Object.values(players).filter(p => p && p.claimedBy).map(p => p.claimedBy));
  const nameSet = new Set(Object.values(players).map(p => normalizeName(p && p.name)));
  Object.entries(members).forEach(([mid, m]) => {
    if (claimed.has(mid)) return;
    const nm = normalizeName(m && m.name);
    if (nm && nameSet.has(nm)) return; // gleicher Name existiert schon als Spieler
    const key = '@' + mid;
    if (!acc[key]) acc[key] = { key, pid: null, mid, name: (m && m.name) || '(Mitglied)', claimedByName: null, total: 0, payment: 0, abende: 0, runden: 0, siege: 0, soloWins: 0, soloTotal: 0 };
  });
  const rows = Object.values(acc).sort((a, b) => b.total - a.total || (a.name || '').localeCompare(b.name || ''));
  return { rows, payMode };
}

// Mitglied (App-Profil) ↔ Tabellen-Spieler automatisch verbinden: für jedes Mitglied ohne
// verknüpften Spieler einen namensgleichen, noch freien Spieler verknüpfen (still, nur exakter
// Name). So zählt dieselbe Person als eine – ohne manuelles „Verknüpfen". Liefert true bei Änderung.
// Macht jeden in App-Spielen vorkommenden Spielernamen zu einem echten Tabellen-Spieler:
// noch nicht zugeordnete Namen werden (einmalig) als Roster-Spieler angelegt und im mapJson
// des Spiels eingetragen. So gibt es keine „nicht zugeordnet"-Zeilen mehr und jede Person ist
// verwaltbar. Liefert true bei Änderung.
async function ligaBackfillGameNames(code, data) {
  const players = { ...(data.players || {}) };
  const games = data.spiele || {};
  const nameIdx = {};
  Object.entries(players).forEach(([pid, p]) => { if (p && p.name) nameIdx[normalizeName(p.name)] = pid; });
  let changed = false;
  for (const [gid, g] of Object.entries(games)) {
    const map = gameMap(g);
    const names = snapshotNames({ players: g.players, rounds: gameRounds(g) });
    let gChanged = false;
    for (const n of names) {
      if (map[n] && players[map[n]]) continue; // schon einem vorhandenen Spieler zugeordnet
      const nn = normalizeName(n);
      let pid = nameIdx[nn];
      if (!pid) {
        const ref = ligaRef(code).child('players').push();
        await ref.set({ name: String(n).trim() });
        pid = ref.key; players[pid] = { name: String(n).trim() }; nameIdx[nn] = pid; changed = true;
      }
      if (map[n] !== pid) { map[n] = pid; gChanged = true; }
    }
    if (gChanged) { await ligaRef(code).child('spiele/' + gid + '/mapJson').set(JSON.stringify(map)); changed = true; }
  }
  return changed;
}

async function ligaAutoLinkMembers(code, data) {
  const players = data.players || {}, members = data.members || {};
  const claimed = new Set(Object.values(players).filter(p => p && p.claimedBy).map(p => p.claimedBy));
  let changed = false;
  for (const [mid, m] of Object.entries(members)) {
    if (claimed.has(mid)) continue;
    const nm = normalizeName(m && m.name);
    if (!nm) continue;
    const hit = Object.entries(players).find(([, p]) => !p.claimedBy && normalizeName(p.name) === nm);
    if (hit) {
      try { await ligaRef(code).child('players/' + hit[0]).update({ claimedBy: mid, claimedByName: m.name || '' }); claimed.add(mid); changed = true; } catch (e) { /* ignore */ }
    }
  }
  return changed;
}

// ── Detailansicht einer Liga ──
export async function openLigaDetail(code) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'detail', code });
  el.innerHTML = modalHeader('🏆 Liga') + '<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  if (!initFirebase()) { el.innerHTML = modalHeader('🏆 Liga') + '<div style="padding:20px;color:var(--tx3)">Keine Datenbank-Verbindung.</div>'; return; }
  let data;
  try { const snap = await ligaRef(code).get(); data = snap.val(); } catch (e) { data = null; }
  if (!data || data.kind !== 'liga') { showToast('Liga nicht gefunden.', 'error'); renderLigaHome(); return; }
  addLocalLiga(code, data.name || '');
  const own = await getOwnSpieler().catch(() => null);
  const myId = own ? own.id : null;
  const globalAdmin = await isAdmin().catch(() => false);
  const admin = isLigaAdmin(data, myId, globalAdmin);
  // Selbstheilung (Admin): jeden Spielernamen aus App-Spielen zu einem echten Tabellen-Spieler
  // machen und Mitglieder mit namensgleichen Spielern verbinden – damit jede Person in der
  // Gesamttabelle ein verwaltbarer Spieler ist (umbenennen/zusammenführen/löschen/auswählen).
  if (admin) {
    try {
      let ch = false;
      if (await ligaBackfillGameNames(code, data)) ch = true;
      if (ch) data = (await ligaRef(code).get()).val() || data;
      if (await ligaAutoLinkMembers(code, data)) ch = true;
      if (ch) data = (await ligaRef(code).get()).val() || data;
    } catch (e) { /* ignore */ }
  }
  const isCreator = globalAdmin || (data.createdBy && data.createdBy === myId);
  const joined = (state.ligen || []).some(l => l.code === code);
  const url = location.origin + location.pathname + '?liga=LG' + code;
  const players = data.players || {};
  const members = data.members || {};
  const admins = data.admins || {};

  let h = modalHeader('🏆 ' + esc(data.name || ('Liga LG-' + code)));

  // Teilen / Code
  h += '<div style="text-align:center;margin:6px 0 18px">'
    + '<div style="font-size:24px;font-weight:700;letter-spacing:3px;margin-bottom:10px">LG-' + esc(code) + '</div>'
    + '<img src="' + generateQR(url, 5) + '" style="width:140px;height:140px;image-rendering:pixelated;border-radius:var(--r-sm)">'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:center">'
    + (navigator.share ? '<button class="btn btn-secondary" onclick="ligaShare(\'' + code + '\')">Teilen</button>' : '')
    + '<button class="btn btn-secondary" onclick="ligaCopyLink(\'' + code + '\')">Link kopieren</button>'
    + (joined ? '' : '<button class="btn btn-primary" onclick="ligaJoin(\'' + code + '\')">Beitreten</button>')
    + '</div></div>';

  // Gesamttabelle (alles kombiniert) – Spieler werden hier direkt verwaltet (Admin).
  const { rows, payMode } = ligaStandings(data);
  h += '<div class="section-label">Gesamttabelle' + (admin ? ' <span style="font-weight:400;color:var(--tx3);font-size:11px">· tippe ✏️/🗑 zum Verwalten</span>' : '') + '</div>';
  if (!rows.length) {
    h += '<div class="card" style="font-size:13px;color:var(--tx3)">Noch keine Punkte. ' + (admin ? 'Lege Spieler an und trage Termin-Punkte ein oder nimm App-Spiele auf.' : 'Es wurden noch keine Stände eingetragen.') + '</div>';
  } else {
    const btn = 'background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:26px;border-radius:var(--r-sm);font-size:11px;display:inline-flex;align-items:center;justify-content:center;padding:0 8px';
    h += '<div class="card">';
    rows.forEach((r, i) => {
      const rc = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      h += '<div style="padding:10px 0;' + (i < rows.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500"><span class="rank ' + rc + '" style="display:inline-flex;width:20px;height:20px;font-size:11px;margin-right:6px">' + (i + 1) + '</span>' + esc(r.name) + (r.claimedByName ? ' <span style="font-size:10px;color:var(--tx3)">✓</span>' : '') + (r.mid && !r.pid ? ' <span style="font-size:10px;color:var(--tx3)">· Mitglied</span>' : '') + '</span><span class="' + (r.total >= 0 ? 'pos' : 'neg') + '" style="font-family:\'Space Mono\',monospace;font-weight:700">' + (r.total > 0 ? '+' : '') + r.total + '</span></div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;color:var(--tx3);margin-left:26px">';
      h += '<span>Abende: ' + r.abende + '</span>';
      if (r.runden) h += '<span>Runden: ' + r.runden + '</span><span>Siege: ' + Math.round(r.siege / r.runden * 100) + '%</span>';
      if (r.soloTotal) h += '<span>Soli: ' + r.soloWins + '/' + r.soloTotal + '</span>';
      if (payMode) h += '<span style="color:var(--neg,#d23);font-weight:600">zu zahlen: ' + r.payment + '</span>';
      h += '</div>';
      if (admin && r.pid) {
        h += '<div style="display:flex;gap:6px;margin:8px 0 2px 26px">';
        h += '<button onclick="ligaRenamePlayer(\'' + code + '\',\'' + r.pid + '\')" style="' + btn + '">' + ICO.edit + '&nbsp;Umbenennen</button>';
        h += '<button onclick="ligaMergePlayer(\'' + code + '\',\'' + r.pid + '\')" title="Mit anderem Spieler zusammenführen" style="' + btn + '">Zusammenf.</button>';
        h += '<button onclick="ligaDeletePlayer(\'' + code + '\',\'' + r.pid + '\')" style="' + btn + '">' + ICO.trash + '</button>';
        h += '</div>';
      } else if (admin && r.mid) {
        // Mitglied (anderer Name als ein Tabellen-Spieler) → manuell mit einem Spieler verbinden.
        h += '<div style="display:flex;gap:6px;margin:8px 0 2px 26px">';
        h += '<button onclick="ligaClaimMemberToPlayer(\'' + code + '\',\'' + r.mid + '\')" style="' + btn + '">Mit Spieler verknüpfen</button>';
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
  }
  if (admin) h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="ligaAddPlayer(\'' + code + '\')">+ Spieler hinzufügen</button>';

  // Termine (manuelle Punkte)
  const termine = Object.entries(data.termine || {}).map(([id, t]) => ({ id, ...t })).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  h += '<div class="section-label" style="margin-top:20px">Termine (manuelle Punkte)</div>';
  h += '<div class="card" style="padding:4px 0">';
  if (!termine.length) h += '<div style="padding:10px 12px;font-size:13px;color:var(--tx3)">Noch keine Termine eingetragen.</div>';
  termine.forEach((t, i) => {
    const d = t.date ? new Date(t.date) : null;
    const dateStr = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
    const cnt = t.points ? Object.keys(t.points).length : 0;
    h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' + (i < termine.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
    h += '<div style="flex:1;min-width:0;cursor:pointer" onclick="openLigaTerminDetail(\'' + code + '\',\'' + t.id + '\')"><div style="font-size:13px">' + dateStr + (t.label ? ' · ' + esc(t.label) : '') + '</div><div style="font-size:11px;color:var(--tx3)">' + cnt + ' Spieler-Einträge · ansehen</div></div>';
    if (admin) h += '<button onclick="ligaDeleteTermin(\'' + code + '\',\'' + t.id + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:28px;height:28px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;padding:0">' + ICO.trash + '</button>';
    h += '</div>';
  });
  h += '</div>';
  if (admin) h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="ligaAddTerminForm(\'' + code + '\')">+ Termin eintragen</button>';

  // App-Spiele
  const games = Object.entries(data.spiele || {}).map(([id, g]) => ({ id, ...g })).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  h += '<div class="section-label" style="margin-top:20px">App-Spiele</div><div class="card" style="padding:4px 0">';
  if (!games.length) h += '<div style="padding:10px 12px;font-size:13px;color:var(--tx3)">Noch keine App-Spiele aufgenommen.</div>';
  games.forEach((g, i) => {
    const rounds = gameRounds(g);
    const d = g.date ? new Date(g.date) : (g.addedAt ? new Date(g.addedAt) : null);
    const dateStr = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
    const tot = {}; (g.players || []).forEach(p => tot[p] = 0);
    rounds.forEach(r => r.playing.forEach(p => { tot[p] = (tot[p] || 0) + (r.scores[p] || 0); }));
    const arr = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
    const top = arr.length ? esc(arr[0]) + ' (' + (tot[arr[0]] > 0 ? '+' : '') + tot[arr[0]] + ')' : '';
    const canDel = admin || (myId && g.addedBy === myId);
    h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' + (i < games.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
    h += '<div style="flex:1;min-width:0;cursor:pointer" onclick="openLigaGameDetail(\'' + code + '\',\'' + g.id + '\')"><div style="font-size:13px">' + dateStr + ' · ' + rounds.length + ' Runden</div><div style="font-size:11px;color:var(--tx3)">Sieger: ' + top + (g.addedByName ? ' · von ' + esc(g.addedByName) : '') + ' · ansehen</div></div>';
    if (canDel) h += '<button onclick="ligaDeleteGame(\'' + code + '\',\'' + g.id + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:28px;height:28px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;padding:0">' + ICO.trash + '</button>';
    h += '</div>';
  });
  h += '</div>';
  if (joined) h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="ligaAddArchivedGame(\'' + code + '\')">+ Spiel aus Archiv aufnehmen</button>';

  // Mitglieder
  const memEntries = Object.entries(members);
  h += '<div class="section-label" style="margin-top:20px">Mitglieder</div><div class="card" style="padding:4px 0">';
  if (!memEntries.length) h += '<div style="padding:10px 12px;font-size:13px;color:var(--tx3)">Noch keine Mitglieder.</div>';
  memEntries.sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '')).forEach(([mid, m], i) => {
    const isCr = data.createdBy === mid;
    const isAdm = isCr || !!admins[mid];
    h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + (i < memEntries.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
    h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(m.name || '(ohne Name)') + (mid === myId ? ' <span style="font-size:10px;color:var(--tx3)">(du)</span>' : '') + '</div>';
    h += '<div style="font-size:11px;color:var(--tx3)">' + (isCr ? 'Ersteller' : isAdm ? 'Liga-Admin' : 'Mitglied') + '</div></div>';
    if (isCreator && !isCr) {
      h += '<button onclick="liga' + (isAdm ? 'Demote' : 'Promote') + '(\'' + code + '\',\'' + mid + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:28px;border-radius:var(--r-sm);padding:0 8px;font-size:11px">' + (isAdm ? 'Admin entziehen' : 'Zu Liga-Admin') + '</button>';
    }
    h += '</div>';
  });
  h += '</div>';

  // Einstellungen (nur Admin)
  if (admin) {
    h += '<div class="section-label" style="margin-top:20px">Einstellungen</div>';
    h += '<div class="card"><div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Zahlbetrag anzeigen <span style="font-weight:400;color:var(--tx3);font-size:11px">(Minuspunkte je Abend summieren)</span></span>'
      + '<button class="toggle' + (payMode ? ' on' : '') + '" onclick="ligaSetPayMode(\'' + code + '\',' + (payMode ? 'false' : 'true') + ')"></button></div></div>';
  }

  // Fußzeile
  h += '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openLigaDetail(\'' + code + '\')">Aktualisieren</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="ligaBack()">Zurück</button></div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="openLigaHistory(\'' + code + '\')">🕓 Historie' + (admin ? ' (mit Rückgängig)' : '') + '</button>';
  if (joined) h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaLeave(\'' + code + '\')">Liga verlassen</button>';
  if (isCreator) h += '<button class="btn btn-secondary danger" style="width:100%;margin-top:8px;color:var(--neg,#d23);border-color:var(--neg,#d23)" onclick="ligaDeleteLeague(\'' + code + '\')">Liga löschen</button>';
  el.innerHTML = h;
}

// „Übersicht" (im Modal): meine Ligen + anlegen/beitreten
export function renderLigaHome() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  ligaNav({ t: 'home' });
  let h = modalHeader('🏆 Liga');
  const ligen = state.ligen || [];
  if (ligen.length) {
    h += '<div class="section-label">Meine Ligen</div><div class="card" style="padding:4px 0">';
    ligen.forEach((l, i) => {
      h += '<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;' + (i < ligen.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '" onclick="openLigaDetail(\'' + l.code + '\')">';
      h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(l.name || ('Liga LG-' + l.code)) + '</div><div style="font-size:11px;color:var(--tx3)">LG-' + esc(l.code) + '</div></div>';
      h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--tx3)"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    h += '</div>';
  } else {
    h += '<div style="font-size:13px;color:var(--tx3);padding:8px 2px 16px;line-height:1.5">Du bist noch in keiner Liga. Lege eine neue an oder tritt mit einem Code bei.</div>';
  }
  h += '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn btn-primary" style="flex:1" onclick="ligaCreate()">Erstellen</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openLigaJoin()">Beitreten</button></div>';
  el.innerHTML = h;
}

// ── Roster-Verwaltung ──
export async function ligaAddPlayer(code) {
  const name = await showPrompt('Name des Spielers:', 'z. B. Arne', 'Hinzufügen');
  if (!name) return;
  try {
    const ref = ligaRef(code).child('players').push();
    await ref.set({ name: name.trim() });
    await logChange('LG' + code, 'Spieler „' + name.trim() + '" hinzugefügt', 'players/' + ref.key, null);
    openLigaDetail(code);
  } catch (e) { console.error('ligaAddPlayer:', e); showToast('Hinzufügen fehlgeschlagen.', 'error'); }
}
export async function ligaRenamePlayer(code, pid) {
  const name = await showPrompt('Neuer Name:', '', 'Umbenennen');
  if (!name) return;
  try {
    const old = (await ligaRef(code).child('players/' + pid + '/name').get()).val();
    await ligaRef(code).child('players/' + pid + '/name').set(name.trim());
    await logChange('LG' + code, 'Spieler umbenannt: „' + (old || '?') + '" → „' + name.trim() + '"', 'players/' + pid + '/name', old == null ? null : old);
    openLigaDetail(code);
  } catch (e) { showToast('Umbenennen fehlgeschlagen.', 'error'); }
}
export async function ligaDeletePlayer(code, pid) {
  if (!await showConfirm('Diesen Spieler aus der Liga entfernen? (Termin-Einträge zu ihm bleiben, zählen aber nicht mehr.)', 'Löschen', true)) return;
  try {
    const before = (await ligaRef(code).child('players/' + pid).get()).val();
    await ligaRef(code).child('players/' + pid).remove();
    await logChange('LG' + code, 'Spieler „' + ((before && before.name) || '?') + '" entfernt', 'players/' + pid, before);
    openLigaDetail(code);
  } catch (e) { showToast('Löschen fehlgeschlagen.', 'error'); }
}
// Verknüpfung Roster-Spieler ↔ Mitglied setzen/lösen.
export async function ligaSetClaim(code, pid) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { return; }
  if (!data) return;
  const members = Object.entries(data.members || {});
  const labels = members.map(([, m]) => m.name || '(ohne Name)');
  labels.push('— Verknüpfung lösen —');
  const idx = await chooseFromList('Mit welchem Mitglied verknüpfen?', labels);
  if (idx < 0) return;
  const before = (data.players || {})[pid] || null;
  try {
    if (idx === members.length) await ligaRef(code).child('players/' + pid).update({ claimedBy: null, claimedByName: null });
    else { const [mid, m] = members[idx]; await ligaRef(code).child('players/' + pid).update({ claimedBy: mid, claimedByName: m.name || '' }); }
    await logChange('LG' + code, 'Verknüpfung geändert: „' + ((before && before.name) || '?') + '"', 'players/' + pid, before);
    openLigaDetail(code);
  } catch (e) { showToast('Verknüpfen fehlgeschlagen.', 'error'); }
}
// Von der Mitglieder-Seite her: ein Mitglied mit einem vorhandenen Tabellen-Spieler verbinden
// (auch bei abweichendem Namen). So verschwindet das doppelte Mitglied aus der Auswahl.
export async function ligaClaimMemberToPlayer(code, mid) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { return; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const member = (data.members || {})[mid];
  const players = Object.entries(data.players || {}).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  if (!players.length) { showToast('Noch keine Tabellen-Spieler vorhanden.', 'info'); return; }
  const idx = await chooseFromList('„' + ((member && member.name) || 'Mitglied') + '" mit welchem Tabellen-Spieler verbinden?', players.map(([, p]) => p.name || '?'));
  if (idx < 0) return;
  const [pid, p] = players[idx];
  try {
    await ligaRef(code).child('players/' + pid).update({ claimedBy: mid, claimedByName: (member && member.name) || '' });
    await logChange('LG' + code, 'Mitglied „' + ((member && member.name) || '?') + '" mit Spieler „' + (p.name || '?') + '" verknüpft', 'players/' + pid + '/claimedBy', null);
    showToast('Verknüpft.', 'info');
    openLigaDetail(code);
  } catch (e) { console.error('ligaClaimMemberToPlayer:', e); showToast('Verknüpfen fehlgeschlagen.', 'error'); }
}

async function chooseFromList(title, labels) {
  if (!labels.length) { showToast('Keine Auswahl verfügbar.', 'info'); return -1; }
  return await showChoice(title, labels);
}

// ── Termine (manuelle Punkte): Detail ansehen, neu anlegen, bearbeiten ──
export async function openLigaTerminDetail(code, id) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  ligaNav({ t: 'termin', code, id });
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const t = (data.termine || {})[id];
  if (!t) { showToast('Termin nicht gefunden.', 'error'); openLigaDetail(code); return; }
  const own = await getOwnSpieler().catch(() => null);
  const admin = isLigaAdmin(data, own ? own.id : null, await isAdmin().catch(() => false));
  const players = data.players || {};
  const d = t.date ? new Date(t.date) : null;
  const dateStr = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  let h = modalHeader('Termin' + (dateStr ? ' · ' + dateStr : ''));
  if (t.label) h += '<div style="font-size:13px;color:var(--tx2);margin-bottom:8px">' + esc(t.label) + '</div>';
  const pts = t.points || {};
  const rows = Object.entries(pts).map(([pid, v]) => ({ name: (players[pid] && players[pid].name) || '(gelöscht)', v: Number(v) || 0 })).sort((a, b) => b.v - a.v);
  h += '<div class="card">';
  if (!rows.length) h += '<div style="font-size:13px;color:var(--tx3)">Keine Punkte.</div>';
  rows.forEach((r, i) => {
    h += '<div style="display:flex;justify-content:space-between;padding:8px 0;' + (i < rows.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '"><span>' + esc(r.name) + '</span><span class="' + (r.v >= 0 ? 'pos' : 'neg') + '" style="font-family:\'Space Mono\',monospace;font-weight:700">' + (r.v > 0 ? '+' : '') + r.v + '</span></div>';
  });
  h += '</div>';
  if (admin) h += '<button class="btn btn-secondary" style="width:100%;margin-top:10px" onclick="ligaTerminForm(\'' + code + '\',\'' + id + '\')">Bearbeiten</button>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
}
// „+ Termin eintragen" (ohne id) bzw. Bearbeiten (mit id). Felder bei Bearbeiten vorbelegt.
export async function ligaAddTerminForm(code) { return ligaTerminForm(code); }
export async function ligaTerminForm(code, id) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  ligaNav({ t: 'terminForm', code, id: id || '' });
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const playerEntries = Object.entries(data.players || {});
  const members = data.members || {};
  // Eine gemeinsame Personenliste: Tabellen-Spieler + beigetretene Mitglieder, die noch keinem
  // Spieler entsprechen (gleicher Name oder schon verknüpft). Mitglieder werden beim Speichern
  // automatisch als Spieler angelegt und verbunden.
  const claimed = new Set(playerEntries.filter(([, p]) => p.claimedBy).map(([, p]) => p.claimedBy));
  const nameSet = new Set(playerEntries.map(([, p]) => normalizeName(p.name)));
  const persons = [
    ...playerEntries.map(([pid, p]) => ({ kind: 'p', id: pid, name: p.name || '?' })),
    ...Object.entries(members).filter(([mid, m]) => !claimed.has(mid) && !(m.name && nameSet.has(normalizeName(m.name)))).map(([mid, m]) => ({ kind: 'm', id: mid, name: m.name || '(Mitglied)' }))
  ].sort((a, b) => a.name.localeCompare(b.name));
  const t = id ? (data.termine || {})[id] : null;
  const pts = t && t.points || {};
  const dateVal = (t && t.date) || new Date().toISOString().slice(0, 10);
  const labelVal = (t && t.label) || '';
  let h = modalHeader(id ? 'Termin bearbeiten' : 'Termin eintragen');
  h += '<div class="card"><div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<div style="flex:1"><label style="font-size:11px;color:var(--tx2)">Datum</label><input type="date" id="ltDate" value="' + dateVal + '" style="width:100%;box-sizing:border-box;padding:8px"></div>'
    + '<div style="flex:1"><label style="font-size:11px;color:var(--tx2)">Bezeichnung (optional)</label><input type="text" id="ltLabel" value="' + esc(labelVal) + '" placeholder="z. B. Spieltag 5" style="width:100%;box-sizing:border-box;padding:8px"></div></div>';
  if (!persons.length) {
    h += '<div style="font-size:13px;color:var(--tx3);padding:6px 0">Noch keine Personen – bitte zuerst einen Spieler anlegen.</div>';
  } else {
    h += '<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">Punkte je Person (leer = 0):</div>';
    persons.forEach(pr => {
      const v = pr.kind === 'p' && pts[pr.id] != null ? pts[pr.id] : '';
      h += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0"><div style="flex:1;word-break:break-word">' + esc(pr.name) + (pr.kind === 'm' ? ' <span style="font-size:10px;color:var(--tx3)">· Mitglied</span>' : '') + '</div>'
        + '<input type="number" id="lt_' + pr.kind + '_' + pr.id + '" value="' + v + '" inputmode="numeric" placeholder="0" style="width:90px;padding:8px;text-align:right"></div>';
    });
  }
  h += '</div>';
  h += '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-secondary" style="flex:1" onclick="ligaAddPlayer(\'' + code + '\')">+ Spieler</button>';
  if (persons.length) h += '<button class="btn btn-primary" style="flex:1" onclick="ligaSaveTermin(\'' + code + '\'' + (id ? ',\'' + id + '\'' : '') + ')">Speichern</button>';
  h += '</div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaBack()">Abbrechen</button>';
  el.innerHTML = h;
}
export async function ligaSaveTermin(code, id) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { return; }
  if (!data) return;
  const date = (document.getElementById('ltDate') || {}).value || new Date().toISOString().slice(0, 10);
  const label = ((document.getElementById('ltLabel') || {}).value || '').trim();
  const points = {};
  Object.keys(data.players || {}).forEach(pid => {
    const inp = document.getElementById('lt_p_' + pid);
    if (inp && inp.value !== '' && !isNaN(parseInt(inp.value, 10))) points[pid] = parseInt(inp.value, 10);
  });
  const own = await getOwnSpieler().catch(() => null);
  try {
    // Mitglieder ohne eigenen Tabellen-Spieler: bei Eingabe automatisch Spieler anlegen + verknüpfen.
    for (const [mid, m] of Object.entries(data.members || {})) {
      const inp = document.getElementById('lt_m_' + mid);
      if (inp && inp.value !== '' && !isNaN(parseInt(inp.value, 10))) {
        const ref = ligaRef(code).child('players').push();
        await ref.set({ name: (m.name || '').trim() || 'Mitglied', claimedBy: mid, claimedByName: m.name || '' });
        points[ref.key] = parseInt(inp.value, 10);
      }
    }
    if (!Object.keys(points).length) { showToast('Keine Punkte eingegeben.', 'info'); return; }
    if (id) {
      const before = (data.termine || {})[id] || null;
      await ligaRef(code).child('termine/' + id).update({ date, label: label || null, points });
      await logChange('LG' + code, 'Termin bearbeitet', 'termine/' + id, before, terminSummaryText({ date, label, points }, data.players));
      showToast('Termin aktualisiert.', 'info');
    } else {
      const ref = ligaRef(code).child('termine').push();
      await ref.set({ date, label: label || null, points, addedBy: own ? own.id : null, addedAt: firebase.database.ServerValue.TIMESTAMP });
      await logChange('LG' + code, 'Termin eingetragen', 'termine/' + ref.key, null, terminSummaryText({ date, label, points }, data.players));
      showToast('Termin gespeichert.', 'info');
    }
    openLigaDetail(code);
  } catch (e) { console.error('ligaSaveTermin:', e); showToast('Speichern fehlgeschlagen: ' + (e && e.message || e), 'error'); }
}
export async function ligaDeleteTermin(code, id) {
  if (!await showConfirm('Diesen Termin löschen?', 'Löschen', true)) return;
  try {
    const data = (await ligaRef(code).get()).val() || {};
    const before = (data.termine || {})[id] || null;
    await ligaRef(code).child('termine/' + id).remove();
    await logChange('LG' + code, 'Termin gelöscht', 'termine/' + id, before, before ? terminSummaryText(before, data.players) : '');
    openLigaDetail(code);
  } catch (e) { showToast('Löschen fehlgeschlagen.', 'error'); }
}

// ── Rollen ──
export async function ligaPromote(code, mid) {
  try {
    const nm = ((await ligaRef(code).child('members/' + mid + '/name').get()).val()) || mid;
    await ligaRef(code).child('admins/' + mid).set(true);
    await logChange('LG' + code, '„' + nm + '" zum Liga-Admin ernannt', 'admins/' + mid, null);
    showToast('Ist jetzt Liga-Admin.', 'info'); openLigaDetail(code);
  } catch (e) { showToast('Fehler.', 'error'); }
}
export async function ligaDemote(code, mid) {
  try {
    const nm = ((await ligaRef(code).child('members/' + mid + '/name').get()).val()) || mid;
    await ligaRef(code).child('admins/' + mid).remove();
    await logChange('LG' + code, '„' + nm + '" Liga-Admin entzogen', 'admins/' + mid, true);
    showToast('Liga-Admin entzogen.', 'info'); openLigaDetail(code);
  } catch (e) { showToast('Fehler.', 'error'); }
}

// ── Teilen / Spiele / Verlassen / Löschen ──
export function ligaShare(code) {
  const url = location.origin + location.pathname + '?liga=LG' + code;
  navigator.share({ title: 'Doppelkopf Liga', text: 'Tritt meiner Liga bei! Code: LG-' + code, url }).catch(() => {});
}
export function ligaCopyLink(code) {
  const url = location.origin + location.pathname + '?liga=LG' + code;
  navigator.clipboard.writeText(url).then(() => showToast('Link kopiert!', 'info')).catch(() => showToast('LG-' + code, 'info'));
}
export async function ligaDeleteGame(code, gameId) {
  if (!await showConfirm('Diesen Spiel-Eintrag aus der Liga löschen?', 'Löschen', true)) return;
  try {
    const before = (await ligaRef(code).child('spiele/' + gameId).get()).val();
    await ligaRef(code).child('spiele/' + gameId).remove();
    await logChange('LG' + code, 'App-Spiel-Eintrag gelöscht', 'spiele/' + gameId, before, before ? gameSummaryText(before) : '');
    showToast('Eintrag gelöscht.', 'info'); openLigaDetail(code);
  } catch (e) { console.error('ligaDeleteGame:', e); showToast('Löschen fehlgeschlagen.', 'error'); }
}
export async function ligaLeave(code) {
  if (!await showConfirm('Diese Liga auf diesem Gerät verlassen? Die Liga-Daten bleiben für andere bestehen.', 'Verlassen', true)) return;
  state.ligen = (state.ligen || []).filter(l => l.code !== code);
  save();
  try { const own = await getOwnSpieler(); if (own) await ligaRef(code).child('members/' + own.id).remove(); } catch (e) { /* ignore */ }
  showToast('Liga verlassen.', 'info');
  renderLigaHome();
}
export async function ligaDeleteLeague(code) {
  if (!await showConfirm('Die GESAMTE Liga LG-' + code + ' unwiderruflich löschen (für alle)?', 'Endgültig löschen', true)) return;
  try { await ligaRef(code).remove(); state.ligen = (state.ligen || []).filter(l => l.code !== code); save(); showToast('Liga gelöscht.', 'info'); renderLigaHome(); }
  catch (e) { console.error('ligaDeleteLeague:', e); showToast('Löschen fehlgeschlagen.', 'error'); }
}

// ── Admin: alle Ligen ──
export async function ligaAdminAll() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'all' });
  el.innerHTML = modalHeader('Alle Ligen') + '<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  const all = await loadAllLigen();
  let h = modalHeader('Alle Ligen (Admin)');
  if (!all.length) h += '<div style="font-size:13px;color:var(--tx3);padding:8px 2px">Keine Ligen in der Datenbank.</div>';
  else {
    h += '<div class="card" style="padding:4px 0">';
    all.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((l, i) => {
      const np = l.players ? Object.keys(l.players).length : 0;
      const nm = l.members ? Object.keys(l.members).length : 0;
      h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;' + (i < all.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="flex:1;min-width:0;cursor:pointer" onclick="openLigaDetail(\'' + l.code + '\')"><div style="font-weight:500;word-break:break-word">' + esc(l.name || ('LG-' + l.code)) + '</div><div style="font-size:11px;color:var(--tx3)">LG-' + esc(l.code) + ' · ' + np + ' Spieler · ' + nm + ' Mitglieder</div></div>';
      h += '<button onclick="ligaDeleteLeague(\'' + l.code + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:28px;height:28px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;padding:0">' + ICO.trash + '</button>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
}

// ── Meine Ligen verwalten (nur die, wo ich Ersteller/Liga-Admin bin) ──
export async function ligaMyLeagues() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'my' });
  el.innerHTML = modalHeader('Meine Ligen') + '<div style="padding:30px;text-align:center;color:var(--tx3)">Lädt…</div>';
  const own = await getOwnSpieler().catch(() => null);
  const myId = own ? own.id : null;
  const globalAdmin = await isAdmin().catch(() => false);
  const items = [];
  for (const l of (state.ligen || [])) {
    let d; try { d = (await ligaRef(l.code).get()).val(); } catch (e) { d = null; }
    if (d && d.kind === 'liga' && isLigaAdmin(d, myId, globalAdmin)) items.push({ code: l.code, data: d });
  }
  let h = modalHeader('Meine Ligen verwalten');
  if (!items.length) h += '<div style="font-size:13px;color:var(--tx3);padding:8px 2px;line-height:1.5">Du verwaltest aktuell keine Liga. Hier erscheinen nur Ligen, in denen du Ersteller oder Liga-Admin bist.</div>';
  else {
    h += '<div class="card" style="padding:4px 0">';
    items.forEach(({ code, data: d }, i) => {
      const np = d.players ? Object.keys(d.players).length : 0;
      const nm = d.members ? Object.keys(d.members).length : 0;
      h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;' + (i < items.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '" onclick="openLigaDetail(\'' + code + '\')">';
      h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(d.name || ('LG-' + code)) + '</div><div style="font-size:11px;color:var(--tx3)">LG-' + esc(code) + ' · ' + np + ' Spieler · ' + nm + ' Mitglieder</div></div>';
      h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--tx3)"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    h += '</div>';
  }
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
}

// ── Historie der Liga (mit Rückgängig für Liga-Admins) ──
export async function openLigaHistory(code) {
  showLigaModal();
  ligaNav({ t: 'history', code });
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  const own = await getOwnSpieler().catch(() => null);
  const admin = isLigaAdmin(data || {}, own ? own.id : null, await isAdmin().catch(() => false));
  renderHistory('LG' + code, { title: 'Historie · LG-' + code, container: 'ligaModalContent', canUndo: admin, backOnclick: 'ligaBack()' });
}

// ── App-Spiel-Detail (Runden ansehen) ──
export async function openLigaGameDetail(code, gameId) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  ligaNav({ t: 'game', code, gameId });
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const g = (data.spiele || {})[gameId];
  if (!g) { showToast('Spiel nicht gefunden.', 'error'); openLigaDetail(code); return; }
  const rounds = gameRounds(g);
  const players = (g.players && g.players.length) ? g.players.slice() : (() => { const s = new Set(); rounds.forEach(r => r.playing.forEach(p => s.add(p))); return [...s]; })();
  const d = g.date ? new Date(g.date) : null;
  const dateStr = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const tot = {}; players.forEach(p => tot[p] = 0);
  rounds.forEach(r => r.playing.forEach(p => { tot[p] = (tot[p] || 0) + (r.scores[p] || 0); }));
  let h = modalHeader('Spiel' + (dateStr ? ' · ' + dateStr : ''));
  // Endstand
  h += '<div class="section-label">Endstand</div><div class="card">';
  players.slice().sort((a, b) => (tot[b] || 0) - (tot[a] || 0)).forEach((p, i, arr) => {
    h += '<div style="display:flex;justify-content:space-between;padding:7px 0;' + (i < arr.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '"><span>' + esc(p) + '</span><span class="' + ((tot[p] || 0) >= 0 ? 'pos' : 'neg') + '" style="font-family:\'Space Mono\',monospace;font-weight:700">' + ((tot[p] || 0) > 0 ? '+' : '') + (tot[p] || 0) + '</span></div>';
  });
  h += '</div>';
  // Runden
  h += '<div class="section-label" style="margin-top:16px">Runden (' + rounds.length + ')</div><div class="card" style="padding:4px 0">';
  if (!rounds.length) h += '<div style="padding:10px 12px;font-size:13px;color:var(--tx3)">Keine Runden.</div>';
  rounds.forEach((r, i) => {
    const detail = r.playing.map(p => esc(p) + ' ' + ((r.scores[p] || 0) > 0 ? '+' : '') + (r.scores[p] || 0)).join(' · ');
    const soloBadge = r.solo ? ' <span style="font-size:10px;color:var(--acc)">' + esc(r.soloType || 'Solo') + '</span>' : '';
    h += '<div style="padding:7px 12px;' + (i < rounds.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '"><div style="font-size:12px;font-weight:500">Runde ' + (i + 1) + (r.bock ? ' · Bock' : '') + soloBadge + '</div><div style="font-size:11px;color:var(--tx3)">' + detail + '</div></div>';
  });
  h += '</div>';
  const own = await getOwnSpieler().catch(() => null);
  const admin = isLigaAdmin(data, own ? own.id : null, await isAdmin().catch(() => false));
  if (admin) h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="ligaGameMapForm(\'' + code + '\',\'' + gameId + '\')">Spieler zuordnen / korrigieren</button>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
}

// ── Spiel in eine Liga aufnehmen (beim Beenden oder aus Archiv) ──
function ligaSig(snapshot) {
  const players = (snapshot.players || []).slice().sort().join('|');
  return (snapshot.gameStartTime || snapshot.date || '') + '#' + players + '#' + ((snapshot.rounds || []).length);
}
async function chooseLiga() {
  const ligen = state.ligen || [];
  if (!ligen.length) { showToast('Du bist in keiner Liga.', 'info'); return null; }
  const idx = await chooseFromList('In welche Liga aufnehmen?', ligen.map(l => l.name || ('LG-' + l.code)));
  return idx < 0 ? null : ligen[idx].code;
}
// Schreibt ein Spiel in die Liga. Runden als JSON-String (roundsJson) → keine Firebase-
// Schlüsselverbote durch Spielernamen mit Sonderzeichen (. # $ [ ] /). Dedup via sig.
async function pushGameToLiga(code, snapshot, map) {
  const own = await getOwnSpieler().catch(() => null);
  const sig = ligaSig(snapshot);
  try {
    const snap = await ligaRef(code).child('spiele').get();
    const existing = snap.val() || {};
    if (Object.values(existing).some(g => g && g.sig === sig)) { showToast('Dieses Spiel ist schon in der Liga.', 'info'); return false; }
    const ref = ligaRef(code).child('spiele').push();
    await ref.set({
      date: snapshot.date || new Date().toISOString(),
      players: snapshot.players || [],
      roundsJson: JSON.stringify(snapshot.rounds || []),
      mapJson: JSON.stringify(map || {}),
      addedBy: own ? own.id : null,
      addedByName: own ? (own.name || '') : (state.myPlayer || ''),
      addedAt: firebase.database.ServerValue.TIMESTAMP,
      sig
    });
    await logChange('LG' + code, 'App-Spiel aufgenommen', 'spiele/' + ref.key, null, gameSummaryText(snapshot));
    showToast('Spiel in die Liga aufgenommen.', 'info');
    return true;
  } catch (e) {
    console.error('pushGameToLiga:', e);
    showToast('Konnte Spiel nicht in die Liga schreiben: ' + (e && e.message || e), 'error');
    return false;
  }
}
export async function addCurrentGameToLiga(snapshot) {
  const ligen = state.ligen || [];
  if (!ligen.length || !initFirebase()) return;
  if (state.ligaAskOnEnd === false) return; // Frage in den Einstellungen abgeschaltet → nur manuell
  let code;
  const def = state.ligaDefaultCode && ligen.find(l => l.code === state.ligaDefaultCode);
  if (def) {
    const ok = await showConfirm('Dieses Spiel in die Liga „' + (def.name || ('LG-' + def.code)) + '" aufnehmen?', 'In Liga aufnehmen');
    if (!ok) return;
    code = def.code;
  } else if (ligen.length === 1) {
    const ok = await showConfirm('Dieses Spiel in die Liga „' + (ligen[0].name || ('LG-' + ligen[0].code)) + '" aufnehmen?', 'In Liga aufnehmen');
    if (!ok) return;
    code = ligen[0].code;
  } else {
    code = await chooseLiga();
    if (!code) return;
  }
  await ligaAddGameWithMapping(code, snapshot);
}
// Aus dem Spiele-Archiv heraus ein Spiel in eine Liga aufnehmen (Liga-Auswahl).
export async function ligaAddGameToLeagueFromArchive(archiveId) {
  const ligen = state.ligen || [];
  if (!ligen.length) { showToast('Du bist in keiner Liga.', 'info'); return; }
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  const g = loadArchive().find(x => String(x.id) === String(archiveId));
  if (!g) { showToast('Spiel nicht gefunden.', 'error'); return; }
  let code;
  if (ligen.length === 1) code = ligen[0].code;
  else { code = await chooseLiga(); if (!code) return; }
  await ligaAddGameWithMapping(code, { date: g.date, gameStartTime: g.gameStartTime, players: g.players || [], rounds: g.rounds || [] });
}
// Nachträglich ein Spiel aus dem lokalen Geräte-Archiv aufnehmen – Auswahlliste, neuestes oben.
export async function ligaAddArchivedGame(code) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'archive', code });
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  const archive = loadArchive().slice().sort((a, b) => (new Date(b.date) - new Date(a.date)) || ((b.id || 0) - (a.id || 0)));
  let h = modalHeader('Spiel aus Archiv aufnehmen');
  if (!archive.length) {
    h += '<div style="font-size:13px;color:var(--tx3);padding:10px 2px">Kein Spiel im Geräte-Archiv vorhanden.</div>';
  } else {
    h += '<div class="card" style="padding:4px 0">';
    archive.forEach((g, i) => {
      const d = g.date ? new Date(g.date) : null;
      const ds = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      const rounds = g.rounds || [];
      const tot = {}; (g.players || []).forEach(p => tot[p] = 0);
      rounds.forEach(r => (r.playing || []).forEach(p => { tot[p] = (tot[p] || 0) + ((r.scores && r.scores[p]) || 0); }));
      const arr = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
      const winner = arr.length ? esc(arr[0]) + ' (' + (tot[arr[0]] > 0 ? '+' : '') + tot[arr[0]] + ')' : '–';
      h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;' + (i < archive.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '" onclick="ligaConfirmArchivedGame(\'' + code + '\',\'' + g.id + '\')">';
      h += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">' + ds + ' · ' + rounds.length + ' Runden</div>';
      h += '<div style="font-size:11px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc((g.players || []).join(', ')) + '</div>';
      h += '<div style="font-size:11px;color:var(--tx3)">Sieger: ' + winner + '</div></div>';
      h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--tx3)"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    h += '</div>';
  }
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="ligaBack()">Zurück</button>';
  el.innerHTML = h;
}
export async function ligaConfirmArchivedGame(code, archiveId) {
  const g = loadArchive().find(x => String(x.id) === String(archiveId));
  if (!g) { showToast('Spiel nicht gefunden.', 'error'); return; }
  await ligaAddGameWithMapping(code, { date: g.date, gameStartTime: g.gameStartTime, players: g.players || [], rounds: g.rounds || [] });
}

// ── Spieler-Zuordnung beim Aufnehmen / Korrigieren (Kreuztabelle) ──
// Sammelt alle Spielernamen eines Snapshots (players[] bzw. aus den Runden abgeleitet).
function snapshotNames(snapshot) {
  if (snapshot.players && snapshot.players.length) return snapshot.players.slice();
  const s = new Set();
  (snapshot.rounds || []).forEach(r => (r.playing || []).forEach(p => s.add(p)));
  return [...s];
}
// Pending-Zuordnung (Modul-Var), genutzt vom Formular + Speichern.
let pendingGameMap = null;
// Zentrale Aufnahme: Spielernamen werden mit den vorhandenen Liga-Spielern abgeglichen.
// - Exakter Namens-Treffer → automatisch zugeordnet.
// - Kein Treffer, aber ein ähnlicher vorhandener Spieler → unklar → Zuordnungs-Formular.
// - Gar kein ähnlicher Spieler → neuer Spieler, wird ohne Nachfrage angelegt.
async function ligaAddGameWithMapping(code, snapshot) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const players = data.players || {};
  const pEntries = Object.entries(players);
  const nameIdx = {};
  pEntries.forEach(([pid, p]) => { if (p && p.name) nameIdx[String(p.name).toLowerCase()] = pid; });
  const names = snapshotNames(snapshot);
  const map = {};
  const newNames = []; // ganz neue Spieler (kein ähnlicher vorhanden) → ohne Nachfrage anlegen
  let unclear = false;
  names.forEach(n => {
    const exact = nameIdx[String(n).toLowerCase()];
    if (exact) { map[n] = exact; return; }
    if (pEntries.some(([, p]) => similar(p.name, n))) { unclear = true; return; } // könnte ein vorhandener sein
    newNames.push(n);
  });
  if (unclear) { pendingGameMap = { code, gameId: null, snapshot, names }; ligaGameMapForm(code, null); return; }
  // Alles eindeutig: neue Spieler anlegen und Spiel direkt aufnehmen.
  try {
    for (const n of newNames) {
      const ref = ligaRef(code).child('players').push();
      await ref.set({ name: String(n).trim() });
      await logChange('LG' + code, 'Spieler „' + String(n).trim() + '" hinzugefügt', 'players/' + ref.key, null);
      map[n] = ref.key;
    }
  } catch (e) { console.error('ligaAddGameWithMapping:', e); showToast('Konnte Spieler nicht anlegen: ' + (e && e.message || e), 'error'); return; }
  const ok = await pushGameToLiga(code, snapshot, map);
  if (ok) openLigaDetail(code);
}

// Zuordnungs-Formular: je Spielername ein <select> (Roster-Spieler + „neu anlegen").
// gameId gesetzt → bestehendes Spiel korrigieren; sonst Neu-Aufnahme über pendingGameMap.
export async function ligaGameMapForm(code, gameId) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
  ligaNav({ t: 'gamemap', code, gameId: gameId || '' });
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const players = data.players || {};
  const pEntries = Object.entries(players).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  const nameIdx = {};
  Object.entries(players).forEach(([pid, p]) => { if (p && p.name) nameIdx[String(p.name).toLowerCase()] = pid; });
  let names, existingMap = {};
  if (gameId) {
    const g = (data.spiele || {})[gameId];
    if (!g) { showToast('Spiel nicht gefunden.', 'error'); openLigaDetail(code); return; }
    names = snapshotNames({ players: g.players, rounds: gameRounds(g) });
    existingMap = gameMap(g);
    pendingGameMap = { code, gameId, snapshot: null, names };
  } else {
    if (!pendingGameMap || pendingGameMap.code !== code) { showToast('Kein Spiel zum Zuordnen.', 'error'); openLigaDetail(code); return; }
    names = pendingGameMap.names;
  }
  let h = modalHeader('Spieler zuordnen');
  h += '<div style="font-size:12px;color:var(--tx3);line-height:1.5;margin:2px 0 12px">Ordne jeden Spielernamen einem vorhandenen Liga-Spieler zu oder lege ihn neu an. So zählt dieselbe Person nur einmal – auch wenn sie unterschiedlich geschrieben wurde.</div>';
  h += '<div class="card" style="padding:4px 0">';
  names.forEach((n, i) => {
    // Vorauswahl: bestehende Zuordnung → exakter Treffer → ähnlicher Treffer → neu.
    let sel = existingMap[n] && players[existingMap[n]] ? existingMap[n] : (nameIdx[String(n).toLowerCase()] || '');
    let unclear = false;
    if (!sel) {
      const simHit = pEntries.find(([, p]) => similar(p.name, n));
      if (simHit) { sel = simHit[0]; unclear = true; } else { sel = '__new__'; } // neuer Spieler: nicht markieren
    }
    h += '<div style="padding:9px 12px;' + (i < names.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + (unclear ? ';border-left:3px solid var(--neg,#d23)' : '') + '">';
    h += '<div style="font-size:11px;color:var(--tx3);margin-bottom:4px">Spielername</div>';
    h += '<div style="font-weight:600;margin-bottom:6px;word-break:break-word">' + esc(n) + (unclear ? ' <span style="font-size:10px;color:var(--neg,#d23);font-weight:500">· bitte prüfen</span>' : '') + '</div>';
    h += '<select id="ligamap_' + i + '" data-name="' + esc(n) + '" style="width:100%;padding:8px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg3);color:var(--tx);font-size:13px">';
    pEntries.forEach(([pid, p]) => { h += '<option value="' + pid + '"' + (pid === sel ? ' selected' : '') + '>' + esc(p.name || '?') + '</option>'; });
    h += '<option value="__new__"' + (sel === '__new__' ? ' selected' : '') + '>➕ neu anlegen: ' + esc(n) + '</option>';
    h += '</select></div>';
  });
  h += '</div>';
  h += '<button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="ligaSaveGameMapping(\'' + code + '\')">Speichern</button>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaBack()">Abbrechen</button>';
  el.innerHTML = h;
}

// Speichert die Zuordnung: „neu"-Auswahlen als Roster-Spieler anlegen, Map bauen, dann Spiel
// schreiben (Neu-Aufnahme) bzw. mapJson aktualisieren (Korrektur eines bestehenden Spiels).
export async function ligaSaveGameMapping(code) {
  if (!pendingGameMap || pendingGameMap.code !== code) { showToast('Keine Zuordnung offen.', 'error'); return; }
  const { gameId, snapshot, names } = pendingGameMap;
  const map = {};
  try {
    for (let i = 0; i < names.length; i++) {
      const sel = document.getElementById('ligamap_' + i);
      const n = names[i];
      let pid = sel ? sel.value : '__new__';
      if (pid === '__new__') {
        const ref = ligaRef(code).child('players').push();
        await ref.set({ name: String(n).trim() });
        await logChange('LG' + code, 'Spieler „' + String(n).trim() + '" hinzugefügt', 'players/' + ref.key, null);
        pid = ref.key;
      }
      map[n] = pid;
    }
    if (gameId) {
      await ligaRef(code).child('spiele/' + gameId + '/mapJson').set(JSON.stringify(map));
      await logChange('LG' + code, 'Spieler-Zuordnung geändert', 'spiele/' + gameId + '/mapJson', null);
      showToast('Zuordnung gespeichert.', 'info');
      pendingGameMap = null;
      openLigaDetail(code);
    } else {
      pendingGameMap = null;
      const ok = await pushGameToLiga(code, snapshot, map);
      if (ok) openLigaDetail(code);
    }
  } catch (e) { console.error('ligaSaveGameMapping:', e); showToast('Zuordnung fehlgeschlagen: ' + (e && e.message || e), 'error'); }
}

// Zwei Roster-Spieler zusammenführen: Quell-pid → Ziel-pid in allen Spielen (mapJson) und
// Terminen, dann Quell-Spieler löschen.
export async function ligaMergePlayer(code, pid) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const players = data.players || {};
  const src = players[pid];
  if (!src) { showToast('Spieler nicht gefunden.', 'error'); return; }
  const others = Object.entries(players).filter(([id]) => id !== pid);
  if (!others.length) { showToast('Kein anderer Spieler zum Zusammenführen.', 'info'); return; }
  const idx = await chooseFromList('„' + (src.name || '?') + '" zusammenführen mit …', others.map(([, p]) => p.name || '?'));
  if (idx < 0) return;
  const [tpid, tp] = others[idx];
  if (!await showConfirm('„' + (src.name || '?') + '" in „' + (tp.name || '?') + '" zusammenführen? Alle Spiele und Termin-Punkte werden übertragen, „' + (src.name || '?') + '" wird gelöscht.', 'Zusammenführen', true)) return;
  const nameIdx = {};
  Object.entries(players).forEach(([id, p]) => { if (p && p.name) nameIdx[String(p.name).toLowerCase()] = id; });
  try {
    // Spiele: jeden Namen, der aktuell auf die Quelle zeigt (Map oder exakter Treffer), auf Ziel umbiegen.
    const games = data.spiele || {};
    for (const [gid, g] of Object.entries(games)) {
      const m = gameMap(g);
      const names = snapshotNames({ players: g.players, rounds: gameRounds(g) });
      let changed = false;
      names.forEach(n => {
        const cur = (m[n] && players[m[n]]) ? m[n] : (nameIdx[String(n).toLowerCase()] || null);
        if (cur === pid) { m[n] = tpid; changed = true; }
      });
      if (changed) await ligaRef(code).child('spiele/' + gid + '/mapJson').set(JSON.stringify(m));
    }
    // Termine: Punkte der Quelle auf das Ziel aufaddieren.
    const termine = data.termine || {};
    for (const [tid, t] of Object.entries(termine)) {
      const pts = t.points || {};
      if (pts[pid] != null) {
        const merged = (Number(pts[tpid]) || 0) + (Number(pts[pid]) || 0);
        await ligaRef(code).child('termine/' + tid + '/points/' + tpid).set(merged);
        await ligaRef(code).child('termine/' + tid + '/points/' + pid).remove();
      }
    }
    // Quell-Spieler löschen.
    await ligaRef(code).child('players/' + pid).remove();
    await logChange('LG' + code, 'Spieler zusammengeführt: „' + (src.name || '?') + '" → „' + (tp.name || '?') + '"', 'players/' + pid, src);
    showToast('Spieler zusammengeführt.', 'info');
    openLigaDetail(code);
  } catch (e) { console.error('ligaMergePlayer:', e); showToast('Zusammenführen fehlgeschlagen: ' + (e && e.message || e), 'error'); }
}

// Per-Liga-Einstellung: Zahlbetrag (negative Abende summieren) an/aus.
export async function ligaSetPayMode(code, on) {
  try {
    if (on) await ligaRef(code).child('settings/payMode').set(true);
    else await ligaRef(code).child('settings/payMode').remove();
    await logChange('LG' + code, 'Zahlbetrag-Anzeige ' + (on ? 'aktiviert' : 'deaktiviert'), 'settings/payMode', null);
    openLigaDetail(code);
  } catch (e) { console.error('ligaSetPayMode:', e); showToast('Einstellung fehlgeschlagen.', 'error'); }
}

// ── Deep-Link: ?liga=LG<code> (öffentlich) ──
export function checkLigaUrlParam() {
  const params = new URLSearchParams(location.search);
  const liga = params.get('liga');
  if (!liga) return;
  history.replaceState(null, '', location.pathname);
  const code = liga.replace(/[^0-9]/g, '').slice(-4);
  if (!/^\d{4}$/.test(code)) return;
  setTimeout(() => { showLigaModal(); openLigaDetail(code); }, 600);
}

// Klick auf den Hintergrund schließt das Liga-Fenster komplett (und leert den Navigations-Stack).
const _ligaModalEl = document.getElementById('ligaModal');
if (_ligaModalEl) _ligaModalEl.addEventListener('click', function (e) { if (e.target === this) closeLigaModal(); });
