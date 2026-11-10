# Riichi Mahjong Score Learner

A web app for practising Riichi Mahjong, styled after a Mahjong Soul table. It has two sections:

- **Score Learner** (`index.html`) – score random winning hands.
- **Play Trainer** (`play.html`) – play full games against computer opponents and have every decision graded.

Every round deals a random **winning hand** and tells you whether it was won by **tsumo** or **ron** and whether you are the **dealer**. Han and fu are randomised (weighted toward the 1–4 han / 20–110 fu part of the chart, with limit hands mixed in); the hand shown is a real hand whose fu and yaku actually produce those numbers. Type the payment, press **Check**, and the panel explains the fu count, the yaku, and the arithmetic.

## Running

No build step and no dependencies – just open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
```

## Features

- **Random hands** – 4 sets + pair or chiitoitsu, open/closed melds, closed & open kans, red fives, dora indicators that really match the dora count, riichi/ippatsu/ura dora as fillers.
- **Real evaluation** – the hand is decomposed into every valid interpretation and the best-scoring one is used (pinfu vs. non-pinfu, iipeikou/ryanpeikou, wait ambiguity, ron-completed triplets counting as open, etc.).
- **Score chart** – the full dealer / non-dealer lookup table, limit hands and fu reference, generated from the same formulas.
- **Yaku menus** – hover *Common Yaku* / *Rare Yaku* (plus yakuman) for han values and descriptions.
- **Settings** – kiriage mangan, honba, hide fu or hide han (count them yourself), show/hide yaku before answering.
- **Keyboard** – `Enter` checks, `Enter` again deals the next hand, `Esc` closes dialogs. Stats persist in `localStorage`.

## Play Trainer

A full 4-player game (hanchan or East-only) with random walls, dora, red fives, calls, riichi, kans, furiten, double ron, exhaustive draws and round progression. The three opponents play the engine's top-rated action.

Every decision you make – discard, chi / pon / kan / skip, tsumo / ron, kan on your own turn – is graded by **[akochan](https://github.com/critter-mj/akochan)**, an open-source mahjong AI that runs on the server (`deploy/install-akochan.sh`):

- akochan estimates the **expected placement points** of every legal option. A play is a mistake when it loses more than a threshold (default 0.05 pt, mjai-reviewer's default) against akochan's best.
- Opening your hand with **no possible yaku** is always wrong. **Riichi** is only wrong on a dead wait (no winning tiles left); dama is never graded and discards use the better of riichi / dama.
- Mistakes list verifiable differences (shanten, tile acceptance, waits, furiten, safety, dora) and akochan's evaluation table. You can retry the decision or keep your play.
- If akochan is unreachable, decisions are not graded rather than guessed.

The opponents are played by this project's own heuristic engine (`js/engine.js`), which is also used for the factual comparisons. akochan is free for personal research and education only – keep the site private (see `deploy/DEPLOY.md`).

For local development, `python server/akochan_server.py --static .` serves the site and the API on one port (set `AKOCHAN_DIR` or `AKOCHAN_CMD`).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and dialogs |
| `css/style.css` | Table, tiles, panels and chart styling |
| `js/tiles.js` | Tile definitions and SVG tile faces |
| `js/scoring.js` | Basic points, limits, payments, chart generator |
| `js/hand.js` | Hand generation, decomposition, fu counting, yaku detection |
| `js/yaku.js` | Yaku reference lists for the menus |
| `js/app.js` | Rendering and quiz flow |
| `play.html`, `css/play.css` | Play Trainer page and styles |
| `js/engine.js` | Heuristic engine: shanten, acceptance, danger – drives the opponents and the factual comparisons |
| `js/game.js` | Table state machine: wall, turns, calls, riichi, wins, draws, NPC play |
| `js/play.js` | Play Trainer rendering, decision prompts and review panel |
| `js/akochan.js` | Streams the game to akochan, maps its answers to actions, grades by EV loss |
| `server/akochan_server.py` | HTTP bridge that runs one akochan process per game (stdlib Python) |
| `server/smoke_test.py` | Checks that the bridge and akochan answer |

## Rules assumptions

- Double wind pair = 4 fu; open hand with no fu = 30 fu; chiitoitsu = 25 fu; pinfu tsumo = 20 fu.
- Multiple yakuman are scored as a single yakuman (the chart only goes to "13+ han").
- Chanta / junchan require at least one sequence.
- Play Trainer: open tanyao allowed, red fives (one per suit), kan dora revealed immediately, double ron allowed (triple ron is an abortive draw), no chankan, no nagashi mangan, no kyuushu / four-wind / four-riichi / four-kan aborts.
