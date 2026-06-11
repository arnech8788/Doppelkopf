// game/ai.js – Taktische Doppelkopf-KI. Pure Functions, hängt nur von engine.js ab.
// Kein eigener Zufall (deterministisch, Tie-Break über Karten-ID) → reproduzierbar testbar.
import {
  trumpCtx, isTrump, legalCards, trickWinner, cardFromId, countAugen,
  AUGEN, canDeclareHochzeit, canAnnounce,
} from './engine.js';

// ── Parteien aus Sicht von self ableiten (nur öffentlich Bekanntes) ──
export function inferParties(state, self) {
  const side = { 0: 'unknown', 1: 'unknown', 2: 'unknown', 3: 'unknown' };
  if (state.gameType === 'solo') {
    for (let i = 0; i < 4; i++) side[i] = i === state.soloist ? 're' : 'kontra';
    return mkView(side);
  }
  if (state.gameType === 'hochzeit') {
    const h = state.hochzeit;
    side[h.brideIdx] = 're';
    if (h.clarified) {
      for (let i = 0; i < 4; i++) if (side[i] === 'unknown') side[i] = (i === h.partnerIdx) ? 're' : 'kontra';
    }
    return mkView(side);
  }
  // normal / stille
  if (state.cdHolders.includes(self)) side[self] = 're';
  // öffentlich gespielte Kreuz-Damen verraten Re.
  for (const tr of state.tricks) for (const pc of tr.cards) {
    if (pc.card.suit === 'c' && pc.card.rank === 'D') side[pc.idx] = 're';
  }
  for (const pc of state.trick.cards) {
    if (pc.card.suit === 'c' && pc.card.rank === 'D') side[pc.idx] = 're';
  }
  if (state.announcements.re) side[state.announcements.re.by] = 're';
  if (state.announcements.kontra) side[state.announcements.kontra.by] = 'kontra';
  // Sind beide Re-Spieler bekannt → Rest ist Kontra.
  const reKnown = Object.keys(side).filter(i => side[i] === 're');
  if (reKnown.length >= 2) for (let i = 0; i < 4; i++) if (side[i] === 'unknown') side[i] = 'kontra';
  return mkView(side);
}
function mkView(side) {
  return {
    side: i => side[i],
    sameKnown: (a, b) => side[a] !== 'unknown' && side[a] === side[b],
  };
}

// ── Handbewertung ──
function handStats(handIds, ctx) {
  const cards = handIds.map(cardFromId);
  const trumps = cards.filter(c => isTrump(c, ctx));
  const damen = cards.filter(c => c.rank === 'D').length;
  const buben = cards.filter(c => c.rank === 'B').length;
  const dullen = cards.filter(c => c.suit === 'h' && c.rank === '10').length;
  const aces = cards.filter(c => !isTrump(c, ctx) && c.rank === 'A').length;
  return { trumps: trumps.length, damen, buben, dullen, aces, total: cards.length };
}

// ── Vorbehalt-Entscheidung ──
export function decideVorbehalt(state, idx) {
  const hand = state.players[idx].hand;
  // Hochzeit: beide Kreuz-Damen.
  if (canDeclareHochzeit(state, idx)) return { type: 'hochzeit' };
  const cards = hand.map(cardFromId);
  // Farb-/Trumpf-Solo: im echten Regime des jeweiligen Solos bewerten (Dulle+Damen+Buben+Farbe)
  // und das trumpfstärkste wählen. Nur bei klarer Trumpf-Mehrheit + hohen Spitzen.
  // ('trumpf' = Karo-Regime, deckt 'farbe-k' ab; bei Gleichstand gewinnt der erste → Karo/Trumpf.)
  let best = null;
  for (const soloType of ['trumpf', 'farbe-c', 'farbe-p', 'farbe-h']) {
    const s = handStats(hand, trumpCtx({ gameType: 'solo', soloType }));
    if (s.trumps >= 9 && (s.damen + s.dullen) >= 2 && (!best || s.trumps > best.t)) {
      best = { soloType, t: s.trumps };
    }
  }
  if (best) return { type: 'solo', soloType: best.soloType };
  // Damen-/Buben-Solo: nur bei Dominanz dieser wenigen Trümpfe (≥5 von 8) + Fehl-Assen.
  const damen = cards.filter(c => c.rank === 'D').length;
  const buben = cards.filter(c => c.rank === 'B').length;
  const aces = cards.filter(c => c.rank === 'A').length;
  if (damen >= 5 && aces >= 1) return { type: 'solo', soloType: 'damen' };
  if (buben >= 5 && aces >= 1) return { type: 'solo', soloType: 'buben' };
  return { type: 'gesund' };
}

// ── Ansage-Entscheidung (konservativ: nur Re/Kontra bei klarer Stärke) ──
export function decideAnnounce(state, idx) {
  const view = inferParties(state, idx);
  const mySide = view.side(idx);
  if (mySide !== 're' && mySide !== 'kontra') return [];
  if (state.announcements[mySide]) return []; // bereits angesagt
  if (!canAnnounce(state, idx, mySide)) return [];
  const ctx = trumpCtx(state);
  const s = handStats(state.players[idx].hand, ctx);
  // Starke Hand: viele Trümpfe + Spitzen → ansagen.
  if (s.trumps >= 6 && (s.damen + s.dullen) >= 2) return [mySide];
  return [];
}

// ── Karten-Auswahl ──
export function chooseCard(state, idx) {
  const ctx = trumpCtx(state);
  const legal = legalCards(state, idx).map(cardFromId);
  if (legal.length === 1) return legal[0].id;
  const trick = state.trick.cards;
  const view = inferParties(state, idx);
  const mySide = view.side(idx);

  const augenOf = c => AUGEN[c.rank];
  const byAugenAsc = (a, b) => augenOf(a) - augenOf(b) || a.id.localeCompare(b.id);
  const byAugenDesc = (a, b) => augenOf(b) - augenOf(a) || a.id.localeCompare(b.id);
  const lowSafe = arr => {
    // niedrigste Augen; Fuchs (Karo-Ass) nicht verschenken, falls Alternativen.
    const noFox = arr.filter(c => !(c.suit === 'k' && c.rank === 'A'));
    return (noFox.length ? noFox : arr).slice().sort(byAugenAsc)[0];
  };

  // ── Ausspiel (Stich leer) ──
  if (trick.length === 0) {
    const nonTrump = legal.filter(c => !isTrump(c, ctx));
    const aces = nonTrump.filter(c => c.rank === 'A');
    if (aces.length) {
      // Sicheres Fehl-Ass: keine bekannte Lücke (void) der anderen in dieser Farbe.
      const voids = computeVoids(state, ctx);
      const safe = aces.filter(a => ![0, 1, 2, 3].some(o => o !== idx && voids[o] && voids[o].has(a.suit)));
      const pick = (safe.length ? safe : aces).slice().sort(byAugenDesc)[0];
      return pick.id;
    }
    if (nonTrump.length) return lowSafe(nonTrump).id;       // Fehl abwerfen, Punkte sparen
    // Nur Trümpfe: schwächsten zuerst (höchster Stärke-Index).
    return legal.slice().sort((a, b) => trumpStrength(b, ctx) - trumpStrength(a, ctx))[0].id;
  }

  // ── Bedienen ──
  const curBest = trickWinner(trick, ctx);
  const winnerIdx = curBest.idx;
  const isLast = trick.length === 3;
  const winnerSide = view.side(winnerIdx);
  const winnerIsMine = mySide !== 'unknown' && winnerSide === mySide;

  const beats = c => trickWinner(trick.concat([{ idx, card: c }]), ctx).idx === idx;
  const winners = legal.filter(beats);
  const trickAugen = countAugen(trick.map(t => t.card));

  if (winnerIsMine && winnerIdx !== idx) {
    // Partner führt → schmieren (hohe Augen), v. a. wenn letzter Spieler oder Partner stark sticht.
    const partnerStrong = isTrump(curBest.card, ctx) && trumpStrength(curBest.card, ctx) <= 4;
    if (isLast || partnerStrong) {
      const nonWin = legal.filter(c => !winners.includes(c));
      const pool = nonWin.length ? nonWin : legal;
      return pool.slice().sort(byAugenDesc)[0].id;
    }
    return lowSafe(legal).id;
  }

  // Gegner (oder unbekannt → vorsichtig wie Gegner) führt.
  const worth = trickAugen >= 10 || state.trickIndex >= state.handSize - 3;
  if (winners.length && worth) return cheapestWinner(winners, ctx).id;
  return lowSafe(legal).id;
}

// Liefert je höher desto SCHWÄCHER: 0 = stärkster Trumpf.
function trumpStrength(card, ctx) {
  // Vergleiche Karte gegen alle anderen über trickWinner ist teuer; rekonstruiere Liste.
  const order = trumpOrder(ctx);
  const i = order.indexOf(card.suit + card.rank);
  return i < 0 ? 99 : i;
}
const _orderCache = new Map();
function trumpOrder(ctx) {
  const key = ctx.regime + '|' + (ctx.trumpSuit || '');
  let o = _orderCache.get(key);
  if (o) return o;
  if (ctx.regime === 'damen') o = ['cD', 'pD', 'hD', 'kD'];
  else if (ctx.regime === 'buben') o = ['cB', 'pB', 'hB', 'kB'];
  else {
    o = [];
    if (ctx.trumpSuit !== 'h') o.push('h10');
    o.push('cD', 'pD', 'hD', 'kD', 'cB', 'pB', 'hB', 'kB');
    for (const r of ['A', '10', 'K', '9']) { const k = ctx.trumpSuit + r; if (!o.includes(k)) o.push(k); }
  }
  _orderCache.set(key, o);
  return o;
}

function cheapestWinner(winners, ctx) {
  // Bevorzuge Gewinn mit Fehlkarte; sonst schwächster (höchster Index) Trumpf, wenig Augen.
  const fehl = winners.filter(c => !isTrump(c, ctx));
  const pool = fehl.length ? fehl : winners;
  return pool.slice().sort((a, b) => {
    const sa = isTrump(a, ctx) ? trumpStrength(a, ctx) : -1;
    const sb = isTrump(b, ctx) ? trumpStrength(b, ctx) : -1;
    // höherer Index (schwächerer Trumpf) zuerst; bei Fehl wenig Augen
    return (sb - sa) || (AUGEN[a.rank] - AUGEN[b.rank]) || a.id.localeCompare(b.id);
  })[0];
}

// ── Void-Inferenz: wer hat welche (effektive) Farbe nicht bedient ──
export function computeVoids(state, ctx) {
  const voids = { 0: new Set(), 1: new Set(), 2: new Set(), 3: new Set() };
  const scan = trickCards => {
    if (!trickCards.length) return;
    const leadSuit = isTrump(trickCards[0].card, ctx) ? 'T' : trickCards[0].card.suit;
    for (let i = 1; i < trickCards.length; i++) {
      const c = trickCards[i];
      const eff = isTrump(c.card, ctx) ? 'T' : c.card.suit;
      if (eff !== leadSuit) voids[c.idx].add(leadSuit === 'T' ? 'T' : leadSuit);
    }
  };
  for (const tr of state.tricks) scan(tr.cards);
  scan(state.trick.cards);
  return voids;
}
