// CPU-vs-CPU balance probe: node test/balance_sim.js
// For each tree size and kitten count, plays games with a fast 1-ply CPU and reports
// how often a game ends, how long it takes, and how it is won.
const L = require('../docs/logic.js');
const GAMES = +process.env.GAMES || 12, CAP = +process.env.CAP || 400;
const sizes = (process.env.SIZES || '4,5,6,7,8').split(',').map(Number);
const counts = (process.env.COUNTS || '8,10,12,16,20').split(',').map((x) => (x === 'auto' ? 'auto' : Number(x)));
function playGame(levels, pieces) {
  const decor = process.env.DECOR === 'edge' ? levels - 3 : 1;
  const ornActive = +(process.env.ACTIVE || 1), ornaments = +(process.env.ORN || 3);
  let s = L.newGame({ levels, pieces, decor, ornActive, ornaments });
  let plies = 0;
  while (s.phase !== 'over' && plies < CAP) {
    const m = L.bestMove(s, { depth: 1, rand: 25 });
    if (!m) break;
    if (m.line !== undefined) { s = L.chooseLine(s, m.line).state; continue; }
    if (m.promote !== undefined) { s = L.promote(s, m.promote).state; continue; }
    if (m.orn !== null && m.orn !== undefined) s = L.placeOrnament(s, m.orn).state;
    if (s.phase === 'promote') { s = L.promote(s, L.bestMove(s).promote).state; }
    s = L.play(s, m.idx, m.cat).state;
    plies++;
  }
  return { plies, over: s.phase === 'over', reason: s.winReason };
}
console.log('tiers cells kittens  ended  avg_turns  nice  naughty');
for (const lv of sizes) {
  const cells = L.geometry(lv).cells.length;
  for (const n0 of counts) {
    const n = n0 === 'auto' ? 8 + 2 * (lv - 4) : n0;
    let ended = 0, turns = 0, nice = 0, naughty = 0;
    for (let g = 0; g < GAMES; g++) {
      const r = playGame(lv, n);
      if (r.over) { ended++; turns += r.plies; if (r.reason === 'naughty') naughty++; else nice++; }
    }
    console.log(`${lv}     ${String(cells).padEnd(5)} ${String(n).padEnd(8)} ${String(ended + '/' + GAMES).padEnd(6)} ${String(ended ? Math.round(turns / ended) : '-').padEnd(10)} ${String(nice).padEnd(5)} ${naughty}`);
  }
}
