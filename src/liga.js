// liga.js – Ligabereich: admin-freischaltbare Liga-Tabellen mit Beitrittscode.
// Ligen liegen im offenen Firebase-Pfad turniere/LG<code> (kind:'liga') – keine Regeländerung.
// Zugang wird clientseitig über canLiga() gegated. Spiele sind Schnappschüsse wie im Archiv;
// die Gesamttabelle wird clientseitig via computeStandings (archiv.js) berechnet.
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { state, save } from './main.js';
import { showToast, showConfirm, showPrompt, ICO } from './ui.js';
import { initFirebase, getOwnSpieler, getDeviceId, canLiga, isAdmin, generateQR } from './turnier.js';
import { computeStandings } from './archiv.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ligaRef = code => firebase.database().ref('turniere/LG' + code);

// ── Lokale Liga-Liste (state.ligen = [{code,name}]) ──
function addLocalLiga(code, name) {
  if (!Array.isArray(state.ligen)) state.ligen = [];
  if (!state.ligen.some(l => l.code === code)) state.ligen.push({ code, name: name || '' });
  else if (name) state.ligen = state.ligen.map(l => l.code === code ? { code, name } : l);
  save();
}

// ── Mehr-Screen-Eintrag (nur bei Berechtigung) ──
export async function fillLigaEntry() {
  const el = document.getElementById('ligaEntrySlot');
  if (!el) return;
  let allowed = false, admin = false;
  try { allowed = await canLiga(); admin = await isAdmin(); } catch (e) { allowed = false; }
  if (!allowed) { el.innerHTML = ''; return; }
  const label = admin ? '' : '<div class="section-label" style="margin-top:20px">Liga</div>';
  const n = (state.ligen || []).length;
  el.innerHTML = label + '<div class="card" style="cursor:pointer;border-color:var(--acc)" onclick="openLigaModal()">'
    + '<div style="display:flex;align-items:center;gap:10px">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc)"><path d="M8 21h8M12 17v4M6 4h12v4a6 6 0 01-12 0V4zM6 6H3v1a3 3 0 003 3M18 6h3v1a3 3 0 01-3 3"/></svg>'
    + '<div><div style="font-weight:500">Liga</div><div style="font-size:11px;color:var(--tx3)">'
    + (n ? n + ' Liga' + (n > 1 ? 'en' : '') + ' · Gesamttabelle' : 'Liga anlegen oder beitreten') + '</div></div></div></div>';
}

function modalHeader(title) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    + '<h3 style="margin:0">' + title + '</h3>'
    + '<button onclick="closeLigaModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">' + ICO.x + '</button></div>';
}

export async function openLigaModal() {
  let allowed = false;
  try { allowed = await canLiga(); } catch (e) { allowed = false; }
  if (!allowed) { showToast('Kein Zugriff.', 'error'); return; }
  document.getElementById('ligaModal').classList.add('show');
  renderLigaHome();
}
export function closeLigaModal() {
  document.getElementById('ligaModal').classList.remove('show');
  const el = document.getElementById('ligaEntrySlot');
  if (el) fillLigaEntry();
}

// ── Übersicht: meine Ligen + anlegen/beitreten ──
export function renderLigaHome() {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  let h = modalHeader('🏆 Liga');
  const ligen = state.ligen || [];
  if (ligen.length) {
    h += '<div class="section-label">Meine Ligen</div><div class="card" style="padding:4px 0">';
    ligen.forEach((l, i) => {
      h += '<div style="display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer;' + (i < ligen.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '" onclick="ligaOpenTable(\'' + l.code + '\')">';
      h += '<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-word">' + esc(l.name || ('Liga LG-' + l.code)) + '</div><div style="font-size:11px;color:var(--tx3)">LG-' + esc(l.code) + '</div></div>';
      h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--tx3)"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    h += '</div>';
  } else {
    h += '<div style="font-size:13px;color:var(--tx3);padding:8px 2px 16px;line-height:1.5">Du bist noch in keiner Liga. Lege eine neue Liga an oder tritt mit einem Code bei. Beim Beenden eines Punkte-Spiels kannst du es dann in die Liga-Gesamttabelle aufnehmen.</div>';
  }
  h += '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn btn-primary" style="flex:1" onclick="ligaCreate()">Liga anlegen</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="ligaJoinPrompt()">Per Code beitreten</button></div>';
  el.innerHTML = h;
}

// ── Liga anlegen ──
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
    if (own) await ligaRef(code).child('members/' + own.id).set({ name: own.name || '', short: own.short || '' });
    addLocalLiga(code, name);
    showToast('Liga „' + name + '" angelegt (LG-' + code + ').', 'info');
    ligaOpenTable(code);
  } catch (e) { console.error('ligaCreate:', e); showToast('Anlegen fehlgeschlagen.', 'error'); }
}

// ── Liga beitreten ──
export async function ligaJoinPrompt() {
  const input = await showPrompt('Liga-Code eingeben (z. B. LG-4729 oder 4729):', 'LG-4729', 'Beitreten');
  if (!input) return;
  const code = input.replace(/[^0-9]/g, '').slice(-4);
  if (!/^\d{4}$/.test(code)) { showToast('Ungültiger Code.', 'error'); return; }
  ligaJoin(code);
}
export async function ligaJoin(code) {
  if (!initFirebase()) { showToast('Keine Datenbank-Verbindung.', 'error'); return; }
  let data;
  try { const snap = await ligaRef(code).get(); data = snap.val(); } catch (e) { showToast('Beitritt fehlgeschlagen.', 'error'); return; }
  if (!data || data.kind !== 'liga') { showToast('Liga LG-' + code + ' nicht gefunden.', 'error'); return; }
  const own = await getOwnSpieler().catch(() => null);
  try { if (own) await ligaRef(code).child('members/' + own.id).set({ name: own.name || '', short: own.short || '' }); } catch (e) { /* ignore */ }
  addLocalLiga(code, data.name || '');
  showToast('Liga „' + (data.name || ('LG-' + code)) + '" beigetreten.', 'info');
  ligaOpenTable(code);
}

// ── Liga-Tabelle anzeigen ──
export async function ligaOpenTable(code) {
  const el = document.getElementById('ligaModalContent');
  if (!el) return;
  el.innerHTML = modalHeader('🏆 Liga') + '<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  if (!initFirebase()) { el.innerHTML = modalHeader('🏆 Liga') + '<div style="padding:20px;color:var(--tx3)">Keine Datenbank-Verbindung.</div>'; return; }
  let data;
  try { const snap = await ligaRef(code).get(); data = snap.val(); } catch (e) { data = null; }
  if (!data) { showToast('Liga nicht gefunden.', 'error'); renderLigaHome(); return; }
  addLocalLiga(code, data.name || '');
  const games = Object.entries(data.spiele || {}).map(([id, g]) => ({ id, ...g }));
  const admin = await isAdmin().catch(() => false);
  const own = await getOwnSpieler().catch(() => null);
  const myId = own ? own.id : null;
  const url = location.origin + location.pathname + '?liga=LG' + code;

  let h = modalHeader('🏆 ' + esc(data.name || ('Liga LG-' + code)));
  h += '<div style="text-align:center;margin:6px 0 18px">'
    + '<div style="font-size:26px;font-weight:700;letter-spacing:3px;margin-bottom:10px">LG-' + esc(code) + '</div>'
    + '<img src="' + generateQR(url, 5) + '" style="width:150px;height:150px;image-rendering:pixelated;border-radius:var(--r-sm)">'
    + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:center">'
    + (navigator.share ? '<button class="btn btn-secondary" onclick="ligaShare(\'' + code + '\')">Teilen</button>' : '')
    + '<button class="btn btn-secondary" onclick="ligaCopyLink(\'' + code + '\')">Link kopieren</button></div></div>';

  if (!games.length) {
    h += '<div style="font-size:13px;color:var(--tx3);padding:8px 2px;line-height:1.5">Noch keine Spiele in dieser Liga. Beende ein Punkte-Spiel und nimm es in die Liga auf – dann erscheint hier die Gesamttabelle.</div>';
  } else {
    const { stats, ranked, sorted } = computeStandings(games);
    h += '<div style="font-size:11px;color:var(--tx3);margin-bottom:12px">' + sorted.length + ' Spiele · ' + ranked.length + ' Spieler</div>';
    h += '<div class="section-label">Gesamttabelle</div><div class="card">';
    ranked.forEach((p, i) => {
      const s = stats[p];
      const winRate = s.spiele ? Math.round(s.siege / s.spiele * 100) : 0;
      const avg = s.abende ? Math.round(s.punkte / s.abende * 10) / 10 : 0;
      const rc = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      h += '<div style="padding:10px 0;' + (i < ranked.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500"><span class="rank ' + rc + '" style="display:inline-flex;width:20px;height:20px;font-size:11px;margin-right:6px">' + (i + 1) + '</span>' + esc(p) + '</span><span class="' + (s.punkte >= 0 ? 'pos' : 'neg') + '" style="font-family:\'Space Mono\',monospace;font-weight:700">' + (s.punkte > 0 ? '+' : '') + s.punkte + '</span></div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;color:var(--tx3);margin-left:26px">';
      h += '<span>Spiele: ' + s.abende + '</span><span>Runden: ' + s.spiele + '</span><span>Siege: ' + winRate + '%</span><span>Soli: ' + s.soloWins + '/' + s.soloTotal + '</span>';
      if (s.platz1 > 0) h += '<span>Platz 1: ' + s.platz1 + '×</span>';
      h += '<span>Ø/Spiel: ' + (avg > 0 ? '+' : '') + avg + '</span></div></div>';
    });
    h += '</div>';
    h += '<div class="section-label" style="margin-top:20px">Spiele</div><div class="card" style="padding:4px 0">';
    const gsorted = games.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    gsorted.forEach((g, i) => {
      const d = g.date ? new Date(g.date) : (g.addedAt ? new Date(g.addedAt) : null);
      const dateStr = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
      const tot = {}; (g.players || []).forEach(p => tot[p] = 0);
      (g.rounds || []).forEach(r => r.playing.forEach(p => { tot[p] = (tot[p] || 0) + (r.scores[p] || 0); }));
      const arr = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
      const top = arr.length ? esc(arr[0]) + ' (' + (tot[arr[0]] > 0 ? '+' : '') + tot[arr[0]] + ')' : '';
      const canDel = admin || (myId && g.addedBy === myId);
      h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;' + (i < gsorted.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="flex:1;min-width:0"><div style="font-size:13px">' + dateStr + ' · ' + (g.rounds ? g.rounds.length : 0) + ' Runden</div><div style="font-size:11px;color:var(--tx3)">Sieger: ' + top + (g.addedByName ? ' · von ' + esc(g.addedByName) : '') + '</div></div>';
      if (canDel) h += '<button onclick="ligaDeleteGame(\'' + code + '\',\'' + g.id + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:30px;height:30px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Löschen">' + ICO.trash + '</button>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button class="btn btn-secondary" style="flex:1" onclick="ligaOpenTable(\'' + code + '\')">Aktualisieren</button>'
    + '<button class="btn btn-secondary" style="flex:1" onclick="renderLigaHome()">Zurück</button></div>';
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="ligaLeave(\'' + code + '\')">Liga verlassen</button>';
  el.innerHTML = h;
}

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
  try { await ligaRef(code).child('spiele/' + gameId).remove(); showToast('Eintrag gelöscht.', 'info'); ligaOpenTable(code); }
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

// ── Spiel beim Beenden in eine Liga aufnehmen ──
function ligaSig(snapshot) {
  const players = (snapshot.players || []).slice().sort().join('|');
  return (snapshot.gameStartTime || snapshot.date || '') + '#' + players + '#' + ((snapshot.rounds || []).length);
}
async function chooseLiga() {
  const ligen = state.ligen || [];
  const list = ligen.map((l, i) => (i + 1) + ') ' + (l.name || ('LG-' + l.code))).join('\n');
  const ans = await showPrompt('In welche Liga aufnehmen? Nummer eingeben (leer = nicht aufnehmen):<br><span style="font-size:12px;color:var(--tx3);white-space:pre-line">' + esc(list) + '</span>', '1', 'Übernehmen');
  if (!ans) return null;
  const idx = parseInt(ans, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= ligen.length) { showToast('Ungültige Auswahl.', 'error'); return null; }
  return ligen[idx].code;
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
  const own = await getOwnSpieler().catch(() => null);
  const sig = ligaSig(snapshot);
  try {
    const snap = await ligaRef(code).child('spiele').get();
    const existing = snap.val() || {};
    if (Object.values(existing).some(g => g && g.sig === sig)) { showToast('Dieses Spiel ist schon in der Liga.', 'info'); return; }
    await ligaRef(code).child('spiele').push().set({
      date: snapshot.date || new Date().toISOString(),
      players: snapshot.players || [],
      rounds: snapshot.rounds || [],
      addedBy: own ? own.id : null,
      addedByName: own ? (own.name || '') : (state.myPlayer || ''),
      addedAt: firebase.database.ServerValue.TIMESTAMP,
      sig
    });
    showToast('Spiel in die Liga aufgenommen.', 'info');
  } catch (e) { console.error('addCurrentGameToLiga:', e); showToast('Konnte Spiel nicht in die Liga schreiben.', 'error'); }
}

// ── Deep-Link: ?liga=LG<code> ──
export function checkLigaUrlParam() {
  const params = new URLSearchParams(location.search);
  const liga = params.get('liga');
  if (!liga) return;
  history.replaceState(null, '', location.pathname);
  const code = liga.replace(/[^0-9]/g, '').slice(-4);
  if (!/^\d{4}$/.test(code)) return;
  setTimeout(async () => {
    let allowed = false;
    try { allowed = await canLiga(); } catch (e) { /* ignore */ }
    if (!allowed) { showToast('Für den Ligabereich fehlt dir die Freischaltung.', 'info'); return; }
    document.getElementById('ligaModal').classList.add('show');
    ligaJoin(code);
  }, 600);
}
