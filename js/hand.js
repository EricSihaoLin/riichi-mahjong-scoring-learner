/* Random winning-hand generation + evaluation (decomposition, fu, yaku). */
(function (global) {
  const T = global.Tiles;
  const S = global.Scoring;
  const ALL = T.ALL_TILES;

  const rand = n => Math.floor(Math.random() * n);
  const chance = p => Math.random() < p;
  const pick = arr => arr[rand(arr.length)];
  function weightedPick(pairs) { // [[value, weight], ...]
    let total = pairs.reduce((a, p) => a + p[1], 0), r = Math.random() * total;
    for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
    return pairs[pairs.length - 1][0];
  }

  /* ---------------- Decomposition of the concealed part ---------------- */
  function countsOf(tiles) { const c = new Array(34).fill(0); for (const t of tiles) c[T.tileIndex(t)]++; return c; }

  function extractSets(counts, start, sets, cb) {
    let i = start;
    while (i < 34 && counts[i] === 0) i++;
    if (i === 34) { cb(sets.slice()); return; }
    if (counts[i] >= 3) {
      counts[i] -= 3; sets.push({ type: 'pon', tile: ALL[i] });
      extractSets(counts, i, sets, cb);
      sets.pop(); counts[i] += 3;
    }
    if (i < 27 && (i % 9) <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--; sets.push({ type: 'chi', tile: ALL[i] });
      extractSets(counts, i, sets, cb);
      sets.pop(); counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
  }
  function decompositions(tiles) {
    const counts = countsOf(tiles), results = [];
    for (let i = 0; i < 34; i++) if (counts[i] >= 2) {
      counts[i] -= 2;
      extractSets(counts, 0, [], sets => results.push({ pair: ALL[i], sets }));
      counts[i] += 2;
    }
    return results;
  }
  function isChiitoi(tiles) {
    if (tiles.length !== 14) return false;
    const c = countsOf(tiles); return c.every(x => x === 0 || x === 2) && c.filter(x => x === 2).length === 7;
  }

  /* ---------------- Fu + yaku for one interpretation ---------------- */
  function setTiles(s) {
    if (s.type === 'chi') { const n = T.numOf(s.tile), su = T.suitOf(s.tile); return [n + su, (n + 1) + su, (n + 2) + su]; }
    return new Array(s.type === 'kan' ? 4 : 3).fill(s.tile);
  }
  function pairFu(t, ctx) {
    let f = 0; if (T.isDragon(t)) f += 2; if (t === ctx.seatWind) f += 2; if (t === ctx.roundWind) f += 2; return f;
  }
  const setIsClosed = (s, ctx) => !s.open && !(s.containsWin && !ctx.tsumo);

  function scoreInterpretation(sets, pair, wait, ctx) {
    // sets: [{type, tile, open, containsWin}], wait: 'ryanmen'|'penchan'|'kanchan'|'shanpon'|'tanki'
    const closed = ctx.closed;
    const pons = sets.filter(s => s.type !== 'chi'), chis = sets.filter(s => s.type === 'chi');
    const kans = sets.filter(s => s.type === 'kan');
    const closedPons = pons.filter(s => setIsClosed(s, ctx));
    const all = [].concat(...sets.map(setTiles), [pair, pair]);
    const honors = all.filter(T.isHonor), suits = new Set(all.filter(t => !T.isHonor(t)).map(T.suitOf));
    const yaku = [];

    /* --- yakuman --- */
    const dragonPons = pons.filter(s => T.isDragon(s.tile)).length, windPons = pons.filter(s => T.isWind(s.tile)).length;
    if (dragonPons === 3) yaku.push({ name: 'Daisangen', jp: '大三元', han: 13 });
    if (closedPons.length === 4) yaku.push({ name: wait === 'tanki' ? 'Suuankou Tanki' : 'Suuankou', jp: '四暗刻', han: 13 });
    if (windPons === 4) yaku.push({ name: 'Daisuushii', jp: '大四喜', han: 13 });
    else if (windPons === 3 && T.isWind(pair)) yaku.push({ name: 'Shousuushii', jp: '小四喜', han: 13 });
    if (all.every(T.isHonor)) yaku.push({ name: 'Tsuuiisou', jp: '字一色', han: 13 });
    if (all.every(T.isTerminal)) yaku.push({ name: 'Chinroutou', jp: '清老頭', han: 13 });
    if (kans.length === 4) yaku.push({ name: 'Suukantsu', jp: '四槓子', han: 13 });
    if (all.every(t => ['2s', '3s', '4s', '6s', '8s', 'G'].includes(t))) yaku.push({ name: 'Ryuuiisou', jp: '緑一色', han: 13 });
    if (closed && honors.length === 0 && suits.size === 1) {
      const c = {}; for (const t of all) c[T.numOf(t)] = (c[T.numOf(t)] || 0) + 1;
      if (c[1] >= 3 && c[9] >= 3 && [2, 3, 4, 5, 6, 7, 8].every(n => c[n] >= 1)) yaku.push({ name: 'Chuuren Poutou', jp: '九蓮宝燈', han: 13 });
    }

    /* --- fu --- */
    const fuDetails = [{ label: 'Base', fu: 20 }];
    let fu = 20;
    const pinfu = closed && chis.length === 4 && wait === 'ryanmen' && pairFu(pair, ctx) === 0;
    if (closed && !ctx.tsumo) { fu += 10; fuDetails.push({ label: 'Closed ron (menzen kafu)', fu: 10 }); }
    if (ctx.tsumo && !pinfu) { fu += 2; fuDetails.push({ label: 'Tsumo', fu: 2 }); }
    for (const s of pons) {
      let v = 2; const cl = setIsClosed(s, ctx), th = T.isTermOrHonor(s.tile);
      if (cl) v *= 2; if (th) v *= 2; if (s.type === 'kan') v *= 4;
      fu += v;
      fuDetails.push({ label: `${cl ? 'Closed' : 'Open'} ${s.type === 'kan' ? 'kan' : 'triplet'} of ${T.tileName(s.tile)}${th ? ' (terminal/honor)' : ' (simple)'}${s.containsWin && !ctx.tsumo ? ' – completed by ron, counts as open' : ''}`, fu: v, tiles: [s.tile] });
    }
    const pf = pairFu(pair, ctx);
    if (pf) { fu += pf; fuDetails.push({ label: `Yakuhai pair (${T.tileName(pair)})${pf === 4 ? ' – seat + round wind' : ''}`, fu: pf, tiles: [pair] }); }
    else fuDetails.push({ label: `Pair of ${T.tileName(pair)} – not yakuhai`, fu: 0, tiles: [pair] });
    const WAIT_DESC = { ryanmen: 'two-sided', penchan: 'edge', kanchan: 'middle', shanpon: 'double-pair', tanki: 'single-tile' };
    const winSet = sets.find(s => s.containsWin);
    const waitTiles = winSet ? setTiles(winSet) : [pair];
    const waitFu = (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') ? 2 : 0;
    fuDetails.push({ label: `${wait[0].toUpperCase() + wait.slice(1)} (${WAIT_DESC[wait]}) wait on ${T.tileName(ctx.winTile)}`, fu: waitFu, tiles: waitTiles, win: true });
    fu += waitFu;
    if (pinfu) fuDetails.push({ label: ctx.tsumo ? 'Pinfu tsumo: fixed at 20 fu' : 'Pinfu ron: 30 fu', fu: 0 });
    if (!closed && fu === 20) { fu = 30; fuDetails.push({ label: 'Open hand with no fu → 30 fu', fu: 10 }); }
    const rounded = Math.ceil(fu / 10) * 10;
    if (rounded !== fu) fuDetails.push({ label: `Round up ${fu} → ${rounded}`, fu: 0 });
    fu = rounded;

    if (yaku.length) return { fu, fuDetails, yaku, han: 13, yakuman: true, wait, sets, pair };

    /* --- regular yaku --- */
    const h = (c, o) => (closed ? c : o);
    if (closed && ctx.tsumo) yaku.push({ name: 'Menzen Tsumo', jp: '門前清自摸和', han: 1 });
    if (pinfu) yaku.push({ name: 'Pinfu', jp: '平和', han: 1 });
    if (all.every(T.isSimple)) yaku.push({ name: 'Tanyao', jp: '断幺九', han: 1 });
    if (closed) {
      const cnt = {}; for (const c of chis) cnt[c.tile] = (cnt[c.tile] || 0) + 1;
      const peiko = Object.values(cnt).reduce((a, v) => a + Math.floor(v / 2), 0);
      if (peiko === 2) yaku.push({ name: 'Ryanpeikou', jp: '二盃口', han: 3 });
      else if (peiko === 1) yaku.push({ name: 'Iipeikou', jp: '一盃口', han: 1 });
    }
    for (const s of pons) {
      if (T.isDragon(s.tile)) yaku.push({ name: `Yakuhai (${T.tileName(s.tile)})`, jp: '役牌', han: 1 });
      if (s.tile === ctx.seatWind) yaku.push({ name: `Yakuhai (seat wind ${T.WIND_NAME[s.tile]})`, jp: '自風', han: 1 });
      if (s.tile === ctx.roundWind) yaku.push({ name: `Yakuhai (round wind ${T.WIND_NAME[s.tile]})`, jp: '場風', han: 1 });
    }
    for (let n = 1; n <= 7; n++) if (['m', 'p', 's'].every(su => chis.some(c => c.tile === n + su))) { yaku.push({ name: 'Sanshoku Doujun', jp: '三色同順', han: h(2, 1) }); break; }
    for (const su of ['m', 'p', 's']) if ([1, 4, 7].every(n => chis.some(c => c.tile === n + su))) { yaku.push({ name: 'Ittsu', jp: '一気通貫', han: h(2, 1) }); break; }
    if (pons.length === 4) yaku.push({ name: 'Toitoi', jp: '対々和', han: 2 });
    if (closedPons.length === 3) yaku.push({ name: 'Sanankou', jp: '三暗刻', han: 2 });
    if (kans.length === 3) yaku.push({ name: 'Sankantsu', jp: '三槓子', han: 2 });
    for (let n = 1; n <= 9; n++) if (['m', 'p', 's'].every(su => pons.some(p => p.tile === n + su))) { yaku.push({ name: 'Sanshoku Doukou', jp: '三色同刻', han: 2 }); break; }
    const allTH = all.every(T.isTermOrHonor);
    if (allTH) yaku.push({ name: 'Honroutou', jp: '混老頭', han: 2 });
    if (dragonPons === 2 && T.isDragon(pair)) yaku.push({ name: 'Shousangen', jp: '小三元', han: 2 });
    const setHasTH = s => s.type === 'chi' ? (T.numOf(s.tile) === 1 || T.numOf(s.tile) === 7) : T.isTermOrHonor(s.tile);
    if (chis.length >= 1 && sets.every(setHasTH) && T.isTermOrHonor(pair)) {
      if (honors.length) yaku.push({ name: 'Chanta', jp: '混全帯幺九', han: h(2, 1) });
      else yaku.push({ name: 'Junchan', jp: '純全帯幺九', han: h(3, 2) });
    }
    if (suits.size === 1) {
      if (honors.length) yaku.push({ name: 'Honitsu', jp: '混一色', han: h(3, 2) });
      else yaku.push({ name: 'Chinitsu', jp: '清一色', han: h(6, 5) });
    }
    const han = yaku.reduce((a, y) => a + y.han, 0);
    return { fu, fuDetails, yaku, han, yakuman: false, wait, sets, pair };
  }

  function scoreChiitoi(tiles, ctx) {
    const yaku = [];
    const distinct = [...new Set(tiles)];
    if (tiles.every(T.isHonor)) return { fu: 25, fuDetails: [{ label: 'Chiitoitsu: fixed 25 fu', fu: 25 }], yaku: [{ name: 'Tsuuiisou', jp: '字一色', han: 13 }], han: 13, yakuman: true, wait: 'tanki', chiitoi: true, pairs: distinct };
    yaku.push({ name: 'Chiitoitsu', jp: '七対子', han: 2 });
    if (ctx.tsumo) yaku.push({ name: 'Menzen Tsumo', jp: '門前清自摸和', han: 1 });
    if (tiles.every(T.isSimple)) yaku.push({ name: 'Tanyao', jp: '断幺九', han: 1 });
    if (tiles.every(T.isTermOrHonor)) yaku.push({ name: 'Honroutou', jp: '混老頭', han: 2 });
    const suits = new Set(tiles.filter(t => !T.isHonor(t)).map(T.suitOf)), honors = tiles.some(T.isHonor);
    if (suits.size === 1) yaku.push(honors ? { name: 'Honitsu', jp: '混一色', han: 3 } : { name: 'Chinitsu', jp: '清一色', han: 6 });
    return { fu: 25, fuDetails: [{ label: 'Chiitoitsu: fixed 25 fu (nothing else is counted)', fu: 25 }, { label: `Tanki wait on ${T.tileName(ctx.winTile)} – already included`, fu: 0, tiles: [ctx.winTile] }], yaku, han: yaku.reduce((a, y) => a + y.han, 0), yakuman: false, wait: 'tanki', chiitoi: true, pairs: distinct };
  }

  /* Evaluate a hand: picks the best interpretation.
     hand = { concealed: [14 tiles incl. winTile], winTile, melds: [{type, tile, open}], tsumo, seatWind, roundWind } */
  function evaluate(hand) {
    const ctx = { tsumo: hand.tsumo, seatWind: hand.seatWind, roundWind: hand.roundWind, closed: hand.melds.every(m => !m.open), winTile: hand.winTile };
    const candidates = [];
    if (hand.melds.length === 0 && isChiitoi(hand.concealed)) candidates.push(scoreChiitoi(hand.concealed, ctx));
    for (const d of decompositions(hand.concealed)) {
      const fixed = hand.melds.map(m => ({ type: m.type, tile: m.tile, open: !!m.open, containsWin: false }));
      // choose which concealed set (or the pair) the winning tile completes
      d.sets.forEach((s, idx) => {
        const tiles = setTiles(s), pos = tiles.indexOf(hand.winTile);
        if (pos < 0) return;
        let wait;
        if (s.type === 'chi') {
          const n = T.numOf(s.tile);
          wait = pos === 1 ? 'kanchan' : (pos === 0 && n === 7) || (pos === 2 && n === 1) ? 'penchan' : 'ryanmen';
        } else wait = 'shanpon';
        const sets = d.sets.map((x, j) => ({ type: x.type, tile: x.tile, open: false, containsWin: j === idx })).concat(fixed);
        candidates.push(scoreInterpretation(sets, d.pair, wait, ctx));
      });
      if (d.pair === hand.winTile) {
        const sets = d.sets.map(x => ({ type: x.type, tile: x.tile, open: false, containsWin: false })).concat(fixed);
        candidates.push(scoreInterpretation(sets, d.pair, 'tanki', ctx));
      }
    }
    if (!candidates.length) return null;
    const key = c => { const bp = S.basicPoints(c.han, c.fu); return [bp.base, c.han, c.fu]; };
    candidates.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]; return 0; });
    return candidates[0];
  }

  /* ---------------- Random structure generation ---------------- */
  function genStructure(p, used) {
    const take = (t, n) => { if ((used[t] || 0) + n > 4) return false; used[t] = (used[t] || 0) + n; return true; };
    const flush = chance(p.flushProb) ? pick(['m', 'p', 's']) : null;
    const flushHonors = chance(0.6);
    const pickSuit = () => flush || pick(['m', 'p', 's']);
    const pickTile = () => {
      if (chance(flush ? (flushHonors ? 0.25 : 0) : p.honorProb)) return pick(T.HONORS);
      return (1 + rand(9)) + pickSuit();
    };
    const melds = [];
    for (let i = 0; i < 4; i++) {
      let ok = false;
      for (let tries = 0; tries < 20 && !ok; tries++) {
        const isChi = chance(p.chiProb);
        if (isChi) {
          const su = pickSuit(), n = 1 + rand(7), tiles = [n + su, (n + 1) + su, (n + 2) + su];
          if (tiles.every(t => (used[t] || 0) < 4)) { tiles.forEach(t => take(t, 1)); melds.push({ type: 'chi', tile: n + su, open: p.handOpen && chance(p.openProb) }); ok = true; }
        } else {
          const t = pickTile(), kan = chance(p.kanProb);
          if (take(t, kan ? 4 : 3)) { melds.push({ type: kan ? 'kan' : 'pon', tile: t, open: p.handOpen && chance(p.openProb) }); ok = true; }
        }
      }
      if (!ok) return null;
    }
    let pair = null;
    for (let tries = 0; tries < 20 && !pair; tries++) {
      const t = pickTile();
      if (p.noYakuhaiPair && (T.isDragon(t) || t === p.seatWind || t === p.roundWind)) continue;
      if (take(t, 2)) pair = t;
    }
    if (!pair) return null;
    return { melds, pair };
  }

  function genChiitoi(used) {
    const tiles = [];
    while (tiles.length < 7) {
      const t = pick(ALL);
      if (tiles.includes(t) || (used[t] || 0) + 2 > 4) continue;
      tiles.push(t); used[t] = (used[t] || 0) + 2;
    }
    return tiles;
  }

  /* Build a raw hand from a structure, choosing the winning tile. Returns {concealed, winTile, melds} */
  function buildHand(struct, opts) {
    const closedNonKan = struct.melds.filter(m => !m.open && m.type !== 'kan');
    const fixed = struct.melds.filter(m => m.open || m.type === 'kan');
    const winCandidates = closedNonKan.map((m, i) => ({ kind: 'set', m })).concat([{ kind: 'pair' }]);
    if (opts.ryanmenOnly) {
      const c = winCandidates.filter(w => w.kind === 'set' && w.m.type === 'chi');
      if (!c.length) return null;
      winCandidates.length = 0; winCandidates.push(...c);
    }
    const w = pick(winCandidates);
    let winTile;
    if (w.kind === 'pair') winTile = struct.pair;
    else if (w.m.type === 'chi') {
      const n = T.numOf(w.m.tile), su = T.suitOf(w.m.tile);
      let idx = rand(3);
      if (opts.ryanmenOnly) idx = n === 1 ? 0 : n === 7 ? 2 : pick([0, 2]);
      winTile = (n + idx) + su;
    } else winTile = w.m.tile;
    const concealed = [].concat(...closedNonKan.map(setTiles), [struct.pair, struct.pair]);
    return { concealed, winTile, melds: fixed };
  }

  /* ---------------- Dora / filler assignment ---------------- */
  function handTileCounts(hand) {
    const c = {};
    const add = t => { c[t] = (c[t] || 0) + 1; };
    hand.concealed.forEach(add);
    hand.melds.forEach(m => setTiles(m).forEach(add));
    return c;
  }
  /* find distinct tiles whose hand-counts sum to target, at most maxN of them */
  function findDoraSet(counts, target, maxN, used) {
    const tiles = Object.keys(counts).filter(t => (used[T.prevTile(t)] || 0) < 4).sort(() => Math.random() - 0.5);
    let found = null;
    (function dfs(i, sum, chosen) {
      if (found) return;
      if (sum === target && chosen.length <= maxN) { found = chosen.slice(); return; }
      if (sum > target || chosen.length >= maxN || i >= tiles.length) return;
      chosen.push(tiles[i]); dfs(i + 1, sum + counts[tiles[i]], chosen); chosen.pop();
      dfs(i + 1, sum, chosen);
    })(0, 0, []);
    return found;
  }
  function fillerIndicators(counts, nSlots, doraTiles, used) {
    const ind = doraTiles.map(t => T.prevTile(t));
    ind.forEach(t => { used[t] = (used[t] || 0) + 1; });
    while (ind.length < nSlots) {
      const t = pick(ALL);
      if (counts[T.nextTile(t)] || (used[t] || 0) >= 4) continue;
      used[t] = (used[t] || 0) + 1; ind.push(t);
    }
    return ind.sort(() => Math.random() - 0.5);
  }

  function assignFillers(hand, ev, targetHan, used) {
    const R = targetHan - ev.han;
    if (R < 0 || R > 10) return null;
    const closed = hand.melds.every(m => !m.open);
    const hasYaku = ev.han > 0;
    if (!hasYaku && !closed) return null;
    if (!hasYaku && closed && R === 0) return null; // needs riichi
    const counts = handTileCounts(hand);
    const kans = hand.melds.filter(m => m.type === 'kan').length;
    const nSlots = Math.min(5, 1 + kans);
    const akaMax = ['m', 'p', 's'].filter(su => counts['5' + su]).length;
    for (let attempt = 0; attempt < 60; attempt++) {
      const u = Object.assign({}, used);
      const extra = [];
      let rem = R;
      const riichi = closed && rem >= 1 && (!hasYaku || chance(0.65));
      if (riichi) { rem--; extra.push({ name: 'Riichi', jp: '立直', han: 1 }); }
      if (riichi && rem >= 1 && chance(0.25)) { rem--; extra.push({ name: 'Ippatsu', jp: '一発', han: 1 }); }
      if (rem >= 1 && chance(0.06)) {
        rem--;
        if (hand.tsumo && kans) extra.push({ name: 'Rinshan Kaihou', jp: '嶺上開花', han: 1 });
        else extra.push(hand.tsumo ? { name: 'Haitei Raoyue', jp: '海底摸月', han: 1 } : { name: 'Houtei Raoyui', jp: '河底撈魚', han: 1 });
      }
      const aka = Math.min(rem, akaMax, rand(akaMax + 1)); rem -= aka;
      const ura = riichi ? rand(rem + 1) : 0; rem -= ura;
      const dora = rem;
      const doraSet = findDoraSet(counts, dora, nSlots, u);
      if (!doraSet) continue;
      const doraInd = fillerIndicators(counts, nSlots, doraSet, u);
      let uraInd = null;
      if (riichi) {
        const uraSet = findDoraSet(counts, ura, nSlots, u);
        if (!uraSet) continue;
        uraInd = fillerIndicators(counts, nSlots, uraSet, u);
      }
      const akaSuits = ['m', 'p', 's'].filter(su => counts['5' + su]).sort(() => Math.random() - 0.5).slice(0, aka);
      if (dora) extra.push({ name: `Dora ${dora}`, jp: 'ドラ', han: dora });
      if (aka) extra.push({ name: `Red dora ${aka}`, jp: '赤ドラ', han: aka });
      if (ura) extra.push({ name: `Ura dora ${ura}`, jp: '裏ドラ', han: ura });
      return { extra, doraInd, uraInd, akaSuits, riichi, used: u };
    }
    return null;
  }

  /* ---------------- Problem generation ---------------- */
  const HAN_WEIGHTS = [[1, 3], [2, 4], [3, 4], [4, 4], [5, 2], [6, 1.5], [7, 1], [8, 1], [9, .5], [10, .5], [11, .7], [12, .4], [13, .8]];
  const FU_WEIGHTS = [[20, 1.5], [25, 1.5], [30, 5], [40, 4], [50, 3], [60, 2], [70, 1.5], [80, 1], [90, .7], [100, .5], [110, .4]];

  function paramsFor(fu, tsumo) {
    const p = { flushProb: 0.15, honorProb: 0.25, kanProb: 0.05, chiProb: 0.5, openProb: 0.6, handOpen: chance(0.4), noYakuhaiPair: false };
    if (fu === null) { p.kanProb = 0.1; return p; }
    if (fu === 20) { p.chiProb = 1; p.handOpen = false; p.noYakuhaiPair = true; }
    else if (fu === 30) { p.chiProb = chance(0.5) ? 0.9 : 0.6; }
    else if (fu === 40) { p.chiProb = 0.55; p.kanProb = 0.08; }
    else if (fu === 50 || fu === 60) { p.chiProb = 0.35; p.kanProb = 0.2; p.honorProb = 0.35; }
    else { p.chiProb = 0.15; p.kanProb = 0.55; p.honorProb = 0.5; p.handOpen = chance(0.25); }
    return p;
  }

  function tryGenerate(target, ctx) {
    const used = {};
    let hand;
    if (target.fu === 25) {
      const pairs = genChiitoi(used);
      const winTile = pick(pairs);
      hand = { concealed: [].concat(...pairs.map(t => [t, t])), winTile, melds: [] };
    } else {
      const p = paramsFor(target.fu, ctx.tsumo);
      Object.assign(p, { seatWind: ctx.seatWind, roundWind: ctx.roundWind });
      const st = genStructure(p, used);
      if (!st) return null;
      hand = buildHand(st, { ryanmenOnly: target.fu === 20 });
      if (!hand) return null;
    }
    Object.assign(hand, { tsumo: ctx.tsumo, seatWind: ctx.seatWind, roundWind: ctx.roundWind });
    const ev = evaluate(hand);
    if (!ev) return null;
    if (ev.fu > 110) return null; // beyond the chart (and always a limit hand anyway)
    if (ev.yakuman) {
      if (!(target.han === 13 || (target.han === null && chance(0.1)))) return null;
      const f = assignFillers(hand, { han: 13 }, 13, used) || { extra: [], doraInd: fillerIndicators(handTileCounts(hand), 1, [], used), uraInd: null, akaSuits: [], riichi: false, used };
      return { hand, ev, fillers: f };
    }
    if (target.fu !== null && ev.fu !== target.fu) return null;
    if (target.han !== null && ev.han > target.han) return null;
    const wantHan = target.han !== null ? target.han : Math.min(13, ev.han + rand(3) + (ev.han === 0 ? 1 : 0));
    const fillers = assignFillers(hand, ev, wantHan, used);
    if (!fillers) return null;
    return { hand, ev, fillers };
  }

  function generateProblem(settings = {}) {
    const dealer = chance(0.5), tsumo = chance(0.5);
    const seatWind = dealer ? 'E' : pick(['S', 'W', 'N']);
    const roundWind = chance(0.6) ? 'E' : 'S';
    const ctx = { dealer, tsumo, seatWind, roundWind };
    const han = weightedPick(HAN_WEIGHTS);
    let fu = han >= 5 ? null : weightedPick(FU_WEIGHTS.filter(([f]) => S.comboPossible(han, f, tsumo)));
    let result = null;
    for (let i = 0; i < 4000 && !result; i++) result = tryGenerate({ han, fu }, ctx);
    for (let i = 0; i < 4000 && !result; i++) result = tryGenerate({ han, fu: null }, ctx);
    for (let i = 0; i < 4000 && !result; i++) result = tryGenerate({ han: null, fu: null }, ctx);
    if (!result) throw new Error('Could not generate a hand');
    return finalize(result, ctx, settings);
  }

  function finalize({ hand, ev, fillers }, ctx, settings) {
    const yaku = ev.yakuman ? ev.yaku.slice() : ev.yaku.concat(fillers.extra);
    const han = ev.yakuman ? 13 : yaku.reduce((a, y) => a + y.han, 0);
    const honba = settings.honba ? rand(4) : 0;
    const payments = S.computePayments({ han, fu: ev.fu, dealer: ctx.dealer, tsumo: ctx.tsumo, honba, kiriage: !!settings.kiriage });

    // Mark red fives
    const akaLeft = new Set(fillers.akaSuits);
    const mark = t => { const o = { t, aka: false }; if (T.numOf(t) === 5 && akaLeft.has(T.suitOf(t))) { o.aka = true; akaLeft.delete(T.suitOf(t)); } return o; };
    const conc = hand.concealed.slice();
    conc.splice(conc.indexOf(hand.winTile), 1);
    const concealed = T.sortTiles(conc).map(mark);
    const winTile = mark(hand.winTile);
    const melds = hand.melds.map(m => {
      const tiles = setTiles(m).map(mark);
      const from = m.type === 'chi' ? 'kamicha' : pick(['kamicha', 'toimen', 'shimocha']);
      let calledIdx = m.type === 'chi' ? rand(3) : 0;
      return { type: m.type, tile: m.tile, open: !!m.open, tiles, from, calledIdx };
    });
    return {
      dealer: ctx.dealer, tsumo: ctx.tsumo, seatWind: ctx.seatWind, roundWind: ctx.roundWind, honba,
      concealed, winTile, melds, closed: hand.melds.every(m => !m.open),
      doraIndicators: fillers.doraInd, uraIndicators: fillers.uraInd, riichi: fillers.riichi,
      fu: ev.fu, fuDetails: ev.fuDetails, yaku, han, yakuman: ev.yakuman, wait: ev.wait,
      payments, used: fillers.used,
    };
  }

  global.Hand = { generateProblem, evaluate, decompositions, setTiles };
})(window);
