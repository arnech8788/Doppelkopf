// game/ui.js – Vollbild-Spieloberfläche (Mensch idx0 + 3 KI). Einzige Stelle mit DOM/Timern.
import * as E from './engine.js';
import * as AI from './ai.js';
import { state, save } from '../main.js';
import { showConfirm, launchConfetti, ICO } from '../ui.js';

const AI_DELAY = 750;     // KI-Bedenkzeit pro Karte
const TRICK_PAUSE = 1100; // Anzeige eines fertigen Stichs

const NAMES = ['Du', 'Lisa', 'Max', 'Tom'];
const SOLO_LIST = [
  ['trumpf', 'Trumpf-Solo'], ['damen', 'Damen-Solo'], ['buben', 'Buben-Solo'],
  ['farbe-k', 'Karo-Solo'], ['farbe-h', 'Herz-Solo'], ['farbe-p', 'Pik-Solo'], ['farbe-c', 'Kreuz-Solo'],
];

let G = null;             // aktueller Engine-State
let busy = false;         // KI denkt / Stich-Pause läuft
let showingTrick = null;  // fertiger Stich, der gerade angezeigt wird
let pendingContinue = null; // Fortsetzung bei „Auto-Weiter" aus
let vorbExpanded = false; // Vorbehalt-Untermenü offen
let ansageOpen = false;   // Ansage-Popup offen
let peekTrick = false;    // „Letzter Stich"-Popup offen

// ── Mount / Persistenz ──
export function mountGame() { render(); }
export function hasRunningGame() { return !!(G || (state.dokoGame && state.dokoGame.phase)); }
export function persistGame() {
  state.dokoGame = (G && G.phase !== 'scoring') ? G : null;
  save();
}

// ── Neues Spiel / Fortsetzen ──
export function startNewDokoGame() {
  const mitNeunen = state.dokoMitNeunen !== false;
  const dealer = ((state.dokoDealer || 0)) % 4;
  G = E.createGame({ names: NAMES, dealer, mitNeunen, seed: (Date.now() ^ (Math.random() * 1e9)) | 0 });
  busy = false; showingTrick = null; pendingContinue = null; vorbExpanded = false;
  state.dokoDealer = (dealer + 1) % 4;
  persistGame();
  advanceVorbehalt();
}
export function dokoResume() {
  if (!state.dokoGame) { startNewDokoGame(); return; }
  G = state.dokoGame; busy = false; showingTrick = null; pendingContinue = null;
  render();
  if (G.phase === 'vorbehalt') advanceVorbehalt();
  else if (G.phase === 'play' && E.currentPlayer(G) !== 0) continuePlay();
}
export function dokoDiscardSaved() { state.dokoGame = null; G = null; save(); render(); }

// ── Vorbehalt-Phase ──
function advanceVorbehalt() {
  const v = G.vorbehalt;
  while (v.current < v.order.length) {
    const idx = v.order[v.current];
    if (idx === 0) { render(); return; }          // Mensch ist dran → warten
    v.declarations[idx] = AI.decideVorbehalt(G, idx);
    v.current++;
  }
  E.resolveVorbehalt(G); persistGame(); render(); continuePlay();
}
export function dokoVorbehalt(kind) {
  if (G.phase !== 'vorbehalt') return;
  if (kind === 'gesund') { G.vorbehalt.declarations[0] = { type: 'gesund' }; vorbExpanded = false; G.vorbehalt.current++; advanceVorbehalt(); }
  else if (kind === 'hochzeit') { G.vorbehalt.declarations[0] = { type: 'hochzeit' }; vorbExpanded = false; G.vorbehalt.current++; advanceVorbehalt(); }
  else if (kind === 'expand') { vorbExpanded = true; render(); }
}
export function dokoChooseSolo(soloType) {
  if (G.phase !== 'vorbehalt') return;
  G.vorbehalt.declarations[0] = { type: 'solo', soloType };
  vorbExpanded = false; G.vorbehalt.current++; advanceVorbehalt();
}

// ── Spielablauf ──
function continuePlay() {
  if (!G || G.phase !== 'play') { render(); return; }
  const idx = E.currentPlayer(G);
  if (idx === 0) { busy = false; render(); return; } // Mensch klickt
  aiTurn(idx);
}
function aiTurn(idx) {
  busy = true; render();
  setTimeout(() => {
    if (!G || G.phase !== 'play') return;
    for (const lvl of AI.decideAnnounce(G, idx)) applyAnnounce(idx, lvl, ownSide(idx));
    const id = AI.chooseCard(G, idx);
    const res = E.playCard(G, idx, id);
    busy = false;
    afterPlay(res);
  }, AI_DELAY);
}
export function playHumanCard(id) {
  if (busy || !G || G.phase !== 'play') return;
  if (E.currentPlayer(G) !== 0) return;
  if (!E.legalCards(G, 0).includes(id)) return;
  const res = E.playCard(G, 0, id);
  afterPlay(res);
}
function afterPlay(res) {
  peekTrick = false;
  persistGame();
  if (res.trickComplete) {
    showingTrick = G.tricks[G.tricks.length - 1];
    render();
    const cont = () => { showingTrick = null; if (res.gameOver) { onGameOver(); } else { render(); continuePlay(); } };
    if (state.dokoAuto !== false) { busy = true; setTimeout(cont, TRICK_PAUSE); }
    else { pendingContinue = cont; busy = true; render(); }
  } else {
    render(); continuePlay();
  }
}
export function dokoNextTrick() {
  if (!pendingContinue) return;
  const fn = pendingContinue; pendingContinue = null; busy = false; fn();
}
export function dokoToggleAuto() { state.dokoAuto = !(state.dokoAuto !== false); save(); render(); }

// ── Ansagen ──
// Sicher bekannte EIGENE Partei eines Spielers (jeder kennt seine eigene Seite).
function ownSide(idx) {
  if (G.gameType === 'solo') return G.soloist === idx ? 're' : 'kontra';
  if (G.gameType === 'hochzeit') {
    if (G.hochzeit.brideIdx === idx) return 're';
    if (G.hochzeit.clarified) return G.hochzeit.partnerIdx === idx ? 're' : 'kontra';
    return 'unknown';
  }
  return G.cdHolders.includes(idx) ? 're' : 'kontra';
}
function applyAnnounce(idx, level, side) {
  if (!E.canAnnounce(G, idx, level)) return false;
  const a = G.announcements;
  if (level === 're' || level === 'kontra') {
    if (side !== 'unknown' && side !== level) return false; // nur eigene Partei
    if (a[level]) return false;
    a[level] = { by: idx, at: G.cardCount };
  } else {
    if (side !== 're' && side !== 'kontra') return false;
    if (a.absagen.some(x => x.party === side && x.level === level)) return false;
    a.absagen.push({ party: side, level, by: idx, at: G.cardCount });
  }
  return true;
}
export function dokoAnnounce(level) {
  if (busy || !G || G.phase !== 'play') return;
  if (applyAnnounce(0, level, ownSide(0))) { ansageOpen = false; persistGame(); render(); }
}
export function dokoOpenAnsage() { if (!G || G.phase !== 'play' || busy || showingTrick) return; ansageOpen = true; render(); }
export function dokoCloseAnsage() { ansageOpen = false; render(); }
export function dokoPeekLast() { if (!G || !G.tricks.length || showingTrick) return; peekTrick = true; render(); }
export function dokoClosePeek() { peekTrick = false; render(); }

// Aktuell regelkonform erlaubte Ansagen des Menschen (idx0).
const ANN_LABEL = { re: 'Re', kontra: 'Kontra', '90': 'Keine 90', '60': 'Keine 60', '30': 'Keine 30', schwarz: 'Schwarz' };
function announceOptions() {
  if (!G || G.phase !== 'play') return [];
  const side = ownSide(0); const out = [];
  for (const lvl of ['re', 'kontra']) {
    if ((side === lvl || side === 'unknown') && !G.announcements[lvl] && E.canAnnounce(G, 0, lvl)) out.push({ level: lvl, label: ANN_LABEL[lvl] });
  }
  if (side === 're' || side === 'kontra') {
    for (const lvl of ['90', '60', '30', 'schwarz']) {
      if (E.canAnnounce(G, 0, lvl) && !G.announcements.absagen.some(x => x.party === side && x.level === lvl)) out.push({ level: lvl, label: ANN_LABEL[lvl] });
    }
  }
  return out;
}
export function dokoNewGame() { startNewDokoGame(); }

function onGameOver() {
  // Gesamtwertung kumulieren (einmalig).
  if (!G._totalsApplied) {
    const t = state.dokoTotals || { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 4; i++) t[i] = (t[i] || 0) + (G.result.perPlayer[i] || 0);
    state.dokoTotals = t; G._totalsApplied = true;
  }
  state.dokoGame = null; save();
  render();
  const p = G.result.parties;
  const humanSide = p.re.includes(0) ? 're' : 'kontra';
  if (humanSide === G.result.winner) launchConfetti();
}

// ════════════════════════ Rendering ════════════════════════
const RED = c => c.suit === 'k' || c.suit === 'h';
function cardFace(card, { playable = false, dim = false, small = false, highlight = false } = {}) {
  const w = small ? 38 : 46, h = small ? 54 : 66;
  const col = RED(card) ? '#d23' : 'var(--tx)';
  const click = playable ? ` onclick="playHumanCard('${card.id}')"` : '';
  const bd = highlight ? 'var(--grn)' : 'var(--bdr)';
  const shadow = highlight ? 'box-shadow:0 0 0 2px var(--grn);' : '';
  return `<div class="doko-card"${click} style="width:${w}px;height:${h}px;flex:0 0 auto;background:#fff;border:1px solid ${bd};${shadow}border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${col};font-weight:700;${playable ? 'cursor:pointer;' : ''}${dim ? 'opacity:.38;filter:grayscale(.5);' : ''}user-select:none">`
    + `<span style="font-size:${small ? 13 : 16}px;line-height:1">${card.rank === '10' ? '10' : card.rank}</span>`
    + `<span style="font-size:${small ? 16 : 20}px;line-height:1.1">${E.SUIT_SYM[card.suit]}</span></div>`;
}
function cardBack(small) {
  const w = small ? 26 : 34, h = small ? 38 : 50;
  return `<div style="width:${w}px;height:${h}px;flex:0 0 auto;background:linear-gradient(135deg,var(--acc),var(--acc2,#666));border:1px solid var(--bdr);border-radius:5px"></div>`;
}
function sideBadge(idx) {
  if (!G) return '';
  // Mensch kennt eigene Partei; Gegner nur, wenn öffentlich bekannt (Ansage/Kreuz-Dame/Solo).
  const s = idx === 0 ? ownSide(0) : AI.inferParties(G, 0).side(idx);
  if (s === 're') return ' <span style="font-size:10px;background:var(--grn);color:#fff;padding:1px 5px;border-radius:8px">Re</span>';
  if (s === 'kontra') return ' <span style="font-size:10px;background:var(--red);color:#fff;padding:1px 5px;border-radius:8px">Kontra</span>';
  return '';
}
function annBadge(idx) {
  const a = G.announcements; let h = '';
  if (a.re && a.re.by === idx) h += ' <span style="font-size:10px;color:var(--grn);font-weight:700">Re!</span>';
  if (a.kontra && a.kontra.by === idx) h += ' <span style="font-size:10px;color:var(--red);font-weight:700">Kontra!</span>';
  if (a.absagen) {
    const L = { '90': 'Keine 90', '60': 'Keine 60', '30': 'Keine 30', 'schwarz': 'Schwarz' };
    a.absagen.filter(x => x.by === idx).forEach(x => {
      const col = x.party === 're' ? 'var(--grn)' : 'var(--red)';
      h += ` <span style="font-size:10px;color:${col};font-weight:700">${L[x.level] || x.level}!</span>`;
    });
  }
  return h;
}
// Anzahl gewonnener Stiche eines Spielers im laufenden Spiel.
function tricksWon(idx) {
  let n = 0;
  if (G && G.tricks) for (const t of G.tricks) if (t.winner === idx) n++;
  return n;
}
// Name des Ansagers eines Solos/einer Hochzeit (für die Kopfzeile).
function gameTypeActor() {
  if (!G) return '';
  if (G.gameType === 'solo' && G.soloist != null) return G.players[G.soloist].name;
  if (G.gameType === 'hochzeit' && G.hochzeit) return G.players[G.hochzeit.brideIdx].name;
  return '';
}
// Hochzeit-Status: Suche / geklärt durch welchen Stich (Fehl/Trumpf) / hängen gelassen.
function hochzeitBanner() {
  if (!G || G.gameType !== 'hochzeit' || !G.hochzeit) return '';
  const h = G.hochzeit;
  const bride = G.players[h.brideIdx].name;
  let text;
  if (!h.clarified) {
    text = `💍 Hochzeit von ${bride} · Partner wird gesucht (bis Stich 3)`;
  } else if (h.partnerIdx == null) {
    text = `💍 Hochzeit hängen gelassen → Stilles Solo von ${bride}`;
  } else {
    const partner = G.players[h.partnerIdx].name;
    const ct = G.tricks.find(t => t.winner === h.partnerIdx);
    let info = '';
    if (ct) {
      const n = G.tricks.indexOf(ct) + 1;
      const lead = ct.cards.find(c => c.idx === ct.leadIdx);
      const isT = lead ? E.isTrump(lead.card, E.trumpCtx(G)) : false;
      info = ` · geklärt durch Stich ${n} (${isT ? 'Trumpf-Stich' : 'Fehl-Stich'})`;
    }
    text = `💍 Hochzeit: ${bride} + ${partner}${info}`;
  }
  return `<div style="padding:6px 12px;text-align:center;font-size:12px;font-weight:600;background:var(--bg3);color:var(--tx);border-bottom:1px solid var(--bdr)">${text}</div>`;
}

function opponentBox(idx, align) {
  const p = G.players[idx];
  const active = G.phase === 'play' && E.currentPlayer(G) === idx && !showingTrick;
  const backs = Array.from({ length: Math.min(p.hand.length, 12) }, () => cardBack(true)).join('');
  const nameStyle = active ? 'background:var(--acc);color:#fff;padding:2px 9px;border-radius:11px' : 'color:var(--tx2)';
  return `<div style="display:flex;flex-direction:column;align-items:${align};gap:4px;${active ? 'filter:drop-shadow(0 0 9px var(--acc));' : ''}">`
    + `<div style="font-size:12px;font-weight:700;${nameStyle}">${active ? '▶ ' : ''}${p.name}${sideBadge(idx)}${annBadge(idx)}</div>`
    + `<div style="display:flex;gap:1px;flex-wrap:wrap;max-width:150px;justify-content:${align}">${backs}</div>`
    + `<div style="font-size:10px;color:var(--tx3)">${p.hand.length} Karten · ${tricksWon(idx)} Stiche</div></div>`;
}

function trickArea() {
  const tr = showingTrick ? showingTrick.cards : G.trick.cards;
  const winnerIdx = showingTrick ? showingTrick.winner : -1;
  if (!tr.length) return `<div style="min-height:90px;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px">${G.phase === 'play' ? 'Stich läuft…' : ''}</div>`;
  const items = tr.map(pc => {
    const hl = pc.idx === winnerIdx;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">`
      + `<span style="font-size:10px;color:${hl ? 'var(--grn)' : 'var(--tx3)'}">${G.players[pc.idx].name}${hl ? ' ✓' : ''}</span>`
      + cardFace(pc.card, { small: true, highlight: hl }) + `</div>`;
  }).join('');
  return `<div style="min-height:90px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;padding:6px">${items}</div>`;
}

function header() {
  const stich = Math.min(G.trickIndex + 1, G.handSize);
  const dealerName = G.players[G.dealer].name;
  const actor = gameTypeActor();
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg2);border-bottom:1px solid var(--bdr)">`
    + `<div><div style="font-weight:700;font-size:15px">${E.gameTypeLabel(G)}${actor ? ' · ' + actor : ''}</div>`
    + `<div style="font-size:11px;color:var(--tx3)">Stich ${stich}/${G.handSize} · Geber ${dealerName}</div></div>`
    + `<button onclick="closeDokoGame()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:34px;height:34px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">${ICO.x}</button></div>`;
}

// Banner „wer ist dran" – auffällig grün/akzent wenn der Mensch dran ist.
function turnBanner() {
  if (!G || G.phase === 'scoring') return '';
  let text, bg = 'var(--bg2)', col = 'var(--tx2)';
  if (G.phase === 'vorbehalt') {
    const who = G.vorbehalt.order[G.vorbehalt.current];
    if (who === 0) { text = '▶ Du bist dran – Vorbehalt?'; bg = 'var(--acc)'; col = '#fff'; }
    else text = `${G.players[who]?.name ?? ''} überlegt …`;
  } else { // play
    if (showingTrick) {
      text = `Stich geht an ${G.players[showingTrick.winner].name}`;
    } else {
      const cur = E.currentPlayer(G);
      if (cur === 0 && !busy) { text = '▶ Du bist dran – wähle eine Karte'; bg = 'var(--grn)'; col = '#fff'; }
      else text = `${G.players[cur].name} ist dran …`;
    }
  }
  return `<div style="padding:7px 12px;text-align:center;font-size:13px;font-weight:600;background:${bg};color:${col};border-bottom:1px solid var(--bdr)">${text}</div>`;
}

// Einzelner „Ansage"-Button (öffnet Popup); disabled wenn aktuell keine Ansage möglich.
function ansageButton() {
  if (!G || G.phase !== 'play') return '';
  const can = !busy && !showingTrick && announceOptions().length > 0;
  return `<button onclick="dokoOpenAnsage()" ${can ? '' : 'disabled'} style="padding:6px 12px;font-size:12px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg3);color:var(--tx2);cursor:${can ? 'pointer' : 'not-allowed'};opacity:${can ? 1 : .4}">📣 Ansage</button>`;
}

// „Letzter Stich"-Button (nur wenn ein abgeschlossener Stich existiert).
function peekButton() {
  if (!G || G.phase !== 'play' || !G.tricks.length || showingTrick) return '';
  return `<button onclick="dokoPeekLast()" style="padding:6px 12px;font-size:12px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg3);color:var(--tx2);cursor:pointer">🔍 Letzter Stich</button>`;
}

// Popup mit dem zuletzt abgeschlossenen Stich (Karten, Spieler, Gewinner, Augen).
function peekOverlay() {
  if (!peekTrick || !G || !G.tricks.length) return '';
  const tr = G.tricks[G.tricks.length - 1];
  const items = tr.cards.map(pc => {
    const hl = pc.idx === tr.winner;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">`
      + `<span style="font-size:11px;color:${hl ? 'var(--grn)' : 'var(--tx3)'}">${G.players[pc.idx].name}${hl ? ' ✓' : ''}</span>`
      + cardFace(pc.card, { highlight: hl }) + `</div>`;
  }).join('');
  return overlay(`<div style="font-weight:700;font-size:16px;margin-bottom:2px">Letzter Stich (Stich ${G.tricks.length})</div>`
    + `<div style="font-size:12px;color:var(--tx3);margin-bottom:14px">${G.players[tr.winner].name} gewinnt · ${tr.augen} Augen</div>`
    + `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">${items}</div>`
    + `<button class="btn btn-secondary" style="width:100%" onclick="dokoClosePeek()">Schließen</button>`);
}

// Ansage-Popup über der Stage (Hand bleibt darunter sichtbar).
function ansageOverlay() {
  if (!ansageOpen || !G || G.phase !== 'play') return '';
  const opts = announceOptions();
  const body = opts.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">`
      + opts.map(o => `<button class="btn btn-primary" onclick="dokoAnnounce('${o.level}')">${o.label}</button>`).join('') + `</div>`
    : `<div style="font-size:13px;color:var(--tx3);text-align:center">Aktuell keine Ansage möglich.</div>`;
  return overlay(`<div style="font-weight:700;font-size:16px;margin-bottom:10px">Ansage</div>`
    + body
    + `<button class="btn btn-secondary" style="width:100%;margin-top:14px" onclick="dokoCloseAnsage()">Schließen</button>`);
}

function handArea() {
  const legal = new Set(G.phase === 'play' && E.currentPlayer(G) === 0 && !busy ? E.legalCards(G, 0) : []);
  const myTurn = legal.size > 0;
  const ctx = E.trumpCtx(G);
  const cards = E.sortHand(G.players[0].hand, ctx).map(E.cardFromId);
  const html = cards.map(c => {
    const playable = myTurn && legal.has(c.id);
    return `<div style="margin-left:-6px;${playable ? 'transform:translateY(-8px);' : ''}">${cardFace(c, { playable, dim: myTurn && !playable })}</div>`;
  }).join('');
  const glow = myTurn ? 'box-shadow:inset 0 0 0 2px var(--grn);' : '';
  return `<div style="padding:8px 10px;border-top:1px solid var(--bdr);background:var(--bg2);${glow}">`
    + `<div style="font-size:10px;color:var(--tx3);padding:0 0 4px 6px">Deine Karten · ${tricksWon(0)} Stiche</div>`
    + `<div style="display:flex;align-items:flex-end;padding-left:6px;overflow-x:auto;min-height:74px">${html}</div></div>`;
}

function vorbehaltOverlay() {
  if (G.phase !== 'vorbehalt') return '';
  const v = G.vorbehalt;
  const waitingHuman = v.order[v.current] === 0;
  const done = v.order.slice(0, v.current).map(i => {
    const d = v.declarations[i]; const t = d.type === 'gesund' ? 'Gesund' : d.type === 'hochzeit' ? 'Hochzeit!' : 'Vorbehalt!';
    return `<div style="font-size:12px;color:var(--tx3)">${G.players[i].name}: ${t}</div>`;
  }).join('');
  let body;
  if (waitingHuman) {
    const canHz = E.canDeclareHochzeit(G, 0);
    if (!vorbExpanded) {
      body = `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">`
        + `<button class="btn btn-primary" onclick="dokoVorbehalt('gesund')">Gesund</button>`
        + `<button class="btn btn-secondary" onclick="dokoVorbehalt('expand')">Vorbehalt…</button></div>`;
    } else {
      const solos = SOLO_LIST.map(([t, l]) => `<button class="btn btn-secondary" style="font-size:12px" onclick="dokoChooseSolo('${t}')">${l}</button>`).join('');
      body = `<div style="display:flex;flex-direction:column;gap:8px">`
        + (canHz ? `<button class="btn btn-primary" onclick="dokoVorbehalt('hochzeit')">Hochzeit (beide Kreuz-Damen)</button>` : '')
        + `<div style="font-size:12px;color:var(--tx3)">Solo wählen:</div>`
        + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${solos}</div>`
        + `<button class="btn btn-secondary" onclick="dokoVorbehalt('gesund')">Doch gesund</button></div>`;
    }
  } else {
    body = `<div style="text-align:center;color:var(--tx3);font-size:13px">${G.players[v.order[v.current]].name} überlegt…</div>`;
  }
  return overlay(`<div style="font-weight:700;font-size:16px;margin-bottom:6px">Vorbehalt?</div>`
    + `<div style="font-size:12px;color:var(--tx3);margin-bottom:12px">Halte deine Karten? „Gesund" = normales Spiel. <b>Deine Karten siehst du unten.</b></div>`
    + done + `<div style="margin-top:14px">${body}</div>`);
}

function resultOverlay() {
  if (G.phase !== 'scoring') return '';
  const r = G.result;
  const win = r.winner === 're' ? 'Re' : 'Kontra';
  const humanSide = r.parties.re.includes(0) ? 're' : 'kontra';
  const youWon = humanSide === r.winner;
  const t = state.dokoTotals || {};
  const scoreRows = [0, 1, 2, 3].map(i => {
    const sc = r.perPlayer[i] || 0;
    const tot = t[i] || 0;
    const re = r.parties.re.includes(i);
    return `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">`
      + `<span>${G.players[i].name} <span style="font-size:10px;color:var(--tx3)">(${re ? 'Re' : 'Kontra'})</span></span>`
      + `<span><b style="color:${sc >= 0 ? 'var(--grn)' : 'var(--red)'}">${sc >= 0 ? '+' : ''}${sc}</b> <span style="color:var(--tx3);font-size:11px">Σ ${tot}</span></span></div>`;
  }).join('');
  const bd = r.breakdown.map(b => `<div style="font-size:11px;color:var(--tx3)">${b}</div>`).join('');
  return overlay(`<div style="font-weight:800;font-size:20px;margin-bottom:4px">${youWon ? '🎉 Gewonnen!' : 'Verloren'}</div>`
    + `<div style="font-size:13px;color:var(--tx2);margin-bottom:10px">${win} gewinnt · ${r.augenRe} : ${r.augenKontra} Augen · Wert ${r.value}</div>`
    + `<div style="background:var(--bg3);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:10px">${scoreRows}</div>`
    + `<div style="margin-bottom:12px">${bd}</div>`
    + `<button class="btn btn-primary" style="width:100%" onclick="dokoNewGame()">Neues Spiel</button>`
    + `<button class="btn btn-secondary" style="width:100%;margin-top:6px" onclick="closeDokoGame()">Schließen</button>`);
}

function overlay(inner) {
  return `<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:10">`
    + `<div style="background:var(--bg2);border:1px solid var(--bdr);border-radius:var(--r);padding:18px;max-width:360px;width:100%;max-height:90%;overflow-y:auto">${inner}</div></div>`;
}

function startScreen() {
  const neunen = state.dokoMitNeunen !== false;
  const resume = state.dokoGame && state.dokoGame.phase;
  const t = state.dokoTotals;
  const totalsHtml = t ? `<div style="margin-top:14px;font-size:12px;color:var(--tx3)">Gesamt: ` + [0, 1, 2, 3].map(i => `${NAMES[i]} ${t[i] || 0}`).join(' · ') + `</div>` : '';
  return `<div style="height:100%;display:flex;flex-direction:column">${headerStatic('Doppelkopf – gegen Computer')}`
    + `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;text-align:center">`
    + `<div style="font-size:48px">♣ ♠ ♥ ♦</div>`
    + `<div style="font-size:13px;color:var(--tx3);max-width:300px">Spiele Doppelkopf gegen drei Computer-Gegner. Du bist „${NAMES[0]}".</div>`
    + (resume ? `<button class="btn btn-primary" style="min-width:200px" onclick="dokoResume()">Spiel fortsetzen</button>` : '')
    + `<button class="btn ${resume ? 'btn-secondary' : 'btn-primary'}" style="min-width:200px" onclick="dokoNewGame()">Neues Spiel</button>`
    + `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--tx2);cursor:pointer"><input type="checkbox" ${neunen ? 'checked' : ''} onchange="dokoSetNeunen(this.checked)"> Mit Neunen (48 Karten)</label>`
    + totalsHtml + `</div></div>`;
}
export function dokoSetNeunen(v) { state.dokoMitNeunen = v; save(); }

function headerStatic(title) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg2);border-bottom:1px solid var(--bdr)">`
    + `<div style="font-weight:700;font-size:15px">${title}</div>`
    + `<button onclick="closeDokoGame()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:34px;height:34px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">${ICO.x}</button></div>`;
}

function render() {
  const c = document.getElementById('dokoGameModalContent');
  if (!c) return;
  if (!G) { c.innerHTML = startScreen(); return; }
  const autoOn = state.dokoAuto !== false;
  const controls = `<div style="display:flex;gap:8px;align-items:center;justify-content:center;padding:6px 12px;border-top:1px solid var(--bdr)">`
    + (pendingContinue ? `<button class="btn btn-primary" style="padding:6px 14px;font-size:13px" onclick="dokoNextTrick()">Nächster Stich ▶</button>` : '')
    + peekButton()
    + ansageButton()
    + `<button class="btn btn-secondary" style="padding:6px 12px;font-size:12px" onclick="dokoToggleAuto()">Auto-Weiter: ${autoOn ? 'an' : 'aus'}</button></div>`;

  // Stage = Overlay-Ziel (oberer Bereich). Hand liegt als Geschwister DARUNTER → von keinem Overlay verdeckt.
  const stage = `<div style="position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden">`
    + `<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;overflow-y:auto;background:var(--bg)">`
    + `<div style="display:flex;justify-content:center;padding:10px 8px 0">${opponentBox(2, 'center')}</div>`
    + `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 8px">`
    + `<div>${opponentBox(1, 'flex-start')}</div>`
    + `<div style="flex:1">${trickArea()}</div>`
    + `<div>${opponentBox(3, 'flex-end')}</div></div>`
    + `<div></div></div>`
    + controls
    + vorbehaltOverlay() + ansageOverlay() + peekOverlay() + resultOverlay()
    + `</div>`;

  c.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;overflow:hidden">`
    + header()
    + turnBanner()
    + hochzeitBanner()
    + stage
    + (G.phase === 'scoring' ? '' : handArea())
    + `</div>`;
}
