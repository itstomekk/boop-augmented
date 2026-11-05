# Updating

1. Change the game in `docs/` (rules in `docs/logic.js`, UI in `docs/ui.js`).
2. Run the node tests (`logic`, `multiplayer`, `square_ghost`, `boopmas`, `shuffle`, `online`, `online_multi`, `online_square_ghost`, `online_powers`) and the browser tests listed in DEVELOPMENT.md. Each must end with PASS.
3. If the look changed, copy the fresh board crops from `test/screens/board-desktop-*.png` to `.github/readme/` (classic-3d, classic-2d, big-2d, big-3d; `board-desktop-square-2d.png` -> `square-ghost-2d.png`, `board-desktop-square-3d.png` -> `square-ghost-3d.png`, written by `square_ghost_browser_test.py`; `board-desktop-shuffle-2d.png` -> `shuffle-2d.png`, `board-desktop-shuffle-3d.png` -> `shuffle-3d.png`, `board-desktop-boopmas-2d.png` -> `boopmas-aim-2d.png`, `board-desktop-boopmas-3d.png` -> `boopmas-aim-3d.png`, written by `powers_browser_test.py`) and the mobile shot to `.github/readme/mobile-3d.png`.
4. Commit and push to `main`.
