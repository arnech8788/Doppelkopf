// liga.js – Ligabereich (öffentlich, „wie Turniere"). Ligen liegen im offenen Firebase-Pfad
// turniere/LG<code> (kind:'liga'). Jede:r kann anlegen/beitreten. Rollen: globale Admins +
// Liga-Ersteller + per Ersteller ernannte Liga-Admins verwalten. Gesamttabelle = manuelle
// Termin-Punkte + Punkte aus eingetragenen App-Spielen (computeStandings, Match per Name).
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { state, save } from './main.js';
import { showToast, showConfirm, showPrompt, ICO } from './ui.js';
import { initFirebase, getOwnSpieler, getDeviceId, isAdmin, generateQR, loadAllLigen } from './turnier.js';
import { computeStandings, loadArchive } from './archiv.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ligaRef = code => firebase.database().ref('turniere/LG' + code);
// Runden eines App-Spiels: bevorzugt als JSON-String (roundsJson) gespeichert, da Spielernamen
// als Objekt-Schlüssel in scores sonst Firebase-verbotene Zeichen (. # $ [ ] /) enthalten können.
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return []; } }
const gameRounds = g => (g && (g.rounds || (g.roundsJson ? safeParse(g.roundsJson) : []))) || [];

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
  let h = '';
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
  // Globale Admins bekommen zusätzlich „Alle Ligen verwalten".
  try {
    if (await isAdmin()) {
      el.innerHTML += '<div style="margin-top:8px"><button class="btn btn-secondary" style="width:100%;font-size:13px" onclick="ligaAdminAll()">Alle Ligen verwalten</button></div>';
    }
  } catch (e) { /* ignore */ }
}

function modalHeader(title) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    + '<h3 style="margin:0">' + title + '</h3>'
    + '<button onclick="closeLigaModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">' + ICO.x + '</button></div>';
}
function showLigaModal() { document.getElementById('ligaModal').classList.add('show'); }
export function closeLigaModal() {
  document.getElementById('ligaModal').classList.remove('show');
  renderLigaSetup();
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
  let h = modalHeader('Liga beitreten');
  h += '<div class="card"><label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Liga-Code</label>'
    + '<div style="display:flex;align-items:center;gap:6px"><span style="font-weight:600;color:var(--tx2)">LG-</span>'
    + '<input type="text" id="ligaJoinCodeInput" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="4729" style="font-size:16px;padding:10px;letter-spacing:4px;text-align:center;flex:1"></div></div>';
  h += '<div style="display:flex;gap:8px;margin-top:10px">'
    + '<button class="btn btn-primary" style="flex:1" onclick="ligaJoinFromInput()">Beitreten</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openQrScanner(\'liga\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;vertical-align:-2px"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg> QR scannen</button></div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="renderLigaHome()">Zurück</button>';
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
  addLocalLiga(code, data.name || '');
  showToast('Liga „' + (data.name || ('LG-' + code)) + '" beigetreten.', 'info');
  await ligaSuggestClaim(code, data, own);
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

// ── Gesamttabelle berechnen: manuelle Termin-Punkte + App-Spiele (per Name) ──
function ligaStandings(data) {
  const players = data.players || {};
  const termine = data.termine || {};
  const games = Object.entries(data.spiele || {}).map(([id, g]) => ({ id, ...g, rounds: gameRounds(g) }));
  const gs = games.length ? computeStandings(games) : { stats: {} };
  const manual = {};
  Object.keys(players).forEach(pid => manual[pid] = 0);
  Object.values(termine).forEach(t => { const pts = t.points || {}; Object.entries(pts).forEach(([pid, v]) => { manual[pid] = (manual[pid] || 0) + (Number(v) || 0); }); });
  const rows = [];
  const usedNames = new Set();
  Object.entries(players).forEach(([pid, p]) => {
    const name = p.name || '?';
    usedNames.add(name);
    const g = gs.stats[name];
    rows.push({ pid, name, claimedByName: p.claimedByName || null, manuell: manual[pid] || 0, spiel: g ? g.punkte : 0, spiele: g ? g.abende : 0, runden: g ? g.spiele : 0, siege: g ? g.siege : 0, soloWins: g ? g.soloWins : 0, soloTotal: g ? g.soloTotal : 0 });
  });
  Object.keys(gs.stats || {}).forEach(name => {
    if (usedNames.has(name)) return;
    const g = gs.stats[name];
    rows.push({ pid: null, name, claimedByName: null, manuell: 0, spiel: g.punkte, spiele: g.abende, runden: g.spiele, siege: g.siege, soloWins: g.soloWins, soloTotal: g.soloTotal });
  });
  rows.forEach(r => r.total = r.manuell + r.spiel);
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return rows;
}

// ── Detailansicht einer Liga ──
export async function openLigaDetail(code) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  showLigaModal();
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

  // Gesamttabelle
  const rows = ligaStandings(data);
  h += '<div class="section-label">Gesamttabelle</div>';
  if (!rows.length) {
    h += '<div class="card" style="font-size:13px;color:var(--tx3)">Noch keine Punkte. ' + (admin ? 'Lege Spieler an und trage Termin-Punkte ein oder nimm App-Spiele auf.' : 'Es wurden noch keine Stände eingetragen.') + '</div>';
  } else {
    h += '<div class="card">';
    rows.forEach((r, i) => {
      const rc = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      h += '<div style="padding:10px 0;' + (i < rows.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500"><span class="rank ' + rc + '" style="display:inline-flex;width:20px;height:20px;font-size:11px;margin-right:6px">' + (i + 1) + '</span>' + esc(r.name) + (r.claimedByName ? ' <span style="font-size:10px;color:var(--tx3)">✓</span>' : '') + '</span><span class="' + (r.total >= 0 ? 'pos' : 'neg') + '" style="font-family:\'Space Mono\',monospace;font-weight:700">' + (r.total > 0 ? '+' : '') + r.total + '</span></div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;color:var(--tx3);margin-left:26px">';
      h += '<span>Manuell: ' + (r.manuell > 0 ? '+' : '') + r.manuell + '</span><span>App-Spiele: ' + (r.spiel > 0 ? '+' : '') + r.spiel + '</span>';
      if (r.runden) h += '<span>Runden: ' + r.runden + '</span><span>Siege: ' + Math.round(r.siege / r.runden * 100) + '%</span>';
      if (r.soloTotal) h += '<span>Soli: ' + r.soloWins + '/' + r.soloTotal + '</span>';
      h += '</div></div>';
    });
    h += '</div>';
  }

  // Spieler (Roster)
  h += '<div class="section-label" style="margin-top:20px">Spieler' + (admin ? ' <span style="font-weight:400;color:var(--tx3);font-size:11px">· Roster verwalten</span>' : '') + '</div>';
  h += '<div class="card" style="padding:4px 0">';
  const pEntries = Object.entries(players);
  if (!pEntries.length) h += '<div style="padding:10px 12px;font-size:13px;color:var(--tx3)">Noch keine Spieler.</div>';
  pEntries.sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '')).forEach(([pid, p], i) => {
    h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + (i < pEntries.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
    h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(p.name || '?') + '</div>';
    h += '<div style="font-size:11px;color:var(--tx3)">' + (p.claimedByName ? 'verknüpft mit ' + esc(p.claimedByName) : 'nicht verknüpft') + '</div></div>';
    if (admin) {
      h += '<button onclick="ligaSetClaim(\'' + code + '\',\'' + pid + '\')" title="Verknüpfen" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:28px;border-radius:var(--r-sm);padding:0 8px;font-size:11px">Verknüpfen</button>';
      h += '<button onclick="ligaRenamePlayer(\'' + code + '\',\'' + pid + '\')" title="Umbenennen" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:28px;height:28px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;padding:0">' + ICO.edit + '</button>';
      h += '<button onclick="ligaDeletePlayer(\'' + code + '\',\'' + pid + '\')" title="Löschen" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:28px;height:28px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;padding:0">' + ICO.trash + '</button>';
    }
    h += '</div>';
  });
  h += '</div>';
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

  // Fußzeile
  h += '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn btn-secondary" style="flex:1" onclick="openLigaDetail(\'' + code + '\')">Aktualisieren</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="renderLigaHome()">Übersicht</button></div>';
  if (joined) h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaLeave(\'' + code + '\')">Liga verlassen</button>';
  if (isCreator) h += '<button class="btn btn-secondary danger" style="width:100%;margin-top:8px;color:var(--neg,#d23);border-color:var(--neg,#d23)" onclick="ligaDeleteLeague(\'' + code + '\')">Liga löschen</button>';
  el.innerHTML = h;
}

// „Übersicht" (im Modal): meine Ligen + anlegen/beitreten
export function renderLigaHome() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
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
  try { await ligaRef(code).child('players').push().set({ name: name.trim() }); openLigaDetail(code); }
  catch (e) { console.error('ligaAddPlayer:', e); showToast('Hinzufügen fehlgeschlagen.', 'error'); }
}
export async function ligaRenamePlayer(code, pid) {
  const name = await showPrompt('Neuer Name:', '', 'Umbenennen');
  if (!name) return;
  try { await ligaRef(code).child('players/' + pid + '/name').set(name.trim()); openLigaDetail(code); }
  catch (e) { showToast('Umbenennen fehlgeschlagen.', 'error'); }
}
export async function ligaDeletePlayer(code, pid) {
  if (!await showConfirm('Diesen Spieler aus der Liga entfernen? (Termin-Einträge zu ihm bleiben, zählen aber nicht mehr.)', 'Löschen', true)) return;
  try { await ligaRef(code).child('players/' + pid).remove(); openLigaDetail(code); }
  catch (e) { showToast('Löschen fehlgeschlagen.', 'error'); }
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
  try {
    if (idx === members.length) await ligaRef(code).child('players/' + pid).update({ claimedBy: null, claimedByName: null });
    else { const [mid, m] = members[idx]; await ligaRef(code).child('players/' + pid).update({ claimedBy: mid, claimedByName: m.name || '' }); }
    openLigaDetail(code);
  } catch (e) { showToast('Verknüpfen fehlgeschlagen.', 'error'); }
}

async function chooseFromList(title, labels) {
  if (!labels.length) { showToast('Keine Auswahl verfügbar.', 'info'); return -1; }
  const list = labels.map((l, i) => (i + 1) + ') ' + l).join('\n');
  const ans = await showPrompt(title + '<br><span style="font-size:12px;color:var(--tx3);white-space:pre-line">' + esc(list) + '</span>', '1', 'OK');
  if (!ans) return -1;
  const idx = parseInt(ans, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= labels.length) { showToast('Ungültige Auswahl.', 'error'); return -1; }
  return idx;
}

// ── Termine (manuelle Punkte): Detail ansehen, neu anlegen, bearbeiten ──
export async function openLigaTerminDetail(code, id) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
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
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="openLigaDetail(\'' + code + '\')">Zurück</button>';
  el.innerHTML = h;
}
// „+ Termin eintragen" (ohne id) bzw. Bearbeiten (mit id). Felder bei Bearbeiten vorbelegt.
export async function ligaAddTerminForm(code) { return ligaTerminForm(code); }
export async function ligaTerminForm(code, id) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); return; }
  const players = Object.entries(data.players || {}).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
  const t = id ? (data.termine || {})[id] : null;
  const pts = t && t.points || {};
  const dateVal = (t && t.date) || new Date().toISOString().slice(0, 10);
  const labelVal = (t && t.label) || '';
  let h = modalHeader(id ? 'Termin bearbeiten' : 'Termin eintragen');
  h += '<div class="card"><div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<div style="flex:1"><label style="font-size:11px;color:var(--tx2)">Datum</label><input type="date" id="ltDate" value="' + dateVal + '" style="width:100%;box-sizing:border-box;padding:8px"></div>'
    + '<div style="flex:1"><label style="font-size:11px;color:var(--tx2)">Bezeichnung (optional)</label><input type="text" id="ltLabel" value="' + esc(labelVal) + '" placeholder="z. B. Spieltag 5" style="width:100%;box-sizing:border-box;padding:8px"></div></div>';
  if (!players.length) {
    h += '<div style="font-size:13px;color:var(--tx3);padding:6px 0">Noch keine Spieler – bitte zuerst Spieler anlegen.</div>';
  } else {
    h += '<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">Punkte je Spieler (leer = 0):</div>';
    players.forEach(([pid, p]) => {
      const v = pts[pid] != null ? pts[pid] : '';
      h += '<div style="display:flex;align-items:center;gap:8px;padding:5px 0"><div style="flex:1;word-break:break-word">' + esc(p.name || '?') + '</div>'
        + '<input type="number" id="lt_' + pid + '" value="' + v + '" inputmode="numeric" placeholder="0" style="width:90px;padding:8px;text-align:right"></div>';
    });
  }
  h += '</div>';
  h += '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-secondary" style="flex:1" onclick="ligaAddPlayer(\'' + code + '\')">+ Spieler</button>';
  if (players.length) h += '<button class="btn btn-primary" style="flex:1" onclick="ligaSaveTermin(\'' + code + '\'' + (id ? ',\'' + id + '\'' : '') + ')">Speichern</button>';
  h += '</div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="' + (id ? 'openLigaTerminDetail(\'' + code + '\',\'' + id + '\')' : 'openLigaDetail(\'' + code + '\')') + '">Abbrechen</button>';
  el.innerHTML = h;
}
export async function ligaSaveTermin(code, id) {
  let data; try { data = (await ligaRef(code).get()).val(); } catch (e) { return; }
  if (!data) return;
  const date = (document.getElementById('ltDate') || {}).value || new Date().toISOString().slice(0, 10);
  const label = ((document.getElementById('ltLabel') || {}).value || '').trim();
  const points = {};
  Object.keys(data.players || {}).forEach(pid => {
    const inp = document.getElementById('lt_' + pid);
    if (inp && inp.value !== '' && !isNaN(parseInt(inp.value, 10))) points[pid] = parseInt(inp.value, 10);
  });
  if (!Object.keys(points).length) { showToast('Keine Punkte eingegeben.', 'info'); return; }
  const own = await getOwnSpieler().catch(() => null);
  try {
    if (id) {
      await ligaRef(code).child('termine/' + id).update({ date, label: label || null, points });
      showToast('Termin aktualisiert.', 'info');
    } else {
      await ligaRef(code).child('termine').push().set({ date, label: label || null, points, addedBy: own ? own.id : null, addedAt: firebase.database.ServerValue.TIMESTAMP });
      showToast('Termin gespeichert.', 'info');
    }
    openLigaDetail(code);
  } catch (e) { console.error('ligaSaveTermin:', e); showToast('Speichern fehlgeschlagen: ' + (e && e.message || e), 'error'); }
}
export async function ligaDeleteTermin(code, id) {
  if (!await showConfirm('Diesen Termin löschen?', 'Löschen', true)) return;
  try { await ligaRef(code).child('termine/' + id).remove(); openLigaDetail(code); }
  catch (e) { showToast('Löschen fehlgeschlagen.', 'error'); }
}

// ── Rollen ──
export async function ligaPromote(code, mid) {
  try { await ligaRef(code).child('admins/' + mid).set(true); showToast('Ist jetzt Liga-Admin.', 'info'); openLigaDetail(code); }
  catch (e) { showToast('Fehler.', 'error'); }
}
export async function ligaDemote(code, mid) {
  try { await ligaRef(code).child('admins/' + mid).remove(); showToast('Liga-Admin entzogen.', 'info'); openLigaDetail(code); }
  catch (e) { showToast('Fehler.', 'error'); }
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
  try { await ligaRef(code).child('spiele/' + gameId).remove(); showToast('Eintrag gelöscht.', 'info'); openLigaDetail(code); }
  catch (e) { console.error('ligaDeleteGame:', e); showToast('Löschen fehlgeschlagen.', 'error'); }
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
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="renderLigaHome()">Zurück</button>';
  el.innerHTML = h;
}

// ── App-Spiel-Detail (Runden ansehen) ──
export async function openLigaGameDetail(code, gameId) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
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
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="openLigaDetail(\'' + code + '\')">Zurück</button>';
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
async function pushGameToLiga(code, snapshot) {
  const own = await getOwnSpieler().catch(() => null);
  const sig = ligaSig(snapshot);
  try {
    const snap = await ligaRef(code).child('spiele').get();
    const existing = snap.val() || {};
    if (Object.values(existing).some(g => g && g.sig === sig)) { showToast('Dieses Spiel ist schon in der Liga.', 'info'); return false; }
    await ligaRef(code).child('spiele').push().set({
      date: snapshot.date || new Date().toISOString(),
      players: snapshot.players || [],
      roundsJson: JSON.stringify(snapshot.rounds || []),
      addedBy: own ? own.id : null,
      addedByName: own ? (own.name || '') : (state.myPlayer || ''),
      addedAt: firebase.database.ServerValue.TIMESTAMP,
      sig
    });
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
  let code;
  if (ligen.length === 1) {
    const ok = await showConfirm('Dieses Spiel in die Liga „' + (ligen[0].name || ('LG-' + ligen[0].code)) + '" aufnehmen?', 'In Liga aufnehmen');
    if (!ok) return;
    code = ligen[0].code;
  } else {
    code = await chooseLiga();
    if (!code) return;
  }
  await pushGameToLiga(code, snapshot);
}
// Nachträglich ein Spiel aus dem lokalen Geräte-Archiv aufnehmen.
export async function ligaAddArchivedGame(code) {
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  const archive = loadArchive();
  if (!archive.length) { showToast('Kein Spiel im Archiv.', 'info'); return; }
  const labels = archive.map(g => {
    const d = g.date ? new Date(g.date) : null;
    const ds = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
    return ds + ' · ' + (g.players || []).join(', ').slice(0, 40);
  });
  const idx = await chooseFromList('Welches Spiel aus dem Archiv aufnehmen?', labels);
  if (idx < 0) return;
  const g = archive[idx];
  const ok = await pushGameToLiga(code, { date: g.date, gameStartTime: g.gameStartTime, players: g.players || [], rounds: g.rounds || [] });
  if (ok) openLigaDetail(code);
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
