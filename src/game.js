// game.js – Einstieg „Spielbares Doppelkopf gegen Computer" (Admins + freigeschaltete Beta-Tester).
// Dünner Glue analog admin.js: Gating, Mehr-Eintrag, Vollbild-Modal-Lifecycle.
// Re-exportiert die UI-Handler, damit sie über main.js global (onclick) verfügbar sind.
import { isAdmin, canBetaDoko } from './turnier.js';
import { showToast } from './ui.js';
import * as gameUi from './game/ui.js';

export * from './game/ui.js';

// Blendet den Spiel-Einstieg im Mehr-Screen ein, falls berechtigt (Admin oder Beta-freigeschaltet).
export async function fillGameEntry() {
  const el = document.getElementById('gameEntrySlot');
  if (!el) return;
  let allowed = false, admin = false;
  try { allowed = await canBetaDoko(); admin = await isAdmin(); } catch (e) { allowed = false; }
  if (!allowed) { el.innerHTML = ''; return; }
  const running = gameUi.hasRunningGame();
  // Reine Beta-Tester (kein Admin) bekommen ein eigenes „Beta-Test"-Label, da bei ihnen
  // das „Nur für Admins"-Label (aus fillAdminEntry) fehlt.
  const label = admin ? '' : '<div class="section-label" style="margin-top:20px">Beta-Test</div>';
  el.innerHTML = label + '<div class="card" style="cursor:pointer;border-color:var(--acc)" onclick="openDokoGame()">'
    + '<div style="display:flex;align-items:center;gap:10px">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc)"><rect x="3" y="5" width="14" height="16" rx="2"/><path d="M7 5V3h10a2 2 0 012 2v14"/></svg>'
    + '<div><div style="font-weight:500">Doppelkopf spielen</div>'
    + '<div style="font-size:11px;color:var(--tx3)">Gegen 3 Computer-Gegner' + (running ? ' · läuft' : '') + '</div></div></div></div>';
}

export async function openDokoGame() {
  let allowed = false;
  try { allowed = await canBetaDoko(); } catch (e) { allowed = false; }
  if (!allowed) { showToast('Kein Zugriff.', 'error'); return; }
  document.getElementById('dokoGameModal').classList.add('show');
  gameUi.mountGame();
}

export function closeDokoGame() {
  gameUi.persistGame();
  document.getElementById('dokoGameModal').classList.remove('show');
  // Mehr-Screen-Eintrag aktualisieren (läuft / nicht).
  const el = document.getElementById('gameEntrySlot');
  if (el) fillGameEntry();
}
