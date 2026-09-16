# Riichi Mahjong Score Learner

A single-page web app for practising Riichi Mahjong scoring, styled after a Mahjong Soul table.

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

## Rules assumptions

- Double wind pair = 4 fu; open hand with no fu = 30 fu; chiitoitsu = 25 fu; pinfu tsumo = 20 fu.
- Multiple yakuman are scored as a single yakuman (the chart only goes to "13+ han").
- Chanta / junchan require at least one sequence.
