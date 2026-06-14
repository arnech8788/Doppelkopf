// notify.js – In-App-Benachrichtigungen (kein Push). Sammelt Änderungen an den eigenen Ligen
// (aus der Audit-Historie turniere/_log/LG<code>) sowie neue Changelog-Einträge seit der zuletzt
// gesehenen Version und zeigt sie in einem Panel; ungelesene werden mit einem Punkt am Glocken-
// Icon markiert. Einstellbar in den Einstellungen (welche Kategorien, eigene Änderungen).
import { state, save, APP_VERSION, openChangelogModal, closeInfoModal } from './main.js';
import { CHANGELOG } from './changelog.js';
import { loadLog } from './audit.js';
import { getOwnSpieler } from './turnier.js';
import { ICO } from './ui.js';
import { openLigaDetail, openLigaGameDetail, openLigaTerminDetail } from './liga.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 'v6.52' → vergleichbare Zahl (Major*10000 + Minor).
function parseVer(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10);
}
// Changelog-Datum 'TT.MM.JJJJ HH:MM' → Zeitstempel (nur zum Sortieren).
function parseClDate(d) {
  const m = String(d || '').match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
}
// Audit-Aktion → Kategorie für die Filter-Einstellungen.
function notifCategory(action) {
  const a = String(action || '');
  if (/App-Spiel|Termin/.test(a)) return 'points';
  if (/Spieler|Verknüpf|Verknüpfung|zusammengeführt|zugeordnet|Mitglied/.test(a)) return 'roster';
  return 'other';
}
function relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60); if (m < 60) return 'vor ' + m + ' min';
  const h = Math.round(m / 60); if (h < 24) return 'vor ' + h + ' h';
  const d = Math.round(h / 24); if (d < 7) return 'vor ' + d + ' Tag' + (d > 1 ? 'en' : '');
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function ligaName(code) {
  const l = (state.ligen || []).find(x => x.code === code);
  return (l && l.name) || ('LG-' + code);
}
function cats() { return state.notifCats || (state.notifCats = { points: true, roster: true, other: true, changelog: true }); }

// Sammelt alle aktuell ungelesenen Benachrichtigungen + Maximal-Zeitstempel je Liga (für „gelesen").
export async function buildNotifications() {
  const own = await getOwnSpieler().catch(() => null);
  const myId = own ? own.id : null;
  const c = cats();
  const items = [];
  const maxByCode = {};
  // Liga-Änderungen aus der Historie
  for (const l of (state.ligen || [])) {
    const code = l.code;
    const seen = (state.notifSeen && state.notifSeen[code]) || 0;
    let log = [];
    try { log = await loadLog('LG' + code); } catch (e) { log = []; }
    log.forEach(e => {
      const at = e.at || 0;
      if (at > (maxByCode[code] || 0)) maxByCode[code] = at;
      if (at <= seen) return;
      if (!state.notifOwn && myId && e.by === myId) return;
      const cat = notifCategory(e.action);
      if (!c[cat]) return;
      items.push({ kind: 'liga', code, at, action: e.action || '', byName: e.byName || '', detail: e.detail || '', path: e.path || '' });
    });
  }
  // Changelog seit zuletzt gesehener Version
  if (c.changelog) {
    const seenV = parseVer(state.notifSeenVersion);
    CHANGELOG.forEach(e => {
      if (parseVer(e.v) > seenV) items.push({ kind: 'changelog', at: parseClDate(e.d), v: e.v, text: e.t });
    });
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { items, maxByCode };
}

// Setzt den Glocken-Punkt je nach ungelesenen Benachrichtigungen.
export async function refreshNotifBadge() {
  let n = 0;
  try { n = (await buildNotifications()).items.length; } catch (e) { n = 0; }
  const b = document.getElementById('notifBadge');
  if (b) b.style.display = n > 0 ? 'block' : 'none';
  return n;
}

// Erstinitialisierung: Basislinie setzen (keine alten Änderungen als „ungelesen" fluten) + Badge.
export async function initNotifications() {
  if (!state.notifSeenVersion) { state.notifSeenVersion = APP_VERSION; save(); }
  if (!state.notifSeen) state.notifSeen = {};
  let changed = false;
  (state.ligen || []).forEach(l => { if (state.notifSeen[l.code] == null) { state.notifSeen[l.code] = Date.now(); changed = true; } });
  if (changed) save();
  try { await refreshNotifBadge(); } catch (e) { /* ignore */ }
}

function markAllRead(maxByCode) {
  if (!state.notifSeen) state.notifSeen = {};
  Object.entries(maxByCode || {}).forEach(([code, mx]) => { state.notifSeen[code] = Math.max(state.notifSeen[code] || 0, mx); });
  state.notifSeenVersion = APP_VERSION;
  save();
}

export async function openNotifications() {
  const el = document.getElementById('infoModalContent');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  document.getElementById('infoModal').classList.add('show');
  const { items, maxByCode } = await buildNotifications();
  let h = '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    + '<h3 style="margin:0">🔔 Benachrichtigungen</h3>'
    + '<button onclick="closeInfoModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">' + ICO.x + '</button></div>';
  if (!items.length) {
    h += '<div class="card" style="font-size:13px;color:var(--tx3)">Keine neuen Benachrichtigungen. Hier erscheinen Änderungen an deinen Ligen und neue App-Versionen.</div>';
  } else {
    h += '<div class="card" style="padding:4px 0">';
    items.forEach((it, i) => {
      const border = i < items.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '';
      if (it.kind === 'changelog') {
        h += '<div onclick="openChangelogModal()" style="display:flex;gap:10px;padding:10px 12px;cursor:pointer;' + border + '">';
        h += '<div style="font-size:18px;line-height:1">✨</div><div style="flex:1;min-width:0">';
        h += '<div style="font-size:13px;font-weight:600">Neu in v' + esc(it.v) + '</div>';
        h += '<div style="font-size:12px;color:var(--tx2);line-height:1.4">' + esc(it.text) + '</div></div></div>';
      } else {
        let onclick;
        const pm = /^spiele\/(.+)$/.exec(it.path); const tm = /^termine\/([^/]+)/.exec(it.path);
        if (pm) onclick = 'openLigaGameDetail(\'' + it.code + '\',\'' + pm[1] + '\')';
        else if (tm) onclick = 'openLigaTerminDetail(\'' + it.code + '\',\'' + tm[1] + '\')';
        else onclick = 'openLigaDetail(\'' + it.code + '\')';
        h += '<div onclick="' + onclick + '" style="display:flex;gap:10px;padding:10px 12px;cursor:pointer;' + border + '">';
        h += '<div style="font-size:18px;line-height:1">🏆</div><div style="flex:1;min-width:0">';
        h += '<div style="font-size:13px;font-weight:600">' + esc(ligaName(it.code)) + ' · ' + esc(it.action) + '</div>';
        if (it.detail) h += '<div style="font-size:12px;color:var(--tx2);line-height:1.4;white-space:pre-line">' + esc(it.detail) + '</div>';
        h += '<div style="font-size:11px;color:var(--tx3)">' + (it.byName ? esc(it.byName) + ' · ' : '') + relTime(it.at) + '</div></div></div>';
      }
    });
    h += '</div>';
  }
  h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="closeInfoModal()">Schließen</button>';
  el.innerHTML = h;
  // Als gelesen markieren (Panel bleibt sichtbar, Badge verschwindet).
  markAllRead(maxByCode);
  refreshNotifBadge();
}
