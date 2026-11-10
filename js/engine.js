/* Play Trainer engine: shanten, tile acceptance, wait quality, deal-in danger and a
   heuristic rating of every legal action. Ratings are a softmax over a hand-tuned score
   that approximates sound play – it is not a trained AI such as Mortal or NAGA. */
(function (global) {
  const T = global.Tiles, H = global.Hand;
  const ALL = T.ALL_TILES;
  const idx = t => T.tileIndex(t);
  const isSimpleIdx = i => i < 27 && i % 9 !== 0 && i % 9 !== 8;
  const TERM_HONOR = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  const TAU = 20;          // softmax temperature, in score points
  const TAU_CALL = 30;     // calls are judged less precisely, so their ratings are softer
  const VAL_K = 60;        // weight of log(expected points)
  const DANGER_K = 3000;   // weight of deal-in probability when folding
  const OPEN_PENALTY = 40; // flexibility and defence lost by opening a closed hand
  const NO_YAKU = 99;      // shanten value meaning "this open hand can never have a yaku"

  function counts(tiles) {
    const c = new Array(34).fill(0);
    for (const x of tiles) c[idx(typeof x === 'string' ? x : x.t)]++;
    return c;
  }

  /* ---------------- shanten ---------------- */
  function pareto(list) {
    const res = [];
    for (const o of list) {
      if (res.some(x => x[0] >= o[0] && x[1] >= o[1] && x[2] >= o[2])) continue;
      for (let j = res.length - 1; j >= 0; j--) { const x = res[j]; if (o[0] >= x[0] && o[1] >= x[1] && o[2] >= x[2]) res.splice(j, 1); }
      res.push(o);
    }
    return res;
  }

  /* Every Pareto-optimal [sets, partial sets, head] split of one suit. a = 9 counts (mutated, restored). */
  const suitMemo = new Map();
  function suitOpts(a) {
    let key = 0; for (let i = 0; i < 9; i++) key = key * 5 + a[i];
    let r = suitMemo.get(key);
    if (r) return r;
    let i = 0; while (i < 9 && a[i] === 0) i++;
    if (i === 9) r = [[0, 0, 0]];
    else {
      const out = [];
      const add = (dm, dt, dp, child) => { for (const o of child) if (!(dp && o[2])) out.push([o[0] + dm, o[1] + dt, o[2] + dp]); };
      if (a[i] >= 3) { a[i] -= 3; add(1, 0, 0, suitOpts(a)); a[i] += 3; }
      if (i <= 6 && a[i + 1] && a[i + 2]) { a[i]--; a[i + 1]--; a[i + 2]--; add(1, 0, 0, suitOpts(a)); a[i]++; a[i + 1]++; a[i + 2]++; }
      if (a[i] >= 2) { a[i] -= 2; const ch = suitOpts(a); add(0, 0, 1, ch); add(0, 1, 0, ch); a[i] += 2; }
      if (i <= 7 && a[i + 1]) { a[i]--; a[i + 1]--; add(0, 1, 0, suitOpts(a)); a[i]++; a[i + 1]++; }
      if (i <= 6 && a[i + 2]) { a[i]--; a[i + 2]--; add(0, 1, 0, suitOpts(a)); a[i]++; a[i + 2]++; }
      a[i]--; add(0, 0, 0, suitOpts(a)); a[i]++;
      r = pareto(out);
    }
    suitMemo.set(key, r);
    return r;
  }
  function honorOpts(c) {
    let m = 0, pairs = 0;
    for (let i = 27; i < 34; i++) { if (c[i] >= 3) m++; else if (c[i] === 2) pairs++; }
    const r = [[m, pairs, 0]];
    if (pairs) r.push([m, pairs - 1, 1]);
    else if (m) r.push([m - 1, 0, 1]);
    return r;
  }
  const BUF = [new Array(9), new Array(9), new Array(9)];
  function shantenRegular(c, melds) {
    const k = 4 - melds, g = [];
    for (let s = 0; s < 3; s++) { const a = BUF[s]; for (let i = 0; i < 9; i++) a[i] = c[s * 9 + i]; g.push(suitOpts(a)); }
    g.push(honorOpts(c));
    let best = 2 * k;
    for (const x of g[0]) for (const y of g[1]) for (const z of g[2]) for (const w of g[3]) {
      const p = x[2] + y[2] + z[2] + w[2]; if (p > 1) continue;
      let m = x[0] + y[0] + z[0] + w[0], t = x[1] + y[1] + z[1] + w[1];
      if (m > k) m = k;
      if (t > k - m) t = k - m;
      const s = 2 * k - 2 * m - t - p;
      if (s < best) best = s;
    }
    return best;
  }
  function shantenChiitoi(c) { let p = 0, k = 0; for (let i = 0; i < 34; i++) { if (c[i] >= 2) p++; if (c[i]) k++; } return 6 - p + Math.max(0, 7 - k); }
  function shantenKokushi(c) { let k = 0, pair = 0; for (const i of TERM_HONOR) { if (c[i]) k++; if (c[i] >= 2) pair = 1; } return 13 - k - pair; }
  function shanten(c, melds = 0) {
    let s = shantenRegular(c, melds);
    if (melds === 0) s = Math.min(s, shantenChiitoi(c), shantenKokushi(c));
    return s;
  }
  function waitsOf(c, melds) {
    const w = [];
    for (let i = 0; i < 34; i++) { if (c[i] >= 4) continue; c[i]++; if (shanten(c, melds) === -1) w.push(i); c[i]--; }
    return w;
  }
  function toitoiShanten(c, k) {
    let rawTrip = 0, pairs = 0;
    for (let i = 0; i < 34; i++) { if (c[i] >= 3) rawTrip++; else if (c[i] === 2) pairs++; }
    const trip = Math.min(rawTrip, k);
    let need = k - trip, deficit = 0;
    const fromPairs = Math.min(pairs, need);
    need -= fromPairs; deficit += fromPairs + need * 2;
    if (pairs - fromPairs <= 0 && rawTrip <= k) deficit += 1;
    return deficit - 1;
  }

  /* ---------------- yaku-aware shanten for open hands ---------------- */
  const yakuhaiIdx = view => [...new Set([31, 32, 33, idx(view.seatWind), idx(view.roundWind)])];
  const keep = (c, pred) => c.map((v, i) => (pred(i) ? v : 0));
  function meldIdx(m) { const b = idx(m.base); return m.type === 'chi' ? [b, b + 1, b + 2] : [b]; }

  /* Closed hands can always riichi, so plain shanten. Open hands only count shapes that keep a yaku:
     yakuhai, tanyao, honitsu (incl. chinitsu) and toitoi. */
  function makeShFn(view, melds) {
    const n = melds.length;
    const closed = melds.every(m => !m.open);
    if (closed) return { closed, fn: c => shanten(c, n), path: () => null };
    const yh = yakuhaiIdx(view);
    const paths = [];
    if (melds.some(m => m.type !== 'chi' && yh.includes(idx(m.base)))) paths.push({ name: 'Yakuhai', han: 1, f: c => shantenRegular(c, n) });
    if (melds.every(m => meldIdx(m).every(isSimpleIdx))) paths.push({ name: 'Tanyao', han: 1, f: c => shantenRegular(keep(c, isSimpleIdx), n) });
    const suits = new Set();
    melds.forEach(m => meldIdx(m).forEach(i => { if (i < 27) suits.add(Math.floor(i / 9)); }));
    if (suits.size <= 1) for (const s of (suits.size ? [...suits] : [0, 1, 2])) paths.push({ name: 'Honitsu', han: 2, f: c => shantenRegular(keep(c, i => i >= 27 || Math.floor(i / 9) === s), n) });
    if (melds.every(m => m.type !== 'chi')) paths.push({ name: 'Toitoi', han: 2, f: c => toitoiShanten(c, 4 - n) });
    paths.push({
      name: 'Yakuhai', han: 1, f: c => {
        let b = NO_YAKU;
        for (const y of yh) {
          if (c[y] >= 3) b = Math.min(b, shantenRegular(c, n));
          else if (c[y] === 2 && view.unseen[y] > 0) { c[y] -= 2; b = Math.min(b, shantenRegular(c, n + 1) + 1); c[y] += 2; }
        }
        return b;
      },
    });
    const fn = c => { let b = NO_YAKU; for (const p of paths) { const s = p.f(c); if (s < b) b = s; } return b; };
    const path = c => {
      let b = NO_YAKU, best = null;
      for (const p of paths) { const s = p.f(c); if (s < b || (s === b && best && p.han > best.han)) { b = s; best = p; } }
      return b < NO_YAKU ? best : null;
    };
    return { closed, fn, path };
  }

  function makeCtx(view, melds) {
    const doraMult = new Array(34).fill(0);
    view.doraKinds.forEach(t => doraMult[idx(t)]++);
    return {
      view, melds, n: melds.length, sh: makeShFn(view, melds), doraMult, unseen: view.unseen,
      myDiscards: view.myDiscards, yh: yakuhaiIdx(view), doubleWind: view.seatWind === view.roundWind ? idx(view.seatWind) : -1, hMelds: melds.map(m => ({ type: m.type, tile: m.base, open: m.open })),
    };
  }
  function doraTotal(view, doraMult) {
    let d = 0;
    for (const x of view.hand.concat(view.meldTiles)) { d += doraMult[idx(x.t)]; if (x.aka) d++; }
    return d;
  }

  /* ---------------- evaluating a 13-tile (pre-draw) state ---------------- */
  function winHasYaku(c, w, ctx) {
    const cc = c.slice(); cc[w]++;
    if (ctx.n === 0 && shantenKokushi(cc) === -1) return true;
    const kinds = [];
    for (let i = 0; i < 34; i++) for (let k = 0; k < cc[i]; k++) kinds.push(ALL[i]);
    const ev = H.evaluate({ concealed: kinds, winTile: ALL[w], melds: ctx.hMelds, tsumo: false, seatWind: ctx.view.seatWind, roundWind: ctx.view.roundWind });
    return !!ev && (ev.yakuman || ev.han > 0);
  }
  function tenpaiInfo(c, ctx, dk) {
    const waits = waitsOf(c, ctx.n);
    const furiten = waits.some(w => ctx.myDiscards.has(w) || w === dk);
    const riichiOk = ctx.sh.closed && (ctx.view.riichi || ctx.view.canRiichi);
    let live = 0, eff = 0;
    const valid = [];
    for (const w of waits) {
      const weight = riichiOk ? 1 : winHasYaku(c, w, ctx) ? 1 : ctx.sh.closed ? 0.35 : 0; // closed without riichi: tsumo only
      if (weight > 0) { valid.push(w); live += ctx.unseen[w]; }
      eff += weight * ctx.unseen[w];
    }
    if (furiten) eff *= 0.35;
    return { waits, validWaits: valid, live, furiten, effWaits: eff };
  }
  function evalState(c, ctx, dk) {
    const s = ctx.sh.fn(c);
    const info = { s, uke: 0, ukeTiles: [] };
    if (s >= NO_YAKU) { info.noYaku = true; return info; }
    for (let i = 0; i < 34; i++) {
      const u = ctx.unseen[i];
      if (!u || c[i] >= 4) continue;
      c[i]++; const s2 = ctx.sh.fn(c); c[i]--;
      if (s2 < s) { info.ukeTiles.push(i); info.uke += u; }
    }
    if (s === 0) Object.assign(info, tenpaiInfo(c, ctx, dk));
    else if (!ctx.sh.closed) {
      // an open hand can also take these tiles by calling: pairs from anyone, sequences from kamicha
      let bonus = 0;
      for (const i of info.ukeTiles) {
        if (c[i] >= 2) bonus += ctx.unseen[i];
        else if (i < 27 && ((i % 9 >= 1 && i % 9 <= 7 && c[i - 1] && c[i + 1]) || (i % 9 >= 2 && c[i - 2] && c[i - 1]) || (i % 9 <= 6 && c[i + 1] && c[i + 2]))) bonus += 0.3 * ctx.unseen[i];
      }
      info.ukeEff = info.uke + bonus;
    }
    const p = ctx.sh.path(c);
    if (p) info.path = p.name;
    return info;
  }
  /* For a 1-shanten state: average number of live winning tiles once you reach tenpai. */
  function avgWaits(c, ctx, ukeTiles) {
    const cache = new Map();
    let tot = 0, wsum = 0;
    for (const u of ukeTiles) {
      const n = ctx.unseen[u];
      c[u]++;
      let best = 0;
      for (let d = 0; d < 34; d++) {
        if (!c[d]) continue;
        c[d]--;
        if (ctx.sh.fn(c) === 0) {
          const key = c.join('');
          let w = cache.get(key);
          if (w === undefined) { w = 0; for (const x of waitsOf(c, ctx.n)) w += ctx.unseen[x] - (x === u ? 1 : 0); cache.set(key, w); }
          if (w > best) best = w;
        }
        c[d]++;
      }
      c[u]--;
      tot += n * best; wsum += n;
    }
    return wsum ? tot / wsum : 0;
  }
  function expectedHan(c, ctx, dora) {
    if (ctx.sh.closed) {
      let h = 1.6 + dora; // riichi + an average share of tsumo / ippatsu / ura
      for (const y of ctx.yh) { if (c[y] >= 3) h += 1; else if (c[y] === 2) h += 0.3; }
      return h;
    }
    const p = ctx.sh.path(c);
    return (p ? p.han : 0) + dora;
  }

  /* ---------------- danger ---------------- */
  function threats(view) {
    const out = [];
    for (const o of view.opponents) {
      let w = 0;
      if (o.riichi) w = o.isDealer ? 1.3 : 1;
      else if (o.openMelds >= 3) w = 0.5;
      else if (o.openMelds === 2 && view.wallLeft < 24) w = 0.25;
      if (w) out.push({ o, w });
    }
    return out;
  }
  /* Rough deal-in probability of tile i against one opponent with safe set `gen`. */
  function tileDanger(i, gen, vis) {
    if (gen.has(i)) return { d: 0, why: 'genbutsu' };
    if (i >= 27) {
      const s = vis[i];
      if (s >= 4) return { d: 0, why: 'all four visible' };
      if (s === 3) return { d: 0.012, why: 'honor, 3 visible' };
      if (s === 2) return { d: 0.035, why: 'honor, 2 visible' };
      return { d: 0.07, why: 'live honor' };
    }
    const n = i % 9 + 1;
    let d = 0, open = 0, covered = 0, kabe = 0;
    const side = (lo, hi, other, ryanmen) => {
      if (vis[lo] >= 4 || vis[hi] >= 4) { kabe++; return; }
      if (ryanmen && gen.has(other)) { covered++; return; }
      open++; d += ryanmen ? 0.055 : 0.035;
    };
    if (n >= 3) side(i - 2, i - 1, i - 3, n >= 4);
    if (n <= 7) side(i + 1, i + 2, i + 3, n <= 6);
    if (n >= 2 && n <= 8 && vis[i - 1] < 4 && vis[i + 1] < 4) d += 0.012; // kanchan
    d += vis[i] >= 3 ? 0.004 : vis[i] === 2 ? 0.01 : 0.018;              // shanpon / tanki
    const why = open === 0 ? (kabe && !covered ? 'no-chance (kabe)' : 'suji') : (covered || kabe) ? 'half-suji' : 'non-suji';
    return { d, why };
  }
  function dangerOf(i, th, view) {
    let d = 0, why = '', top = -1;
    for (const { o, w } of th) {
      const r = tileDanger(i, o.gen, view.visible);
      d += w * r.d;
      if (w * r.d > top) { top = w * r.d; why = r.why; }
    }
    return { d: Math.min(0.6, d), why };
  }
  function foldness(th, minS, bestWaits) {
    if (!th.length) return 0;
    const tw = Math.min(1, th.reduce((a, x) => a + x.w, 0));
    const base = minS >= 2 ? 0.85 : minS === 1 ? 0.5 : bestWaits >= 4 ? 0.12 : 0.3;
    return base * tw;
  }

  /* ---------------- scoring & rating ---------------- */
  function effScore(inf) {
    if (inf.noYaku) return -1500;
    const s = inf.s, U = inf.ukeEff !== undefined ? inf.ukeEff : inf.uke;
    if (s <= 0) return inf.effWaits > 0 ? 1050 + 100 * Math.log(1 + inf.effWaits) : 600;
    if (s === 1) return 500 + 100 * Math.log(1 + U) + 50 * Math.log(1 + (inf.avgW || 0));
    return 300 - 400 * (s - 2) + 100 * Math.log(1 + U);
  }
  function points(h) { if (h >= 8) return 16000; if (h >= 6) return 12000; return Math.min(8000, 1000 * Math.pow(2, Math.max(0, h - 1))); }
  const valScore = inf => (inf.noYaku ? 0 : VAL_K * Math.log(points(inf.han) / 1000));
  function keepValue(i, ctx) {
    if (i >= 27) return i === ctx.doubleWind ? 5 : ctx.yh.includes(i) ? 3 : 0; // a double wind pon is worth 2 han
    const n = i % 9;
    return n === 0 || n === 8 ? 6 : n === 1 || n === 7 ? 9 : 12;
  }
  function scoreOf(cd, f) {
    if (cd.win) return 1e6;
    const inf = cd.info;
    return (1 - f) * (effScore(inf) + valScore(inf)) + (cd.tb || 0) + (cd.adj || 0) - f * DANGER_K * (inf.danger || 0);
  }
  function rate(cands, tau = TAU) {
    cands.sort((a, b) => b.score - a.score);
    const top = cands[0].score;
    let sum = 0;
    for (const c of cands) { c.w = Math.exp((c.score - top) / tau); sum += c.w; }
    for (const c of cands) c.rating = c.w / sum;
    return cands;
  }

  /* ---------------- own-turn decisions: discard / kan / tsumo ---------------- */
  function evalSelf(view, legal) {
    const c = counts(view.hand);
    const ctx = makeCtx(view, view.melds);
    const th = threats(view);
    const total = doraTotal(view, ctx.doraMult);
    const cands = [];
    if (legal.tsumo) cands.push({ key: 'tsumo', type: 'tsumo', win: true, info: { winInfo: legal.tsumo } });
    const allowed = new Set((legal.discards || view.hand).map(x => x.id));
    const seen = new Set();
    for (const obj of view.hand) {
      if (!allowed.has(obj.id)) continue;
      const key = 'd:' + obj.t + (obj.aka ? '*' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const i = idx(obj.t);
      c[i]--;
      const info = evalState(c, ctx, i);
      info.dora = total - ctx.doraMult[i] - (obj.aka ? 1 : 0);
      info.han = expectedHan(c, ctx, info.dora);
      const dd = dangerOf(i, th, view);
      info.danger = dd.d; info.dangerWhy = dd.why;
      cands.push({ key, type: 'discard', tile: obj.t, aka: !!obj.aka, kind: i, info, tb: -keepValue(i, ctx), c: c.slice(), ctx });
      c[i]++;
    }
    for (const k of legal.kans || []) {
      const i = idx(k.tile), c2 = c.slice();
      let melds2;
      if (k.kind === 'ankan') { c2[i] -= 4; melds2 = view.melds.concat([{ type: 'kan', base: k.tile, open: false }]); }
      else { c2[i] -= 1; melds2 = view.melds.map(m => (m.type === 'pon' && m.base === k.tile ? { type: 'kan', base: k.tile, open: true } : m)); }
      const ctx2 = makeCtx(view, melds2);
      const info = evalState(c2, ctx2, -1);
      info.dora = total; info.han = expectedHan(c2, ctx2, total); info.danger = 0;
      cands.push({ key: `k:${k.kind}:${k.tile}`, type: 'kan', kanKind: k.kind, tile: k.tile, kind: i, info, adj: 8, c: c2, ctx: ctx2 });
    }
    const ds = cands.filter(x => !x.win);
    if (!ds.length) return { kind: 'self', cands: rate(cands.map(x => Object.assign(x, { score: scoreOf(x, 0) }))), f: 0, threats: th, minS: 0 };
    const minS = Math.min(...ds.map(x => x.info.s));
    if (minS === 1) for (const cd of ds) if (cd.info.s === 1) cd.info.avgW = avgWaits(cd.c, cd.ctx, cd.info.ukeTiles);
    const bestWaits = Math.max(0, ...ds.filter(x => x.info.s === 0).map(x => x.info.effWaits));
    const f = foldness(th, minS, bestWaits);
    if (f > 0) for (const cd of ds) if (cd.type === 'kan' && minS > 0) cd.adj -= 120 * f; // a kan feeds dora to the threat
    for (const cd of cands) cd.score = scoreOf(cd, f);
    rate(cands);
    return { kind: 'self', cands, f, threats: th, minS };
  }

  /* ---------------- reacting to a discard: ron / pon / chi / kan / skip ---------------- */
  function kuikaeIdx(type, t, lo) {
    if (type === 'pon') return [t];
    const out = [t];
    if (t === lo && lo % 9 <= 5) out.push(lo + 3);
    if (t === lo + 2 && lo % 9 >= 1) out.push(lo - 1);
    return out;
  }
  function evalCalls(view, dObj, legal) {
    const c = counts(view.hand);
    const t = idx(dObj.t);
    const th = threats(view);
    const ctx0 = makeCtx(view, view.melds);
    const total = doraTotal(view, ctx0.doraMult);
    const cands = [];
    if (legal.ron) cands.push({ key: 'ron', type: 'ron', win: true, info: { winInfo: legal.ron } });
    const skipInfo = evalState(c, ctx0, -1);
    skipInfo.dora = total; skipInfo.han = expectedHan(c, ctx0, total); skipInfo.danger = 0;
    cands.push({ key: 'skip', type: 'skip', info: skipInfo, c: c.slice(), ctx: ctx0 });
    const opts = [];
    if (legal.pon) opts.push({ key: 'pon', type: 'pon', use: [t, t], meld: { type: 'pon', base: dObj.t, open: true } });
    if (legal.kan) opts.push({ key: 'kan', type: 'kan', use: [t, t, t], meld: { type: 'kan', base: dObj.t, open: true } });
    for (const pair of legal.chi || []) {
      const ks = pair.map(idx), lo = Math.min(t, ...ks);
      opts.push({ key: 'chi:' + pair.join(','), type: 'chi', tiles: pair, use: ks, lo, meld: { type: 'chi', base: ALL[lo], open: true } });
    }
    const gained = ctx0.doraMult[t] + (dObj.aka ? 1 : 0);
    for (const o of opts) {
      const c2 = c.slice();
      o.use.forEach(k => c2[k]--);
      const ctx2 = makeCtx(view, view.melds.concat([o.meld]));
      if (o.type === 'kan') {
        const info = evalState(c2, ctx2, -1);
        info.dora = total + gained; info.han = expectedHan(c2, ctx2, info.dora); info.danger = 0;
        Object.assign(o, { info, c: c2, ctx: ctx2, adj: -20 });
      } else {
        const forbid = kuikaeIdx(o.type, t, o.lo);
        let best = null;
        for (let d = 0; d < 34; d++) {
          if (!c2[d] || forbid.includes(d)) continue;
          c2[d]--;
          const inf = evalState(c2, ctx2, d);
          inf.dora = total + gained - ctx2.doraMult[d];
          inf.han = expectedHan(c2, ctx2, inf.dora);
          const dd = dangerOf(d, th, view);
          inf.danger = dd.d; inf.dangerWhy = dd.why;
          const sc = effScore(inf) + valScore(inf) - (th.length ? 0.5 * DANGER_K * inf.danger : 0);
          if (!best || sc > best.sc) best = { sc, inf, d, c: c2.slice() };
          c2[d]++;
        }
        if (!best) continue;
        best.inf.thenDiscard = best.d;
        Object.assign(o, { info: best.inf, c: best.c, ctx: ctx2, adj: 0 });
      }
      if (view.closed) o.adj -= OPEN_PENALTY;
      cands.push(o);
    }
    const nonWin = cands.filter(x => !x.win);
    const minS = Math.min(...nonWin.map(x => x.info.s));
    if (minS === 1) for (const cd of nonWin) if (cd.info.s === 1) cd.info.avgW = avgWaits(cd.c, cd.ctx, cd.info.ukeTiles);
    const f = foldness(th, skipInfo.s, skipInfo.effWaits || 0);
    for (const cd of nonWin) if (cd.type !== 'skip') cd.adj = (cd.adj || 0) - 150 * f;
    for (const cd of cands) cd.score = scoreOf(cd, f);
    rate(cands, TAU_CALL);
    return { kind: 'react', cands, f, threats: th, minS, tile: dObj };
  }

  /* ---------------- text helpers ---------------- */
  const chip = (t, aka) => T.tileHTML(typeof t === 'number' ? ALL[t] : t, { size: 'inline', aka });
  const chips = list => (list && list.length ? list.map(i => chip(i)).join('') : '—');
  const pct = x => Math.round(x * 100) + '%';
  const riskPct = x => (x * 100 < 10 ? (x * 100).toFixed(1) : Math.round(x * 100)) + '%';
  const shStr = s => (s === 0 ? 'tenpai' : s === 1 ? '1-shanten' : `${s}-shanten`);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  function labelOf(cd) {
    switch (cd.type) {
      case 'discard': return chip(cd.tile, cd.aka);
      case 'kan': return cd.kanKind ? `${cd.kanKind === 'ankan' ? 'Closed kan' : 'Added kan'} ${chip(cd.tile)}` : 'Kan';
      case 'pon': return 'Pon';
      case 'chi': return `Chi ${cd.tiles.map(x => chip(x)).join('')}`;
      case 'skip': return 'Skip';
      case 'tsumo': return 'Tsumo';
      case 'ron': return 'Ron';
    }
    return cd.key;
  }
  function what(cd) {
    switch (cd.type) {
      case 'discard': return `discarding ${chip(cd.tile, cd.aka)}${cd.aka ? ' (red five)' : ''}`;
      case 'kan': return cd.kanKind ? `declaring kan on ${chip(cd.tile)}` : 'calling kan';
      case 'pon': return 'calling pon';
      case 'chi': return `calling chi with ${cd.tiles.map(x => chip(x)).join('')}`;
      case 'skip': return 'skipping the call';
      case 'tsumo': return 'declaring tsumo';
      case 'ron': return 'declaring ron';
    }
    return cd.key;
  }
  function describe(cd) {
    const i = cd.info || {};
    if (cd.win) return `Win · ${i.winInfo ? (i.winInfo.yakuman ? 'yakuman' : i.winInfo.han + ' han') : ''}`;
    if (i.noYaku) return 'No yaku possible';
    let s = i.s === 0 ? `Tenpai · ${i.live} live${i.furiten ? ' · furiten' : ''}` : `${i.s}-shanten · ${i.uke} tiles`;
    if (cd.type === 'discard' && i.dangerWhy) s += i.danger > 0 ? ` · risk ${riskPct(i.danger)}` : ' · safe';
    else if (i.danger > 0) s += ` · risk ${riskPct(i.danger)}`;
    return s;
  }
  function threatText(res) {
    const r = res.threats.filter(x => x.o.riichi).map(x => x.o.name);
    const o = res.threats.filter(x => !x.o.riichi).map(x => x.o.name);
    const parts = [];
    if (r.length) parts.push(`${r.join(' and ')} declared riichi`);
    if (o.length) parts.push(`${o.join(' and ')} ${o.length > 1 ? 'have' : 'has'} an open hand that may be tenpai`);
    return parts.join('; ');
  }

  function explain(res, a, b) {
    const r = [];
    const A = a.info || {}, B = b.info || {};
    if (b.win) {
      const w = B.winInfo;
      r.push(`You had a winning hand: <b>${b.type === 'ron' ? 'Ron' : 'Tsumo'}</b> was available for ${w.yakuman ? 'a yakuman' : `${w.han} han ${w.fu} fu`} (${w.payments.total.toLocaleString()} points). A win is always the right call here.`);
      return r;
    }
    const isCall = cd => cd.type === 'pon' || cd.type === 'chi' || (cd.type === 'kan' && !cd.kanKind);
    if (isCall(a) && A.noYaku) {
      r.push(`${cap(what(a))} opens your hand, but it would have <b>no yaku</b>: no yakuhai triplet or pair, and the melds rule out tanyao, honitsu and toitoi. An open hand without a yaku can never win, so this call is always a mistake.`);
      return r;
    }
    if (A.noYaku && !B.noYaku) r.push(`After ${what(a)} your open hand has no way left to make a yaku, so it can no longer win.`);
    const f = res.f;
    let folded = false;
    if (f > 0.2 && (A.danger || 0) - (B.danger || 0) > 0.02) {
      folded = f >= 0.5;
      r.push(`${threatText(res)}. ${cap(what(a))} is risky (${A.dangerWhy}, ≈${riskPct(A.danger)} to deal in), while ${what(b)} is ${B.danger === 0 ? 'completely safe (genbutsu)' : `safer (${B.dangerWhy}, ≈${riskPct(B.danger)})`}. ${res.minS >= 2 ? `Your hand is ${shStr(res.minS)}, so you are unlikely to win it: fold and protect your points.` : 'Your hand is not strong enough to justify that risk.'}`);
    } else if (f > 0 && (B.danger || 0) - (A.danger || 0) > 0.02) {
      r.push(`The engine pushes here: ${what(b)} is riskier (≈${riskPct(B.danger)}), but your hand is close enough to winning to be worth it.`);
    }
    if (!A.noYaku && !B.noYaku && !folded) {
      if (A.s !== B.s) {
        r.push(`After ${what(a)} you are ${shStr(A.s)}; after ${what(b)} you would be ${shStr(B.s)}${B.s < A.s ? ' – one step closer to a ready hand' : ''}.`);
        if (B.s < A.s && b.type !== 'skip' && B.path && isCall(b)) r.push(`The call keeps a yaku (${B.path}), so the open hand can still win.`);
      } else if (A.s === 0) {
        r.push(`Both keep tenpai, but ${what(b)} waits on ${chips(B.validWaits)} (<b>${B.live}</b> live tile${B.live === 1 ? '' : 's'}${B.furiten ? ', furiten' : ''}) while ${what(a)} waits on ${chips(A.validWaits)} (<b>${A.live}</b> live${A.furiten ? ', furiten' : ''}).`);
        if (A.furiten && !B.furiten) r.push(`After ${what(a)} you would be <b>furiten</b>: one of your winning tiles is in your own discards, so you could only win by tsumo.`);
        const dead = (A.waits || []).filter(w => !(A.validWaits || []).includes(w));
        if (dead.length) r.push(`Some of those waits (${chips(dead)}) give your open hand no yaku, so you could not win on them.`);
      } else {
        if (B.uke > A.uke) r.push(`Both leave you ${shStr(A.s)}, but ${what(b)} accepts <b>${B.uke}</b> tiles (${chips(B.ukeTiles)}) versus <b>${A.uke}</b> (${chips(A.ukeTiles)}).`);
        else if (A.uke > B.uke && a.type === 'discard' && b.type === 'discard' && (a.tb || 0) < (b.tb || 0)) r.push(`${cap(what(a))} accepts slightly more tiles right now (${A.uke} vs ${B.uke}), but ${chip(b.tile)} is the less useful tile to keep: honors and terminals only help by pairing up, while ${chip(a.tile)} can still grow into a sequence.`);
        if (A.s === 1 && (B.avgW || 0) > (A.avgW || 0) + 0.7) r.push(`${cap(what(b))} also leads to better waits once you reach tenpai (≈${B.avgW.toFixed(1)} vs ≈${(A.avgW || 0).toFixed(1)} winning tiles on average).`);
      }
      if (isCall(a) && A.path === 'Tanyao' && a.c) {
        const junk = []; a.c.forEach((n, i) => { if (n && !isSimpleIdx(i)) junk.push(i); });
        if (junk.length) r.push(`After this call your only yaku would be tanyao, so ${chips(junk)} would all have to go before you can win.`);
      }
      if ((B.han || 0) - (A.han || 0) >= 0.6) {
        if (a.type === 'discard' && (a.aka || (A.dora < B.dora))) r.push(`${chip(a.tile, a.aka)} is ${a.aka ? 'a red five' : 'a dora'} – throwing it away costs a han.`);
        else if (isCall(a) && b.type === 'skip') r.push(`Calling drops your expected value to ≈${A.han.toFixed(1)} han (no riichi, menzen tsumo or ura dora) versus ≈${B.han.toFixed(1)} han staying closed.`);
        else r.push(`${cap(what(b))} keeps more value (≈${B.han.toFixed(1)} vs ≈${A.han.toFixed(1)} han expected).`);
      }
    }
    if (!r.length) {
      if (a.type === 'discard' && b.type === 'discard' && (a.tb || 0) < (b.tb || 0)) r.push(`Both are equally efficient. ${chip(b.tile)} is the less useful tile to keep: honors and terminals connect with fewer tiles than middle numbers.`);
      else r.push(`It's close, but the engine prefers ${what(b)} (${pct(b.rating)}) over ${what(a)} (${pct(a.rating)}).`);
    }
    return r;
  }

  /* Verifiable differences between two options (by key) – no guesses about why an engine prefers one. */
  function facts(res, aKey, bKey) {
    const a = res.cands.find(c => c.key === aKey), b = res.cands.find(c => c.key === bKey);
    if (!a || !b) return [];
    const A = a.info || {}, B = b.info || {};
    const r = [];
    if (b.win) {
      const w = B.winInfo;
      return [`${b.type === 'ron' ? 'Ron' : 'Tsumo'} was available: ${w.yakuman ? 'a yakuman' : `${w.han} han ${w.fu} fu`} for ${w.payments.total.toLocaleString()} points.`];
    }
    const isCall = cd => cd.type === 'pon' || cd.type === 'chi' || (cd.type === 'kan' && !cd.kanKind);
    if (A.noYaku && !B.noYaku) r.push(`After ${what(a)} your open hand has no yaku left to aim for (no yakuhai, tanyao, honitsu or toitoi shape).`);
    if (!A.noYaku && !B.noYaku) {
      if (A.s !== B.s) r.push(`Shanten: ${what(a)} leaves you ${shStr(A.s)}; ${what(b)} leaves you ${shStr(B.s)}.`);
      else if (A.s === 0) r.push(`Waits: ${what(b)} → ${chips(B.validWaits)} (${B.live} live${B.furiten ? ', furiten' : ''}); ${what(a)} → ${chips(A.validWaits)} (${A.live} live${A.furiten ? ', furiten' : ''}).`);
      else if (A.uke !== B.uke) {
        const list = x => (x.ukeTiles.length <= 8 ? ` (${chips(x.ukeTiles)})` : '');
        r.push(`Tile acceptance: ${what(b)} accepts ${B.uke} tiles${list(B)}; ${what(a)} accepts ${A.uke}${list(A)}.`);
      }
      if (A.furiten && !B.furiten) r.push(`${cap(what(a))} would leave you <b>furiten</b>: a winning tile is in your own discards, so you could only win by tsumo.`);
      const dead = (A.waits || []).filter(w => !(A.validWaits || []).includes(w));
      if (dead.length) r.push(`With ${what(a)}, the wait${dead.length > 1 ? 's' : ''} ${chips(dead)} give${dead.length > 1 ? '' : 's'} your open hand no yaku.`);
    }
    if (res.threats.length && a.type === 'discard' && b.type === 'discard' && A.dangerWhy && B.dangerWhy && A.dangerWhy !== B.dangerWhy) {
      r.push(`Safety (${threatText(res)}): ${chip(a.tile, a.aka)} is ${A.dangerWhy}; ${chip(b.tile, b.aka)} is ${B.dangerWhy}.`);
    }
    if (a.type === 'discard' && (a.aka || (A.dora || 0) < (B.dora || 0))) r.push(`${chip(a.tile, a.aka)} is ${a.aka ? 'a red five' : 'a dora'} (1 han).`);
    if (isCall(a) && b.type === 'skip' && res.cands.find(c => c.key === 'skip') && a.info && !A.noYaku) r.push('Calling opens your hand: no riichi, menzen tsumo or ura dora afterwards.');
    if (A.path && isCall(a)) r.push(`After the call your yaku would have to come from ${A.path.toLowerCase()}.`);
    return r;
  }

  /* ---------------- grading ---------------- */
  /* Accept the top play when it is rated above 50%; otherwise accept the top two.
     Plays that score the same as an accepted play are always accepted too. */
  function grade(res, key, opts = {}) {
    const cands = res.cands, best = cands[0];
    const chosen = cands.find(c => c.key === key);
    const near = (x, y) => Math.abs(x.score - y.score) < 0.5;
    const acc = new Set(cands.filter(c => near(c, best)).map(c => c.key));
    const rule = best.rating > 0.5 ? 'best' : 'top2';
    if (rule === 'top2' && acc.size < 2) {
      const second = cands.find(c => !acc.has(c.key));
      if (second) cands.filter(c => near(c, second)).forEach(c => acc.add(c.key));
    }
    if (opts.margin) cands.forEach(c => { if (!c.win && !best.win && best.rating - c.rating <= opts.margin) acc.add(c.key); });
    let correct = !!chosen && acc.has(key);
    const isCall = chosen && (chosen.type === 'pon' || chosen.type === 'chi' || (chosen.type === 'kan' && !chosen.kanKind));
    if (isCall && chosen.info.noYaku) correct = false; // opening without a yaku is always wrong
    const ref = acc.has(best.key) && best.key !== key ? best : cands.find(c => acc.has(c.key) && c.key !== key) || best;
    return { correct, chosen, best, ref, accepted: acc, rule, reasons: correct || !chosen ? [] : explain(res, chosen, ref), notes: [] };
  }

  global.Engine = {
    counts, shanten, shantenRegular, shantenChiitoi, shantenKokushi, waitsOf, makeShFn,
    evalSelf, evalCalls, grade, explain, facts, describe, labelOf, what, tileDanger, threats, chip, chips, pct, riskPct, shStr,
  };
})(window);
