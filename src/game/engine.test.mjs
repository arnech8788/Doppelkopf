// Headless Engine-Tests: node src/game/engine.test.mjs
import * as E from './engine.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, want ${b})`); }
const C = (suit, rank, copy = 0) => ({ id: E.cardId(suit, rank, copy), suit, rank, copy });

// ── Trumpf-Ordnung (Normalspiel) ──
const normal = { gameType: 'normal' };
const ctxN = E.trumpCtx(normal);
ok(E.isTrump(C('h', '10'), ctxN), 'Herz-10 ist Trumpf');
ok(E.isTrump(C('c', 'D'), ctxN), 'Kreuz-Dame ist Trumpf');
ok(E.isTrump(C('k', 'A'), ctxN), 'Karo-Ass ist Trumpf');
ok(!E.isTrump(C('h', 'A'), ctxN), 'Herz-Ass ist Fehl');
ok(!E.isTrump(C('p', 'K'), ctxN), 'Pik-König ist Fehl');

// Dulle schlägt Kreuz-Dame; zwei gleiche → erste gewinnt.
let trick = [{ idx: 0, card: C('c', 'D') }, { idx: 1, card: C('h', '10') }, { idx: 2, card: C('k', 'A') }, { idx: 3, card: C('p', 'D') }];
eq(E.trickWinner(trick, ctxN).idx, 1, 'Dulle (Herz-10) schlägt alle Damen');
trick = [{ idx: 0, card: C('h', '10', 0) }, { idx: 1, card: C('h', '10', 1) }, { idx: 2, card: C('c', 'D') }, { idx: 3, card: C('k', '9') }];
eq(E.trickWinner(trick, ctxN).idx, 0, 'Bei zwei Dullen gewinnt die zuerst gespielte');

// Fehl-Stich: höchste Farbkarte gewinnt, Abwurf anderer Fehlfarbe zählt nicht.
trick = [{ idx: 0, card: C('p', 'K') }, { idx: 1, card: C('p', 'A') }, { idx: 2, card: C('h', 'A') }, { idx: 3, card: C('p', '10') }];
eq(E.trickWinner(trick, ctxN).idx, 1, 'Pik-Ass gewinnt Pik-Stich; Herz-Ass (Abwurf) zählt nicht');

// ── Augensumme invariant = 240 (48 Karten) ──
const deck = E.buildDeck(true);
eq(deck.length, 48, 'Deck mit Neunen = 48 Karten');
eq(E.countAugen(deck.map(E.cardFromId)), 240, 'Gesamtaugen = 240');
eq(E.buildDeck(false).length, 40, 'Deck ohne Neunen = 40 Karten');

// ── Bedienpflicht ──
{
  const g = E.createGame({ names: ['A', 'B', 'C', 'D'], dealer: 0, seed: 42 });
  g.gameType = 'normal'; g.phase = 'play';
  // Konstruierte Hand für Spieler 1: hat Pik → muss Pik bedienen.
  g.players[1].hand = [E.cardId('p', 'A', 0), E.cardId('p', 'K', 0), E.cardId('h', '10', 0)];
  g.trick = { cards: [{ idx: 0, card: C('p', '9') }], leadIdx: 0 };
  const legal = E.legalCards(g, 1);
  ok(legal.includes(E.cardId('p', 'A', 0)) && legal.includes(E.cardId('p', 'K', 0)), 'Pik muss bedient werden');
  ok(!legal.includes(E.cardId('h', '10', 0)), 'Trumpf nicht erlaubt wenn Pik bedienbar');
  // Ohne Pik → frei.
  g.players[1].hand = [E.cardId('h', '10', 0), E.cardId('c', 'D', 0)];
  eq(E.legalCards(g, 1).length, 2, 'Ohne Bedienfarbe alles erlaubt');
}

// ── Parteien: Kreuz-Damen = Re ──
{
  const g = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 7 });
  const p = E.resolveParties(g);
  ok(p.re.length + p.kontra.length === 4, 'Alle 4 Spieler in einer Partei');
  ok(p.re.every(i => g.players[i].hand.some(id => id[0] === 'c' && id[1] === 'D')), 'Re-Spieler halten eine Kreuz-Dame');
}

// ── Hochzeit-Klärung ──
{
  const g = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 1 });
  g.gameType = 'hochzeit'; g.hochzeit = { brideIdx: 0, partnerIdx: null, clarified: false, byTrick: null };
  g.tricks = [{ winner: 0, augen: 10 }, { winner: 2, augen: 12 }];
  E.clarifyHochzeit(g);
  eq(g.hochzeit.partnerIdx, 2, 'Partner = Gewinner des ersten Fremdstichs');
  // Hängend: Braut gewinnt erste 3 Stiche → Solo.
  const h = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 1 });
  h.gameType = 'hochzeit'; h.hochzeit = { brideIdx: 0, partnerIdx: null, clarified: false, byTrick: null };
  h.tricks = [{ winner: 0 }, { winner: 0 }, { winner: 0 }];
  E.clarifyHochzeit(h);
  ok(h.hochzeit.clarified && h.hochzeit.partnerIdx === null, 'Hängende Hochzeit → Braut allein');
}

// ── Wertung ──
function makeScored(reAugen, opts = {}) {
  // Baut einen Minimal-State mit gewünschter Augenverteilung über Dummy-Stiche.
  const g = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 5 });
  g.gameType = 'normal'; g.cdHolders = [0, 1];
  g.tricks = [{ winner: 0, augen: reAugen, cards: [] }, { winner: 2, augen: 240 - reAugen, cards: [] }];
  g.announcements = opts.ann || { re: null, kontra: null, absagen: [] };
  return E.endScoring(g);
}
{
  const r = makeScored(121);
  eq(r.winner, 're', 'Re gewinnt mit 121');
  eq(r.value, 1, 'Re 121:119 → Wert 1');
  const k = makeScored(120);
  eq(k.winner, 'kontra', 'Bei 120:120 gewinnt Kontra (die Alten verlieren)');
  ok(k.value >= 2, 'Kontra-Sieg enthält „gegen die Alten" (≥2)');
  const re90 = makeScored(150); // Kontra 90 → nicht „keine 90"
  const re91 = makeScored(151); // Kontra 89 → „keine 90"
  ok(re91.value > re90.value, 'Keine 90 gibt Zusatzpunkt');
  // Re angesagt verdoppelt.
  const doubled = makeScored(121, { ann: { re: { by: 0 }, kontra: null, absagen: [] } });
  eq(doubled.value, 2, 'Re-Ansage verdoppelt den Wert');
}

// ── Zero-Sum-Verteilung ──
{
  const r = makeScored(151);
  const sum = Object.values(r.perPlayer).reduce((a, b) => a + b, 0);
  eq(sum, 0, 'Normalspiel-Verteilung ist Zero-Sum');
}

// ── KI-Determinismus (Deal) ──
{
  const a = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 999 });
  const b = E.createGame({ names: ['A', 'B', 'C', 'D'], seed: 999 });
  eq(JSON.stringify(a.players.map(p => p.hand)), JSON.stringify(b.players.map(p => p.hand)), 'Gleicher Seed → gleicher Deal');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
