// Headless KI-vs-KI Vollspiel-Test: node src/game/ai.test.mjs
import * as E from './engine.js';
import * as AI from './ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

function playFullGame(seed) {
  let g = E.createGame({ names: ['KI0', 'KI1', 'KI2', 'KI3'], dealer: seed % 4, seed });
  // Vorbehalt: jeder in Reihenfolge. Beim Schmeißen wird deterministisch neu gegeben.
  let tries = 0;
  while (true) {
    for (const idx of g.vorbehalt.order) g.vorbehalt.declarations[idx] = AI.decideVorbehalt(g, idx);
    E.resolveVorbehalt(g);
    if (g.phase !== 'redeal') break;
    if (++tries > 10) { g.noThrow = true; E.resolveVorbehalt(g); break; }
    g = E.createGame({ names: ['KI0', 'KI1', 'KI2', 'KI3'], dealer: seed % 4, seed: (seed * 7 + tries) | 0 });
  }
  ok(g.phase === 'play', 'Phase nach Vorbehalt = play (seed ' + seed + ')');

  let guard = 0;
  while (g.phase === 'play') {
    if (++guard > 1000) throw new Error('Endlosschleife seed ' + seed);
    const idx = E.currentPlayer(g);
    // Ansage (vor dem Spielen).
    for (const lvl of AI.decideAnnounce(g, idx)) {
      if (E.canAnnounce(g, idx, lvl)) {
        if (lvl === 're' || lvl === 'kontra') g.announcements[lvl] = { by: idx, at: g.cardCount };
      }
    }
    const id = AI.chooseCard(g, idx);
    const legal = E.legalCards(g, idx);
    ok(legal.includes(id), 'KI spielt legale Karte (seed ' + seed + ', trick ' + g.trickIndex + ')');
    E.playCard(g, idx, id);
  }
  return g;
}

for (let seed = 1; seed <= 30; seed++) {
  const g = playFullGame(seed);
  ok(g.phase === 'scoring', 'Spiel endet in Wertung (seed ' + seed + ')');
  ok(g.tricks.length === g.handSize, 'Alle Stiche gespielt (seed ' + seed + ')');
  const r = g.result;
  ok(r.augenRe + r.augenKontra === 240, 'Augensumme 240 (seed ' + seed + '): ' + (r.augenRe + r.augenKontra));
  const sum = Object.values(r.perPlayer).reduce((a, b) => a + b, 0);
  ok(sum === 0, 'Verteilung Zero-Sum (seed ' + seed + '): ' + sum);
}

// Determinismus: gleicher Seed → gleicher Verlauf.
const a = playFullGame(123), b = playFullGame(123);
ok(JSON.stringify(a.tricks.map(t => t.winner)) === JSON.stringify(b.tricks.map(t => t.winner)), 'Deterministischer Verlauf');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
