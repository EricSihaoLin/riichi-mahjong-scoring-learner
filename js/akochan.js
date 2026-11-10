/* Client for the akochan bridge (server/akochan_server.py).
   Streams the game's mjai events from seat 0's point of view, fetches akochan's evaluation for each of your
   decisions, and grades a choice by how many expected placement points it loses against akochan's best. */
(function (global) {
  const T = global.Tiles;
  const API = 'api/akochan/';
  const ME = 0;
  const FROM_MJ = { P: 'Wh', F: 'G', C: 'R' };

  const isReview = ev => ev.actor !== undefined && (ev.actor === ME ? ev.type === 'tsumo' : ev.type === 'dahai' || ev.type === 'kakan');
  function mask(ev) {
    if (ev.type === 'start_kyoku') return Object.assign({}, ev, { tehais: ev.tehais.map((h, i) => (i === ME ? h : h.map(() => '?'))) });
    if (ev.type === 'tsumo' && ev.actor !== ME) return Object.assign({}, ev, { pai: '?' });
    return ev;
  }
  function fromMj(p) {
    const aka = p.length === 3 && p[2] === 'r';
    const s = aka ? p.slice(0, 2) : p;
    return { t: FROM_MJ[s] || s, aka };
  }

  const A = { status: 'off', message: '', sid: null, log: null, sent: 0, serverCount: 0, reviews: 0, reviewOf: new Map(), cache: new Map(), queue: Promise.resolve(), onChange: null, gen: 0 };
  const setStatus = (s, msg = '') => { A.status = s; A.message = msg; if (A.onChange) A.onChange(); };

  async function call(path, body) {
    const r = await fetch(API + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) { const err = new Error(data.error || data.message || `HTTP ${r.status}`); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  /* Start a fresh engine session for a new game. */
  function start(log) {
    const gen = ++A.gen;
    if (A.sid) call('close', { id: A.sid }).catch(() => {});
    Object.assign(A, { log, sid: null, sent: 0, serverCount: 0, reviews: 0, resumes: 0, reviewOf: new Map(), cache: new Map(), queue: Promise.resolve() });
    setStatus('connecting');
    A.ready = (async () => {
      try {
        const r = await call('session', {});
        if (gen !== A.gen) return;
        A.sid = r.id;
        setStatus('online');
        sync();
      } catch (e) {
        if (gen === A.gen) { A.lastAttempt = Date.now(); setStatus('offline', e.status === 503 ? e.message : 'The akochan service is not reachable.'); }
      }
    })();
    return A.ready;
  }

  /* akochan only keeps the current hand, so after losing a session we replay start_game + the current hand. */
  async function resume() {
    const r = await call('session', {});
    Object.assign(A, { sid: r.id, serverCount: 0, reviews: 0, reviewOf: new Map(), cache: new Map() });
    let k = -1;
    for (let i = A.sent - 1; i >= 0; i--) if (A.log[i].type === 'start_kyoku') { k = i; break; }
    const idx = [0];
    if (k > 0) for (let i = k; i < A.sent; i++) idx.push(i);
    const res = await call('events', { id: A.sid, start: 0, events: idx.map(i => mask(A.log[i])) });
    idx.forEach(i => { if (isReview(A.log[i])) A.reviewOf.set(i, A.reviews++); });
    A.serverCount = res.count;
  }

  function sync() {
    if (!A.log) return A.queue;
    if (!A.sid) { reconnect(); return A.queue; }
    const gen = A.gen;
    A.queue = A.queue.then(async () => {
      while (gen === A.gen && A.sid && A.sent < A.log.length) {
        const from = A.sent, evs = A.log.slice(from);
        try {
          const r = await call('events', { id: A.sid, start: A.serverCount, events: evs.map(mask) });
          if (gen !== A.gen) return;
          evs.forEach((ev, k) => { if (isReview(ev)) A.reviewOf.set(from + k, A.reviews++); });
          A.serverCount = r.count;
          A.sent = from + evs.length;
        } catch (e) {
          if (gen !== A.gen) return;
          if ((e.status === 404 || e.status === 409 || e.status === 502) && A.resumes++ < 3) { try { await resume(); continue; } catch (e2) { A.sid = null; setStatus('error', e2.message); return; } }
          A.sid = null; A.lastAttempt = Date.now();
          setStatus('error', e.message);
          return;
        }
      }
    });
    return A.queue;
  }

  /* After a failure, try again at most every 20 s by replaying the current hand into a new session. */
  function reconnect() {
    if (A.status === 'connecting' || Date.now() - (A.lastAttempt || 0) < 20000) return;
    A.lastAttempt = Date.now();
    const gen = A.gen;
    A.sent = A.log.length;
    A.queue = A.queue.then(async () => {
      try {
        await resume();
        if (gen !== A.gen) return;
        A.resumes = 0;
        setStatus('online');
      } catch (e) {
        if (gen === A.gen) { A.sid = null; setStatus('offline', e.message); }
      }
    });
  }
  window.addEventListener('pagehide', () => {
    if (A.sid && navigator.sendBeacon) navigator.sendBeacon(API + 'close', JSON.stringify({ id: A.sid }));
  });

  /* akochan's analysis for the decision that follows the latest review point. */
  function lastReviewIndex(log) { for (let i = log.length - 1; i >= 0; i--) if (isReview(log[i])) return i; return -1; }
  async function analysis(logIdx) {
    await A.ready;
    if (!A.sid) throw new Error(A.message || 'akochan is offline.');
    await sync();
    const n = A.reviewOf.get(logIdx);
    if (n === undefined) throw new Error('This decision was not sent to akochan.');
    const key = A.sid + ':' + n;
    if (!A.cache.has(key)) {
      const sid = A.sid;
      A.cache.set(key, (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 180000) {
          const r = await call(`result?id=${sid}&n=${n}&wait=20`);
          if (r.status === 'ready') return r;
          if (r.status === 'error') throw new Error('akochan: ' + r.message);
        }
        throw new Error('akochan took longer than 3 minutes.');
      })());
      A.cache.get(key).catch(() => A.cache.delete(key));
    }
    return A.cache.get(key);
  }

  /* ---------- mapping akochan moves onto the trainer's action keys ---------- */
  const dKey = p => { const x = fromMj(p); return 'd:' + x.t + (x.aka ? '*' : ''); };
  const callKey = m => {
    if (m.type === 'pon') return 'pon';
    if (m.type === 'daiminkan') return 'kan';
    if (m.type === 'chi') return 'chi:' + m.consumed.map(p => fromMj(p).t).sort((a, b) => T.tileIndex(a) - T.tileIndex(b)).join(',');
    return null;
  };
  /* kind: 'self' | 'react' | 'afterCall' (then `made` = the call key you made). Returns candidates best-first. */
  function candidates(actions, kind, made) {
    const byKey = new Map();
    const add = (key, a, extra) => {
      const ev = a.review && typeof a.review.pt_exp_total === 'number' ? a.review.pt_exp_total : null;
      if (ev === null) return;
      const c = byKey.get(key);
      if (!c) byKey.set(key, Object.assign({ key, ev, review: a.review, moves: a.moves, variants: [{ ev, riichi: !!(extra && extra.riichi) }] }, extra));
      else {
        c.variants.push({ ev, riichi: !!(extra && extra.riichi) });
        if (ev > c.ev) Object.assign(c, { ev, review: a.review, moves: a.moves }, extra);
      }
    };
    for (const a of actions) {
      const m = a.moves || [], m0 = m[0] || {};
      if (kind === 'self') {
        if (m0.type === 'hora') add('tsumo', a);
        else if (m0.type === 'dahai') add(dKey(m0.pai), a, { riichi: false });
        else if (m0.type === 'reach' && m[1] && m[1].type === 'dahai') add(dKey(m[1].pai), a, { riichi: true });
        else if (m0.type === 'ankan') add('k:ankan:' + fromMj(m0.consumed[0]).t, a);
        else if (m0.type === 'kakan') add('k:kakan:' + fromMj(m0.pai).t, a);
        else if (m0.type === 'ryukyoku') add('kyuushu', a);
      } else if (kind === 'react') {
        if (m0.type === 'hora') add('ron', a);
        else if (m0.type === 'none') add('skip', a);
        else { const k = callKey(m0); if (k) add(k, a, { then: m[1] && m[1].type === 'dahai' ? dKey(m[1].pai) : null }); }
      } else if (kind === 'afterCall') {
        if (callKey(m0) === made && m[1] && m[1].type === 'dahai') add(dKey(m[1].pai), a);
      }
    }
    return [...byKey.values()].sort((x, y) => y.ev - x.ev);
  }

  /* Grade `key` among the options the trainer offered. threshold is in expected placement points. */
  function grade(cands, key, offered, threshold) {
    const pool = cands.filter(c => offered.has(c.key));
    const chosen = pool.find(c => c.key === key);
    if (!pool.length || !chosen) return { graded: false, reason: pool.length ? `akochan rated ${pool.length} other option${pool.length > 1 ? 's' : ''} but not this one` : `akochan's answer had no options for this decision (${cands.length} other)`, pool, chosen };
    const best = pool[0];
    const loss = Math.max(0, best.ev - chosen.ev);
    return { graded: true, correct: loss <= threshold + 1e-9, loss, best, chosen, pool, overallBest: cands[0], threshold };
  }

  global.Akochan = { state: A, start, sync, analysis, lastReviewIndex, candidates, grade, isReview };
})(window);
