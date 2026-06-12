// audit.js – Generische Änderungs-Historie + Rückgängig für Liga und Turniere.
// Logs liegen unter turniere/_log/<entityKey>/ (also NICHT im Entity-Knoten selbst, damit ein
// gelöschtes Turnier/eine gelöschte Liga über die Historie wiederhergestellt werden kann).
// entityKey = 'LG<code>' (Liga) bzw. 'DK<code>' (Turnier). path = relativ zum Entity-Knoten;
// before = vorheriger Wert an path (null = existierte nicht). Undo setzt before zurück (bzw. löscht).
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { getOwnSpieler } from './turnier.js';
import { state } from './main.js';
import { showToast, showConfirm, ICO } from './ui.js';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const logRef = key => firebase.database().ref('turniere/_log/' + key);
const entityRef = key => firebase.database().ref('turniere/' + key);

export async function logChange(entityKey, action, relPath, before) {
  try {
    const own = await getOwnSpieler().catch(() => null);
    await logRef(entityKey).push().set({
      at: firebase.database.ServerValue.TIMESTAMP,
      by: own ? own.id : null,
      byName: own ? (own.name || '') : (state.myPlayer || ''),
      action: action || '',
      path: relPath || '',
      before: before === undefined ? null : before
    });
  } catch (e) { console.warn('logChange:', e); }
}

export async function loadLog(entityKey) {
  try {
    const snap = await logRef(entityKey).get();
    const v = snap.val() || {};
    return Object.entries(v).map(([id, e]) => ({ id, ...e })).sort((a, b) => (b.at || 0) - (a.at || 0));
  } catch (e) { return []; }
}

async function revertEntry(entityKey, entry) {
  const ref = entry.path ? entityRef(entityKey).child(entry.path) : entityRef(entityKey);
  if (entry.before == null) await ref.remove(); else await ref.set(entry.before);
  await logChange(entityKey, 'Rückgängig: ' + (entry.action || ''), entry.path || '', null);
}

// History-Ansicht in einen Container rendern.
// opts: { title, container, canUndo, backOnclick }
let _hist = null;
export async function renderHistory(entityKey, opts) {
  _hist = Object.assign({ title: 'Historie', container: 'ligaModalContent', canUndo: false, backOnclick: '' }, opts || {});
  const el = document.getElementById(_hist.container);
  if (!el) return;
  const close = _hist.backOnclick
    ? '<button onclick="' + _hist.backOnclick + '" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">' + ICO.x + '</button>'
    : '';
  const head = '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">🕓 ' + esc(_hist.title) + '</h3>' + close + '</div>';
  el.innerHTML = head + '<div style="padding:30px;text-align:center;color:var(--tx3)">Lädt…</div>';
  const log = await loadLog(entityKey);
  let h = head;
  if (!log.length) h += '<div style="font-size:13px;color:var(--tx3);padding:10px 2px">Noch keine Änderungen protokolliert.</div>';
  else {
    h += '<div class="card" style="padding:4px 0">';
    log.forEach((e, i) => {
      const d = e.at ? new Date(e.at) : null;
      const ds = d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
      const isRevert = String(e.action || '').startsWith('Rückgängig');
      h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' + (i < log.length - 1 ? 'border-bottom:1px solid var(--bdr)' : '') + '">';
      h += '<div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(e.action || '') + '</div><div style="font-size:11px;color:var(--tx3)">' + esc(e.byName || '?') + ' · ' + ds + '</div></div>';
      if (_hist.canUndo && !isRevert) h += '<button onclick="auditUndo(\'' + entityKey + '\',\'' + e.id + '\')" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:28px;border-radius:var(--r-sm);padding:0 8px;font-size:11px">Rückgängig</button>';
      h += '</div>';
    });
    h += '</div>';
  }
  if (_hist.backOnclick) h += '<button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="' + _hist.backOnclick + '">Zurück</button>';
  el.innerHTML = h;
}

export async function auditUndo(entityKey, entryId) {
  if (!await showConfirm('Diese Änderung rückgängig machen?', 'Rückgängig')) return;
  const log = await loadLog(entityKey);
  const entry = log.find(e => e.id === entryId);
  if (!entry) { showToast('Eintrag nicht gefunden.', 'error'); return; }
  try { await revertEntry(entityKey, entry); showToast('Rückgängig gemacht.', 'info'); }
  catch (e) { console.error('auditUndo:', e); showToast('Rückgängig fehlgeschlagen: ' + (e && e.message || e), 'error'); return; }
  if (_hist) renderHistory(entityKey, _hist);
}
