# Development

## Files

- `docs/index.html`, `docs/style.css`: page and styles (served as is; `docs/` is the site root).
- `docs/logic.js`: pure rules and CPU (`window.BoopLogic` in the browser, `require` in Node).
- `docs/ui.js`: DOM board, 2D and CSS 3D views, animations, panels, save, CPU turns. Diagnostics on `window.__boop`.
- Storage keys: `boop-augmented-save-v1`, `boop-augmented-settings-v1`, `boop-augmented-seen-rules-v1`.
- `docs/online.js`: online rooms. `replay()` (pure) turns room events into a game; `Client` wraps nostr-tools `SimplePool`.
- `docs/vendor/nostr-tools-2.25.5.bundle.js`: vendored nostr-tools (Unlicense), loaded only when online play starts.
- `test/logic.test.js`: rule tests. `test/online.test.js`: replay rules. `test/online_browser_test.py`: two browsers plus a spectator over an in-process fake relay (real relays are blocked in that test). `test/browser_test.py`: Playwright Firefox test, also writes the README screenshots to `test/screens/`.

## Rules as implemented

Source: the official boop the Halls! rules on Dized (publisher-verified) plus the Dized FAQ.

1. Board: `levels` L (4 to 8), grid N = 2L-1. Tier of a cell = Chebyshev ring from the centre (ring 0 = treetop). The 4 grid corners are missing (cut-off base corners). Off-board cells count as off the tree.
2. Each player: `pieces` kittens (default 8) and 3 ornaments. Cats come only from graduation, so a player always has `pieces` cats+kittens.
3. Turn start: no own ornament on the tree and one in the pool -> phase `ornament`: hang it on a free ring-1 cell, else the next free ring outward. Ornaments do not boop.
4. Phase `place`: put a kitten or cat on any free cell. Each adjacent piece moves one step outward along its own ray if the target is free; no chain reactions. Kittens do not move cats.
5. Ornaments never move to a smaller ring. An ornament pushed off the tree: own -> pool, opponent's -> captured by the active player.
6. A cat pushed onto an ornament (pounce): both leave; the cat returns to its owner's pool; the ornament is captured by the cat's owner, or returned if it is theirs. A kitten pushed onto an ornament is blocked.
7. After all movement: 3 captured ornaments -> naughty win (active player checked first). Only the active player's lines count (FAQ: the opponent's lines do not score on your turn). An all-cat line -> nice win. All `pieces` on the tree and all cats -> nice win. One line -> graduates automatically. Several -> phase `chooseLine`. No line and all pieces on the tree -> phase `promote` (remove one own kitten/cat; it returns as a cat; then the turn passes).

Simplifications: when a turn offers both a line and the all-on-the-tree graduation, the line wins (the printed rules let the player choose). The tier geometry (7x7, rings of 1/8/16/20 cells, cut-off corners) was read from setup photos and video frames, not from a printed diagram.

## 3D view

Pure CSS 3D, no WebGL. The board gets `scale(zoom) rotateX(tilt) rotateZ(spin)` inside a `perspective` wrapper; the cell size is chosen so the board fits at any spin and tilt (diagonal vs tower height). The star is two crossed standing planes on the treetop cell, so it turns with the tree. Each tier's top face sits at `translateZ((L - ring) * 0.42 * cell)`, side walls are rotated divs, and pieces are billboards (`rotateZ(-spin) rotateX(-58deg)`) so they always face the camera. Cells stay real buttons, so clicks and keyboard focus work the same in 2D and 3D.

## Kitten count on bigger trees

`test/balance_sim.js` plays fast 1-ply CPU-vs-CPU games for every tree size and kitten count. With 8 kittens a game lasts about the same number of turns on every tree, but the pieces are spread thin on the big ones. Auto adds 2 kittens per extra tier, so a game on 8 tiers with 16 kittens lasts about 46 plies (23 turns each), close to the classic tree at its official 8. Above 16 games get long and the all-cats-on-the-tree win becomes unrealistic. On 5+ tiers the naughty (ornament) win almost disappeared with the official ornament rule: ornaments hang near the centre, far from the edge. More ornaments alone did not fix it; more ornaments hung nearer the edge did (6 tiers, 3 at once on ring L-3: 5 of 8 CPU games won naughty). Auto ornaments (`ornCfg` in `ui.js`): `ornaments = min(6, L-1)`, `ornActive = 1 + floor((L-3)/2)`, `decor = L-3`; on 4 tiers this equals the official rule. `newGame` options: `ornaments`, `ornActive`, `ornWin`, `decor`.

## Online rooms

- Room = random 8-character id, link `?room=<id>`. Events: kind 8812 (regular, so relays store them), tag `["t","boop-augmented-<id>"]`, JSON content with `v: 1`.
- `create {cfg}` by the host (Snowball), `join` by the first other key (Coal), `move {seq, a}` with `a = {k: orn|play|line|promote, i, c}`.
- Every client replays the whole room with `logic.js`. A move counts only with the next `seq`, from the player whose turn it is, and only if it is legal; for one `seq` the earliest valid event wins. Relays carry data and cannot cheat for a player.
- Keys: one throwaway key per browser (`boop-augmented-nostr-key-v1` in localStorage); no login. Relays: damus, nos.lol, primal, snort; `?relays=wss://a,wss://b` overrides them (tests use a fake relay).
- Measured on real relays: room created in about 4 s, guest seated about 1 s later, a move delivered in 0.4 s.
- Not yet: rematch in the same room, chat, NIP-07 login, a public lobby.

## CPU

Every full turn (ornament cell x placement, with line choice and promotion auto-resolved) is scored, then the top 10 are checked against the opponent's best reply (ornament cells sampled to 3). Eval: cats, captured ornaments, open pairs, ornaments exposed to a push off the tree. About 5 / 9 / 21 ms per move on 4 / 6 / 8 tiers.

## Tests

```bash
node test/logic.test.js       # rule checks + CPU self-play timing
node test/online.test.js      # room replay checks
python test/online_browser_test.py   # two browsers + spectator over a fake relay
python test/browser_test.py   # Firefox, desktop + mobile, 2D + 3D clicks, screenshots
```
