/* Play Trainer table: wall, turns, calls, riichi, furiten, wins, draws and round progression.
   Seat 0 is the human. Play passes 0 → 1 (shimocha, right) → 2 (toimen) → 3 (kamicha, left). */
(function (global) {
  const T = global.Tiles, H = global.Hand, S = global.Scoring, E = global.Engine;
  const ALL = T.ALL_TILES, ti = t => T.tileIndex(t);
  const rand = n => Math.floor(Math.random() * n);
  const NAMES = ['You', 'Shimocha', 'Toimen', 'Kamicha'];

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function makeWall() {
    const tiles = [];
    let id = 0;
    for (const t of ALL) for (let k = 0; k < 4; k++) tiles.push({ t, aka: k === 0 && T.numOf(t) === 5, id: id++ });
    return shuffle(tiles);
  }
  const sortHand = h => h.sort((a, b) => ti(a.t) - ti(b.t) || b.aka - a.aka);
  const kinds = tiles => tiles.map(x => x.t);

  const dealerOf = st => (st.startDealer + st.roundIndex) % 4;
  const roundWindOf = st => T.WINDS[Math.floor(st.roundIndex / 4) % 4];
  const seatWindOf = (st, p) => T.WINDS[(p - dealerOf(st) + 4) % 4];
  const indicators = st => st.dead.slice(0, st.doraCount);
  const uraIndicators = st => st.dead.slice(5, 5 + st.doraCount);

  /* Every action is also logged as an mjai event (st.mjai) so an external engine such as akochan can follow the game. */
  const MJ_HONOR = { E: 'E', S: 'S', W: 'W', N: 'N', Wh: 'P', G: 'F', R: 'C' };
  const mj = x => (MJ_HONOR[x.t] || x.t) + (x.aka ? 'r' : '');
  const log = (st, ev) => { st.mjai.push(ev); };
  function revealDora(st) {
    if (st.doraCount >= 5) return;
    st.doraCount++;
    log(st, { type: 'dora', dora_marker: mj(st.dead[st.doraCount - 1]) });
  }

  function newGame(mode = 'hanchan') {
    const st = { mode, startDealer: rand(4), roundIndex: 0, honba: 0, sticks: 0, scores: [25000, 25000, 25000, 25000], handNo: 0 };
    // akochan also needs the game length (kyoku_first: 4 = hanchan, 0 = East only) and whether red fives are used
    st.mjai = [{ type: 'start_game', names: NAMES.slice(), kyoku_first: mode === 'tonpuu' ? 0 : 4, aka_flag: true }];
    startHand(st);
    return st;
  }

  function startHand(st) {
    const wall = makeWall();
    st.dead = wall.splice(0, 14); // 0-4 dora indicators, 5-9 ura, 10-13 rinshan
    st.wall = wall;
    Object.assign(st, { doraCount: 1, kanCount: 0, callsMade: 0, seq: 0, lastDiscard: null, result: null, rinshan: false, afterCall: false });
    st.players = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], discards: [], riichi: false, doubleRiichi: false, ippatsu: false, riichiPending: false, riichiSeq: -1, furitenTemp: false, furitenRiichi: false, kuikae: [], drawn: null }));
    const d = dealerOf(st);
    for (let r = 0; r < 13; r++) for (let k = 0; k < 4; k++) st.players[(d + k) % 4].hand.push(st.wall.pop());
    st.players.forEach(pl => sortHand(pl.hand));
    st.turn = d;
    st.phase = 'draw';
    st.handNo++;
    log(st, {
      type: 'start_kyoku', bakaze: roundWindOf(st), kyoku: (st.roundIndex % 4) + 1, honba: st.honba, kyotaku: st.sticks, oya: d,
      dora_marker: mj(st.dead[0]), scores: st.scores.slice(), tehais: st.players.map(pl => pl.hand.map(mj)),
    });
  }

  /* ---------------- drawing ---------------- */
  function draw(st) {
    const p = st.turn, pl = st.players[p];
    if (!st.rinshan && st.wall.length === 0) { exhaustiveDraw(st); return null; }
    let tile;
    if (st.rinshan) { tile = st.dead.splice(10, 1)[0]; st.dead.push(st.wall.shift()); } // dead wall stays at 14
    else tile = st.wall.pop();
    pl.hand.push(tile);
    pl.drawn = tile;
    log(st, { type: 'tsumo', actor: p, pai: mj(tile) });
    pl.furitenTemp = false;
    pl.kuikae = [];
    st.phase = 'self';
    st.afterCall = false;
    return tile;
  }

  /* ---------------- win evaluation ---------------- */
  const Y = (name, jp, han) => ({ name, jp, han });
  function winInfo(st, p, winTile, how) {
    const pl = st.players[p];
    const conc = how.tsumo ? pl.hand.slice() : pl.hand.concat([winTile]);
    const c = E.counts(conc);
    if (E.shanten(c, pl.melds.length) !== -1) return null;
    const seatWind = seatWindOf(st, p), roundWind = roundWindOf(st);
    let ev;
    if (!pl.melds.length && E.shantenKokushi(c) === -1) ev = { yakuman: true, han: 13, fu: 30, fuDetails: [], yaku: [Y('Kokushi Musou', '国士無双', 13)] };
    else ev = H.evaluate({ concealed: kinds(conc), winTile: winTile.t, melds: pl.melds.map(m => ({ type: m.type, tile: m.base, open: m.open })), tsumo: !!how.tsumo, seatWind, roundWind });
    if (!ev) return null;
    const firstDraw = how.tsumo && !how.rinshan && st.callsMade === 0 && pl.discards.length === 0;
    let yaku, han, yakuman = false;
    if (firstDraw) { yaku = [p === dealerOf(st) ? Y('Tenhou', '天和', 13) : Y('Chiihou', '地和', 13)]; han = 13; yakuman = true; }
    else if (ev.yakuman) { yaku = ev.yaku.slice(); han = 13; yakuman = true; }
    else {
      const sit = [];
      if (pl.riichi) sit.push(pl.doubleRiichi ? Y('Double Riichi', 'ダブル立直', 2) : Y('Riichi', '立直', 1));
      if (pl.riichi && pl.ippatsu) sit.push(Y('Ippatsu', '一発', 1));
      if (how.rinshan) sit.push(Y('Rinshan Kaihou', '嶺上開花', 1));
      else if (how.tsumo && st.wall.length === 0) sit.push(Y('Haitei Raoyue', '海底摸月', 1));
      if (!how.tsumo && st.wall.length === 0) sit.push(Y('Houtei Raoyui', '河底撈魚', 1));
      if (!ev.han && !sit.length) return null; // complete shape but no yaku
      const all = conc.concat(...pl.melds.map(m => m.tiles));
      const cnt = k => all.filter(x => x.t === k).length;
      const dora = indicators(st).reduce((a, x) => a + cnt(T.nextTile(x.t)), 0);
      const aka = all.filter(x => x.aka).length;
      const ura = pl.riichi ? uraIndicators(st).reduce((a, x) => a + cnt(T.nextTile(x.t)), 0) : 0;
      yaku = ev.yaku.concat(sit);
      if (dora) yaku.push(Y(`Dora ${dora}`, 'ドラ', dora));
      if (aka) yaku.push(Y(`Red dora ${aka}`, '赤ドラ', aka));
      if (ura) yaku.push(Y(`Ura dora ${ura}`, '裏ドラ', ura));
      han = yaku.reduce((a, y) => a + y.han, 0);
    }
    const payments = S.computePayments({ han, fu: ev.fu, dealer: p === dealerOf(st), tsumo: !!how.tsumo, honba: st.honba });
    return { p, han, fu: ev.fu, yaku, yakuman, fuDetails: ev.fuDetails, payments, tsumo: !!how.tsumo, winTile, concealed: conc.filter(x => x !== winTile), melds: pl.melds, riichi: pl.riichi };
  }

  function waitsOfPlayer(pl) { return E.waitsOf(E.counts(pl.hand), pl.melds.length); }
  function isFuriten(st, q) {
    const pl = st.players[q];
    if (pl.furitenTemp || pl.furitenRiichi) return true;
    const w = waitsOfPlayer(pl);
    return pl.discards.some(d => w.includes(ti(d.tile.t)));
  }

  /* ---------------- own turn ---------------- */
  function legalSelf(st, p) {
    const pl = st.players[p];
    const c = E.counts(pl.hand);
    const res = { tsumo: null, kans: [], riichi: [], discards: [], forbidden: pl.kuikae.slice() };
    if (!st.afterCall) {
      res.tsumo = winInfo(st, p, pl.drawn, { tsumo: true, rinshan: st.rinshan });
      if (st.wall.length > 0 && st.kanCount < 4) {
        for (let i = 0; i < 34; i++) {
          if (c[i] !== 4) continue;
          if (pl.riichi) {
            if (pl.drawn.t !== ALL[i]) continue;
            const before = E.counts(pl.hand.filter(x => x !== pl.drawn)), after = c.slice();
            after[i] -= 4;
            if (E.waitsOf(before, pl.melds.length).join() !== E.waitsOf(after, pl.melds.length + 1).join()) continue;
          }
          res.kans.push({ kind: 'ankan', tile: ALL[i] });
        }
        if (!pl.riichi) for (const m of pl.melds) if (m.type === 'pon' && c[ti(m.base)] >= 1) res.kans.push({ kind: 'kakan', tile: m.base });
      }
      if (!pl.riichi && pl.melds.every(m => !m.open) && st.scores[p] >= 1000 && st.wall.length >= 4) {
        const seen = new Set();
        for (const x of pl.hand) {
          if (seen.has(x.t)) continue;
          seen.add(x.t);
          const i = ti(x.t);
          c[i]--;
          if (E.shanten(c, pl.melds.length) === 0) res.riichi.push(x.t);
          c[i]++;
        }
      }
    }
    if (pl.riichi) res.discards = [pl.drawn];
    else {
      res.discards = pl.hand.filter(x => !res.forbidden.includes(x.t));
      if (!res.discards.length) res.discards = pl.hand.slice();
    }
    return res;
  }

  function applySelf(st, p, a) {
    const pl = st.players[p];
    if (a.type === 'tsumo') {
      endWin(st, [{ p, info: winInfo(st, p, pl.drawn, { tsumo: true, rinshan: st.rinshan }), from: null }]);
      return { type: 'tsumo', p };
    }
    if (a.type === 'kan') {
      if (a.kind === 'ankan') {
        const tiles = pl.hand.filter(x => x.t === a.tile);
        pl.hand = pl.hand.filter(x => x.t !== a.tile);
        pl.melds.push({ type: 'kan', kanType: 'ankan', base: a.tile, tiles, open: false, rel: 0 });
        log(st, { type: 'ankan', actor: p, consumed: tiles.map(mj) });
      } else {
        const m = pl.melds.find(x => x.type === 'pon' && x.base === a.tile);
        const k = pl.hand.findIndex(x => x.t === a.tile);
        const added = pl.hand.splice(k, 1)[0];
        log(st, { type: 'kakan', actor: p, pai: mj(added), consumed: m.tiles.map(mj) });
        m.tiles.push(added);
        m.type = 'kan'; m.kanType = 'kakan';
      }
      st.kanCount++;
      revealDora(st);
      st.callsMade++;
      st.players.forEach(x => { x.ippatsu = false; });
      pl.drawn = null;
      sortHand(pl.hand);
      st.rinshan = true;
      st.phase = 'draw';
      return { type: 'kan', p };
    }
    // discard
    const k = pl.hand.findIndex(x => x.id === a.id);
    const tile = pl.hand.splice(k, 1)[0];
    const rec = { tile, seq: st.seq++, tsumogiri: tile === pl.drawn, riichi: !!a.riichi, called: false };
    if (a.riichi) log(st, { type: 'reach', actor: p });
    log(st, { type: 'dahai', actor: p, pai: mj(tile), tsumogiri: rec.tsumogiri });
    pl.discards.push(rec);
    if (pl.riichi) pl.ippatsu = false;
    if (a.riichi) {
      pl.riichi = true; pl.ippatsu = true; pl.riichiPending = true; pl.riichiSeq = rec.seq;
      pl.doubleRiichi = pl.discards.length === 1 && st.callsMade === 0;
    }
    pl.drawn = null;
    pl.kuikae = [];
    sortHand(pl.hand);
    st.lastDiscard = { p, tile, rec };
    st.rinshan = false;
    st.afterCall = false;
    st.phase = 'react';
    return { type: 'discard', p, riichi: !!a.riichi };
  }

  /* ---------------- reactions to a discard ---------------- */
  function legalReact(st, q) {
    const ld = st.lastDiscard, pl = st.players[q], t = ld.tile.t, i = ti(t);
    const res = { ron: null, pon: false, kan: false, chi: [] };
    if (q === ld.p) return res;
    const info = winInfo(st, q, ld.tile, { tsumo: false });
    if (info && !isFuriten(st, q)) res.ron = info;
    if (pl.riichi || st.wall.length === 0) return res;
    const c = E.counts(pl.hand);
    if (c[i] >= 2) res.pon = true;
    if (c[i] >= 3 && st.kanCount < 4) res.kan = true;
    if (q === (ld.p + 1) % 4 && i < 27) {
      const n = i % 9;
      for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
        if (n + a < 0 || n + b > 8 || !c[i + a] || !c[i + b]) continue;
        res.chi.push([ALL[i + a], ALL[i + b]]);
      }
    }
    return res;
  }
  const hasOptions = l => !!(l.ron || l.pon || l.kan || l.chi.length);

  function kuikaeFor(type, called, lo) {
    if (type === 'pon') return [called];
    const out = [called], i = ti(called), l = ti(lo);
    if (i === l && l % 9 <= 5) out.push(ALL[l + 3]);
    if (i === l + 2 && l % 9 >= 1) out.push(ALL[l - 1]);
    return out;
  }
  function takeTile(hand, kind) { const k = hand.findIndex(x => x.t === kind); return hand.splice(k, 1)[0]; }

  /* choices[q] = {type:'ron'|'pon'|'kan'|'chi', tiles?} or null. Returns a summary of what happened. */
  function resolveReactions(st, choices) {
    const ld = st.lastDiscard;
    const order = [1, 2, 3].map(k => (ld.p + k) % 4);
    const rons = order.filter(q => choices[q] && choices[q].type === 'ron');
    for (const q of order) {
      if (rons.includes(q)) continue;
      const pl = st.players[q], c = E.counts(pl.hand);
      c[ti(ld.tile.t)]++;
      if (c[ti(ld.tile.t)] <= 4 && E.shanten(c, pl.melds.length) === -1) { if (pl.riichi) pl.furitenRiichi = true; else pl.furitenTemp = true; }
    }
    if (rons.length === 3) { abortiveDraw(st, 'Triple ron (sanchahou)'); return { type: 'abort', rons }; }
    if (rons.length) {
      endWin(st, rons.map(q => ({ p: q, info: winInfo(st, q, ld.tile, { tsumo: false }), from: ld.p })));
      return { type: 'ron', rons };
    }
    const dp = st.players[ld.p];
    if (dp.riichiPending) {
      dp.riichiPending = false; st.scores[ld.p] -= 1000; st.sticks++;
      const deltas = [0, 0, 0, 0]; deltas[ld.p] = -1000;
      log(st, { type: 'reach_accepted', actor: ld.p, deltas, scores: st.scores.slice() });
    }
    const caller = order.find(q => choices[q] && (choices[q].type === 'pon' || choices[q].type === 'kan')) ??
      order.find(q => choices[q] && choices[q].type === 'chi');
    if (caller === undefined) { st.turn = (ld.p + 1) % 4; st.phase = 'draw'; return { type: 'none' }; }
    const ch = choices[caller], pl = st.players[caller], t = ld.tile;
    ld.rec.called = true;
    st.players.forEach(x => { x.ippatsu = false; });
    st.callsMade++;
    const used = ch.type === 'chi' ? ch.tiles.map(k => takeTile(pl.hand, k)) : Array.from({ length: ch.type === 'kan' ? 3 : 2 }, () => takeTile(pl.hand, t.t));
    const tiles = used.concat([t]).sort((a, b) => ti(a.t) - ti(b.t));
    const base = ch.type === 'chi' ? tiles[0].t : t.t;
    pl.melds.push({ type: ch.type, kanType: ch.type === 'kan' ? 'daiminkan' : null, base, tiles, called: t, open: true, rel: (ld.p - caller + 4) % 4 });
    log(st, { type: ch.type === 'kan' ? 'daiminkan' : ch.type, actor: caller, target: ld.p, pai: mj(t), consumed: used.map(mj) });
    st.turn = caller;
    pl.drawn = null;
    if (ch.type === 'kan') {
      st.kanCount++;
      revealDora(st);
      st.rinshan = true;
      st.phase = 'draw';
    } else {
      pl.kuikae = kuikaeFor(ch.type, t.t, base);
      st.phase = 'self';
      st.afterCall = true;
    }
    return { type: 'call', caller, call: ch.type };
  }

  /* ---------------- hand endings ---------------- */
  function exhaustiveDraw(st) {
    const ten = [0, 1, 2, 3].filter(p => E.shanten(E.counts(st.players[p].hand), st.players[p].melds.length) === 0);
    const deltas = [0, 0, 0, 0];
    if (ten.length > 0 && ten.length < 4) for (let p = 0; p < 4; p++) deltas[p] = ten.includes(p) ? 3000 / ten.length : -3000 / (4 - ten.length);
    for (let p = 0; p < 4; p++) st.scores[p] += deltas[p];
    st.result = { type: 'draw', reason: 'Exhaustive draw (ryuukyoku)', tenpai: ten, deltas, renchan: ten.includes(dealerOf(st)) };
    st.phase = 'end';
    log(st, { type: 'ryukyoku', deltas: deltas.slice(), scores: st.scores.slice() });
    log(st, { type: 'end_kyoku' });
  }
  function abortiveDraw(st, reason) {
    st.result = { type: 'draw', reason, tenpai: [], deltas: [0, 0, 0, 0], renchan: true, abortive: true };
    st.phase = 'end';
    log(st, { type: 'ryukyoku', deltas: [0, 0, 0, 0], scores: st.scores.slice() });
    log(st, { type: 'end_kyoku' });
  }
  function endWin(st, wins) {
    const d = dealerOf(st), deltas = [0, 0, 0, 0];
    wins.forEach((w, k) => {
      const info = w.info;
      if (k > 0) info.payments = S.computePayments({ han: info.han, fu: info.fu, dealer: w.p === d, tsumo: false, honba: 0 });
      const pay = info.payments;
      if (info.tsumo) {
        for (let x = 0; x < 4; x++) {
          if (x === w.p) continue;
          const amt = w.p === d ? pay.tsumoEach : x === d ? pay.tsumoDealer : pay.tsumoNonDealer;
          deltas[x] -= amt; deltas[w.p] += amt;
        }
      } else { deltas[w.from] -= pay.ron; deltas[w.p] += pay.ron; }
    });
    const sticksWon = st.sticks;
    deltas[wins[0].p] += st.sticks * 1000;
    st.sticks = 0;
    for (let p = 0; p < 4; p++) st.scores[p] += deltas[p];
    st.result = { type: 'win', wins, deltas, sticksWon, renchan: wins.some(w => w.p === d), ura: uraIndicators(st) };
    st.phase = 'end';
    wins.forEach((w, k) => log(st, {
      type: 'hora', actor: w.p, target: w.from === null ? w.p : w.from, pai: mj(w.info.winTile),
      ura_markers: w.info.riichi ? uraIndicators(st).map(mj) : [], deltas: k === wins.length - 1 ? deltas.slice() : [0, 0, 0, 0], scores: st.scores.slice(),
    }));
    log(st, { type: 'end_kyoku' });
  }

  function ranking(st) {
    const order = p => (p - st.startDealer + 4) % 4;
    return [0, 1, 2, 3].sort((a, b) => st.scores[b] - st.scores[a] || order(a) - order(b));
  }
  function endGame(st) {
    const top = ranking(st)[0];
    st.scores[top] += st.sticks * 1000;
    st.sticks = 0;
    st.phase = 'gameover';
    log(st, { type: 'end_game', scores: st.scores.slice() });
  }
  function nextHand(st) {
    const r = st.result, d = dealerOf(st);
    const renchan = r.renchan;
    if (r.type === 'win' && !renchan) st.honba = 0; else st.honba++;
    if (st.scores.some(s => s < 0)) return endGame(st);
    const last = st.mode === 'tonpuu' ? 3 : 7;
    if (st.roundIndex >= last) {
      if (!renchan || ranking(st)[0] === d) return endGame(st);
    }
    if (!renchan) st.roundIndex++;
    startHand(st);
  }

  /* ---------------- what a player can see ---------------- */
  function viewFor(st, p) {
    const me = st.players[p];
    const vis = new Array(34).fill(0);
    const add = x => { vis[ti(x.t)]++; };
    me.hand.forEach(add);
    st.players.forEach(pl => { pl.melds.forEach(m => m.tiles.forEach(add)); pl.discards.forEach(d => { if (!d.called) add(d.tile); }); });
    indicators(st).forEach(add);
    const all = [];
    st.players.forEach(pl => pl.discards.forEach(d => all.push({ kind: ti(d.tile.t), seq: d.seq })));
    const d = dealerOf(st);
    const opponents = [1, 2, 3].map(k => (p + k) % 4).map(j => {
      const o = st.players[j];
      const gen = new Set(o.discards.map(x => ti(x.tile.t)));
      if (o.riichi) all.forEach(x => { if (x.seq > o.riichiSeq) gen.add(x.kind); });
      return { seat: j, name: NAMES[j], riichi: o.riichi, isDealer: j === d, openMelds: o.melds.filter(m => m.open).length, gen };
    });
    return {
      seat: p, hand: me.hand.slice(), meldTiles: [].concat(...me.melds.map(m => m.tiles)),
      melds: me.melds.map(m => ({ type: m.type, base: m.base, open: m.open })), closed: me.melds.every(m => !m.open),
      riichi: me.riichi, canRiichi: st.scores[p] >= 1000 && st.wall.length >= 4,
      myDiscards: new Set(me.discards.map(x => ti(x.tile.t))),
      seatWind: seatWindOf(st, p), roundWind: roundWindOf(st), doraKinds: indicators(st).map(x => T.nextTile(x.t)),
      unseen: vis.map(v => Math.max(0, 4 - v)), visible: vis, wallLeft: st.wall.length, opponents,
    };
  }

  /* ---------------- NPC play: always the engine's top-rated action ---------------- */
  function pickTile(pl, kind, aka) {
    if (pl.drawn && pl.drawn.t === kind && !!pl.drawn.aka === !!aka) return pl.drawn;
    return pl.hand.find(x => x.t === kind && !!x.aka === !!aka) || pl.hand.find(x => x.t === kind);
  }
  function npcSelf(st, p, legal) {
    const pl = st.players[p];
    if (legal.tsumo) return { type: 'tsumo' };
    if (pl.riichi) return { type: 'discard', id: pl.drawn.id };
    const res = E.evalSelf(viewFor(st, p), legal);
    const best = res.cands[0];
    if (best.type === 'kan') return { type: 'kan', kind: best.kanKind, tile: best.tile };
    const obj = pickTile(pl, best.tile, best.aka);
    const riichi = legal.riichi.includes(best.tile) && best.info.s === 0 && best.info.live > 0 && res.f < 0.5;
    return { type: 'discard', id: obj.id, riichi };
  }
  function npcReact(st, q, legal) {
    if (legal.ron) return { type: 'ron' };
    if (!legal.pon && !legal.kan && !legal.chi.length) return null;
    const res = E.evalCalls(viewFor(st, q), st.lastDiscard.tile, legal);
    const b = res.cands[0];
    if (b.type === 'skip') return null;
    return b.type === 'chi' ? { type: 'chi', tiles: b.tiles } : { type: b.type };
  }

  global.Game = {
    NAMES, mj, newGame, nextHand, draw, legalSelf, applySelf, legalReact, hasOptions, resolveReactions, viewFor,
    npcSelf, npcReact, dealerOf, roundWindOf, seatWindOf, indicators, uraIndicators, ranking, winInfo, isFuriten, waitsOfPlayer,
  };
})(window);
