// game/engine.js – Reine Doppelkopf-Regel-Logik (DOM-frei, main-frei → headless testbar).
// Karten, Deck/Geben, Trumpf-Ordnung, Bedienpflicht, Stich-Gewinner, Augen, Parteien,
// Hochzeit-Klärung, Ansage-Fristen, Endwertung. Keine Importe aus dem App-Code.

// ── Konstanten ──
export const SUITS = ['k', 'h', 'p', 'c'];            // Karo, Herz, Pik, Kreuz
export const RANKS = ['9', '10', 'B', 'D', 'K', 'A']; // 9, 10, Bube, Dame, König, Ass
export const AUGEN = { A: 11, '10': 10, K: 4, D: 3, B: 2, '9': 0 };
// Stärke einer Fehlkarte innerhalb ihrer Farbe (höher = stärker).
export const FEHL_POWER = { A: 6, '10': 5, K: 4, D: 3, B: 2, '9': 1 };
export const SUIT_NAME = { k: 'Karo', h: 'Herz', p: 'Pik', c: 'Kreuz' };
export const SUIT_SYM = { k: '♦', h: '♥', p: '♠', c: '♣' };

// Max. Anzahl bereits vom Ansager gespielter Karten, damit die Ansage noch gilt.
// Höhere Absagen müssen früher erfolgen → kleinerer Wert (vereinfachte, gut spielbare Regel).
export const ANNOUNCE_MAX_PLAYED = { re: 4, kontra: 4, '90': 3, '60': 2, '30': 1, schwarz: 0 };

// ── Karten-Hilfen ──
export function cardFromId(id) {
  const suit = id[0];
  const rest = id.slice(1).split('#');
  return { id, suit, rank: rest[0], copy: +rest[1] };
}
export function cardId(suit, rank, copy) { return `${suit}${rank}#${copy}`; }
export function cardLabel(card) { return SUIT_SYM[card.suit] + (card.rank === '10' ? '10' : card.rank); }

// ── Seedbarer RNG (Mulberry32) + Fisher-Yates ──
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Deck & Geben ──
export function buildDeck(mitNeunen) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) {
    if (r === '9' && !mitNeunen) continue;
    deck.push(cardId(s, r, 0), cardId(s, r, 1));
  }
  return deck; // 48 (mit Neunen) oder 40
}

// ── Trumpf-Regime je Spieltyp ──
// regime 'full': Dulle + alle Damen + alle Buben + Karo (Normalspiel / Trumpf-Solo).
// regime 'damen'/'buben': nur Damen bzw. Buben sind Trumpf.
// regime 'fleischlos': kein Trumpf (höchste Karte der angespielten Farbe gewinnt).
export function trumpCtx(state) {
  const gt = state.gameType;
  if (gt === 'solo') {
    const st = state.soloType;
    if (st === 'damen') return { regime: 'damen' };
    if (st === 'buben') return { regime: 'buben' };
    if (st === 'fleischlos') return { regime: 'fleischlos' };
    return { regime: 'full', trumpSuit: 'k' }; // 'trumpf'
  }
  return { regime: 'full', trumpSuit: 'k' }; // normal / hochzeit / stille
}

// Geordnete Liste der Trumpf-Schlüssel (suit+rank), stärkster zuerst.
function trumpList(ctx) {
  if (ctx.regime === 'fleischlos') return [];
  if (ctx.regime === 'damen') return ['cD', 'pD', 'hD', 'kD'];
  if (ctx.regime === 'buben') return ['cB', 'pB', 'hB', 'kB'];
  const list = [];
  if (ctx.trumpSuit !== 'h') list.push('h10'); // Dulle (entfällt im Herz-Solo)
  list.push('cD', 'pD', 'hD', 'kD', 'cB', 'pB', 'hB', 'kB');
  for (const r of ['A', '10', 'K', '9']) {
    const key = ctx.trumpSuit + r;
    if (!list.includes(key)) list.push(key);
  }
  return list;
}
const _trumpCache = new Map();
function trumpIndexMap(ctx) {
  const key = ctx.regime + '|' + (ctx.trumpSuit || '');
  let m = _trumpCache.get(key);
  if (!m) {
    m = new Map();
    trumpList(ctx).forEach((k, i) => m.set(k, i));
    _trumpCache.set(key, m);
  }
  return m;
}
export function isTrump(card, ctx) { return trumpIndexMap(ctx).has(card.suit + card.rank); }
function trumpIdx(card, ctx) { return trumpIndexMap(ctx).get(card.suit + card.rank); }
// 'T' für Trumpf, sonst die Fehlfarbe – maßgeblich für die Bedienpflicht.
export function effectiveSuit(card, ctx) { return isTrump(card, ctx) ? 'T' : card.suit; }

// ── Augen zählen ──
export function countAugen(cards) { return cards.reduce((s, c) => s + AUGEN[c.rank], 0); }

// ── Stich-Gewinner ── trick = [{idx, card}] in Spielreihenfolge.
export function trickWinner(trick, ctx) {
  let best = trick[0];
  let bestTrump = isTrump(best.card, ctx);
  const leadSuit = best.card.suit;
  for (let i = 1; i < trick.length; i++) {
    const c = trick[i];
    const t = isTrump(c.card, ctx);
    if (bestTrump) {
      if (t) {
        const di = trumpIdx(c.card, ctx), bi = trumpIdx(best.card, ctx);
        // Höherer Trumpf gewinnt; bei zwei Dullen (h10) gewinnt die zweite (zuletzt gelegte),
        // sonst bleibt bei Gleichstand die zuerst gelegte.
        if (di < bi || (di === bi && c.card.suit === 'h' && c.card.rank === '10')) best = c;
      }
    } else if (t) {
      best = c; bestTrump = true;
    } else if (c.card.suit === leadSuit && FEHL_POWER[c.card.rank] > FEHL_POWER[best.card.rank]) {
      best = c;
    }
  }
  return best;
}

// ── Aktueller Spieler / legale Karten ──
export function currentPlayer(state) {
  const t = state.trick;
  if (t.cards.length === 0) return t.leadIdx;
  return (t.cards[t.cards.length - 1].idx + 1) % 4;
}
export function legalCards(state, idx) {
  const ctx = trumpCtx(state);
  const hand = state.players[idx].hand.map(cardFromId);
  if (state.trick.cards.length === 0) return hand.map(c => c.id);
  const lead = state.trick.cards[0].card;
  const leadEff = effectiveSuit(lead, ctx);
  const follow = hand.filter(c => effectiveSuit(c, ctx) === leadEff);
  return (follow.length ? follow : hand).map(c => c.id);
}

// ── Hand sortieren (für Anzeige): Trümpfe (stärkste zuerst), dann Fehlfarben gruppiert ──
export function sortHand(handIds, ctx) {
  const cards = handIds.map(cardFromId);
  const fehlOrder = ['c', 'p', 'h', 'k'];
  return cards.sort((a, b) => {
    const at = isTrump(a, ctx), bt = isTrump(b, ctx);
    if (at && bt) return trumpIdx(a, ctx) - trumpIdx(b, ctx);
    if (at) return -1;
    if (bt) return 1;
    if (a.suit !== b.suit) return fehlOrder.indexOf(a.suit) - fehlOrder.indexOf(b.suit);
    return FEHL_POWER[b.rank] - FEHL_POWER[a.rank];
  }).map(c => c.id);
}

// ── Parteien bestimmen (finale Zuordnung für Wertung) ──
export function resolveParties(state) {
  const all = [0, 1, 2, 3];
  if (state.gameType === 'solo') {
    return { re: [state.soloist], kontra: all.filter(i => i !== state.soloist) };
  }
  if (state.gameType === 'hochzeit') {
    const b = state.hochzeit.brideIdx;
    if (state.hochzeit.partnerIdx != null) {
      const p = state.hochzeit.partnerIdx;
      return { re: [b, p], kontra: all.filter(i => i !== b && i !== p) };
    }
    return { re: [b], kontra: all.filter(i => i !== b) }; // hängende Hochzeit → allein
  }
  // normal / stille: Kreuz-Damen-Halter = Re (einer = stille Hochzeit)
  const re = state.cdHolders.slice();
  return { re, kontra: all.filter(i => !re.includes(i)) };
}

// ── Hochzeit-Klärung nach jedem Stich ──
export function clarifyHochzeit(state) {
  const h = state.hochzeit;
  if (!h || h.clarified) return;
  // Erster von einem Fremdspieler gewonnener Stich innerhalb der ersten 3 → dessen Gewinner = Partner.
  for (const tr of state.tricks) {
    if (tr.winner !== h.brideIdx) { h.partnerIdx = tr.winner; h.clarified = true; h.byTrick = tr; return; }
  }
  if (state.tricks.length >= 3) { h.partnerIdx = null; h.clarified = true; } // hängend → Solo
}

// ── Ansage-Frist ──
export function canAnnounce(state, idx, level) {
  if (state.phase !== 'play') return false;
  const played = state.players[idx].played || 0;
  return played <= (ANNOUNCE_MAX_PLAYED[level] ?? 0);
}

// ── Karte spielen (mutiert state) ──
export function playCard(state, idx, id) {
  const p = state.players[idx];
  const ci = p.hand.indexOf(id);
  if (ci < 0) throw new Error('Karte nicht in Hand: ' + id);
  p.hand.splice(ci, 1);
  state.trick.cards.push({ idx, card: cardFromId(id) });
  p.played = (p.played || 0) + 1;
  state.cardCount++;
  const res = { trickComplete: false };
  if (state.trick.cards.length === 4) {
    const ctx = trumpCtx(state);
    const win = trickWinner(state.trick.cards, ctx);
    const augen = countAugen(state.trick.cards.map(c => c.card));
    state.tricks.push({ winner: win.idx, cards: state.trick.cards.slice(), augen, leadIdx: state.trick.leadIdx });
    state.trick = { cards: [], leadIdx: win.idx };
    state.trickIndex++;
    if (state.gameType === 'hochzeit') clarifyHochzeit(state);
    res.trickComplete = true; res.winnerIdx = win.idx; res.augen = augen;
    if (state.players.every(pl => pl.hand.length === 0)) {
      state.phase = 'scoring';
      state.result = endScoring(state);
      res.gameOver = true;
    }
  }
  return res;
}

// ── Endwertung (an calcPoints/saveNewRound des Scorekeepers angelehnt) ──
export function endScoring(state) {
  const parties = resolveParties(state);
  const ctx = trumpCtx(state);
  let augenRe = 0, augenKontra = 0;
  const reSet = new Set(parties.re);
  for (const tr of state.tricks) {
    if (reSet.has(tr.winner)) augenRe += tr.augen; else augenKontra += tr.augen;
  }
  const winner = augenRe >= 121 ? 're' : 'kontra';
  const loserAugen = winner === 're' ? augenKontra : augenRe;
  // Solo (auch stilles Solo): kein „Gegen die Alten", keine Fuchs/Doppelkopf/Karlchen,
  // dafür ein fester, nicht verdoppelter Solopunkt – analog zum manuellen Punkterechner.
  const isSolo = state.gameType === 'solo' || state.gameType === 'stille';
  const breakdown = [];

  let base = 1; breakdown.push('Gewonnen +1');
  if (!isSolo && winner === 'kontra') { base += 1; breakdown.push('Gegen die Alten +1'); }
  if (loserAugen < 90) { base += 1; breakdown.push('Keine 90 +1'); }
  if (loserAugen < 60) { base += 1; breakdown.push('Keine 60 +1'); }
  if (loserAugen < 30) { base += 1; breakdown.push('Keine 30 +1'); }
  if (loserAugen === 0) { base += 1; breakdown.push('Schwarz +1'); }

  // Erfüllte angesagte Absagen der Gewinnerseite → je +1 Bonus.
  const a = state.announcements;
  for (const ab of (a.absagen || [])) {
    if (ab.party !== winner) continue;
    const ok = (ab.level === '90' && loserAugen < 90) || (ab.level === '60' && loserAugen < 60)
      || (ab.level === '30' && loserAugen < 30) || (ab.level === 'schwarz' && loserAugen === 0);
    if (ok) { base += 1; breakdown.push('Angesagt „Keine ' + (ab.level === 'schwarz' ? 'Schwarz' : ab.level) + '" +1'); }
  }

  let mult = 1;
  if (a.re) { mult *= 2; breakdown.push('Re angesagt ×2'); }
  if (a.kontra) { mult *= 2; breakdown.push('Kontra angesagt ×2'); }
  const spielwert = base * mult;

  // ── Sonderpunkte (NICHT verdoppelt), je Seite – beim Solo gibt es keine. ──
  let sonderRe = 0, sonderKontra = 0;
  if (!isSolo) {
    const credit = (winnerIdx, n) => { if (reSet.has(winnerIdx)) sonderRe += n; else sonderKontra += n; };
    // Doppelkopf: Stich mit ≥40 Augen.
    for (const tr of state.tricks) if (tr.augen >= 40) { credit(tr.winner, 1); breakdown.push('Doppelkopf +1'); }
    // Fuchs gefangen: Karo-Ass im Stich der Gegenpartei (nur wenn Karo Trumpf ist).
    if (ctx.regime === 'full' && ctx.trumpSuit === 'k') {
      for (const tr of state.tricks) {
        const winnerIsRe = reSet.has(tr.winner);
        for (const pc of tr.cards) {
          if (pc.card.suit === 'k' && pc.card.rank === 'A') {
            const playerIsRe = reSet.has(pc.idx);
            if (playerIsRe !== winnerIsRe) { credit(tr.winner, 1); breakdown.push('Fuchs gefangen +1'); }
          }
        }
      }
    }
    // Karlchen/Charlie: Kreuz-Bube gewinnt den letzten Stich.
    const last = state.tricks[state.tricks.length - 1];
    if (last) {
      const wc = last.cards.find(c => c.idx === last.winner);
      if (wc && wc.card.suit === 'c' && wc.card.rank === 'B') { credit(last.winner, 1); breakdown.push('Karlchen +1'); }
    }
  }

  const sonderWinner = winner === 're' ? sonderRe : sonderKontra;
  const sonderLoser = winner === 're' ? sonderKontra : sonderRe;
  // Solopunkt: fester +1-Punkt beim Solo, wird NICHT verdoppelt (geht an die Gewinnerseite).
  let soloPkt = 0;
  if (isSolo) { soloPkt = 1; breakdown.push('Solopunkt +1'); }
  const V = spielwert + soloPkt + sonderWinner - sonderLoser;

  const perPlayer = distribute(parties, winner, V);
  return {
    augenRe, augenKontra, winner, spielwert, mult, base,
    sonder: { re: sonderRe, kontra: sonderKontra }, value: V,
    parties, perPlayer, breakdown,
  };
}

// Zero-Sum-Verteilung: einzelne Seite (Solo/stille) ×3, sonst je ±V.
function distribute(parties, winner, V) {
  const per = {};
  const { re, kontra } = parties;
  const lone = re.length === 1 ? 're' : (kontra.length === 1 ? 'kontra' : null);
  for (const idx of [...re, ...kontra]) {
    const side = re.includes(idx) ? 're' : 'kontra';
    const sign = side === winner ? 1 : -1;
    const mag = (lone && side === lone) ? 3 * V : V;
    per[idx] = sign * mag;
  }
  return per;
}

// ── Neues Spiel anlegen ──
export function createGame({ names, dealer = 0, mitNeunen = true, seed = Date.now() }) {
  const rng = makeRng(seed);
  const deck = shuffle(buildDeck(mitNeunen), rng);
  const handSize = deck.length / 4;
  const players = names.map((name, idx) => ({
    idx, name, isHuman: idx === 0,
    hand: deck.slice(idx * handSize, idx * handSize + handSize),
    played: 0,
  }));
  const forehand = (dealer + 1) % 4;
  const ctx0 = { regime: 'full', trumpSuit: 'k' };
  for (const p of players) p.hand = sortHand(p.hand, ctx0);
  // Kreuz-Damen-Halter (für Parteien / stille Hochzeit).
  const cdHolders = [];
  players.forEach(p => { if (p.hand.some(id => id[0] === 'c' && id[1] === 'D')) cdHolders.push(p.idx); });

  return {
    seed, mitNeunen, handSize,
    players, dealer, forehand,
    phase: 'vorbehalt',
    gameType: 'normal', soloType: null, soloist: null,
    hochzeit: null,
    cdHolders,
    vorbehalt: { order: [forehand, (forehand + 1) % 4, (forehand + 2) % 4, (forehand + 3) % 4], current: 0, declarations: {} },
    trick: { cards: [], leadIdx: forehand },
    trickIndex: 0,
    tricks: [],
    announcements: { re: null, kontra: null, absagen: [] },
    cardCount: 0,
    result: null,
  };
}

// Spieler darf Hochzeit ansagen (hält beide Kreuz-Damen).
export function canDeclareHochzeit(state, idx) {
  return state.players[idx].hand.filter(id => id[0] === 'c' && id[1] === 'D').length === 2;
}

// Vorbehalte auflösen → setzt gameType/soloType/soloist bzw. Hochzeit; sonst normal/stille.
// Schmeißen-Berechtigung: „nicht über den Fuchs" – keine Dulle, keine Dame, kein Bube.
export function canThrow(handIds) {
  const cards = handIds.map(cardFromId);
  return !cards.some(c => c.rank === 'D' || c.rank === 'B' || (c.suit === 'h' && c.rank === '10'));
}

export function resolveVorbehalt(state) {
  const decls = state.vorbehalt.declarations;
  const order = state.vorbehalt.order;
  // Solo hat Vorrang; bei mehreren Soli gewinnt der frühste ab Vorhand.
  for (const idx of order) {
    const d = decls[idx];
    if (d && d.type === 'solo') {
      state.gameType = 'solo'; state.soloType = d.soloType; state.soloist = idx;
      state.trick.leadIdx = state.forehand;
      state.phase = 'play';
      return;
    }
  }
  // Schmeißen → Neugeben (sofern nicht durch Sicherheitsstopp unterdrückt).
  if (!state.noThrow) {
    for (const idx of order) {
      const d = decls[idx];
      if (d && d.type === 'schmeissen') { state.thrownBy = idx; state.phase = 'redeal'; return; }
    }
  }
  for (const idx of order) {
    const d = decls[idx];
    if (d && d.type === 'hochzeit') {
      state.gameType = 'hochzeit';
      state.hochzeit = { brideIdx: idx, partnerIdx: null, clarified: false, byTrick: null };
      state.phase = 'play';
      return;
    }
  }
  // Kein Vorbehalt: normal (ein einzelner Kreuz-Damen-Halter = stille Hochzeit).
  state.gameType = state.cdHolders.length === 1 ? 'stille' : 'normal';
  state.phase = 'play';
}

export function gameTypeLabel(state) {
  if (state.gameType === 'solo') {
    const m = { trumpf: 'Trumpf-Solo', damen: 'Damen-Solo', buben: 'Buben-Solo', fleischlos: 'Fleischlos' };
    return m[state.soloType] || 'Solo';
  }
  if (state.gameType === 'hochzeit') return 'Hochzeit';
  if (state.gameType === 'stille') return 'Normalspiel';
  return 'Normalspiel';
}
