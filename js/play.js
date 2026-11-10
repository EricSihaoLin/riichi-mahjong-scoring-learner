/* Play Trainer UI: runs the table, asks you for decisions and has akochan grade them. */
(function () {
  const T = window.Tiles, S = window.Scoring, Y = window.YakuData, E = window.Engine, G = window.Game;
  const $ = s => document.querySelector(s);
  const fmt = S.fmt;
  const POS = ['bottom', 'right', 'top', 'left'];
  const NAMES = G.NAMES;
  const DELAY = { fast: 120, normal: 380, slow: 800 };
  const AVATAR_BG = ['linear-gradient(135deg,#6a8cff,#3b3f9e)', 'linear-gradient(135deg,#ff8f8f,#a23a5a)', 'linear-gradient(135deg,#9be3ff,#3c6aa8)', 'linear-gradient(135deg,#d9c1ff,#6c4fa8)'];

  const load = (k, d) => { try { return Object.assign({}, d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return Object.assign({}, d); } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  let settings = load('rmsl-play-settings', { mode: 'hanchan', speed: 'normal', pauseOnMistake: true, showTableOnCorrect: true, revealHands: false, threshold: 0.5, helpers: true });
  // Earlier defaults (0.05, then 0.25 pt) marked near-ties as mistakes; move anyone still on them to 0.5
  if (!settings.thresholdV3) { if (settings.threshold === 0.05 || settings.threshold === 0.25) settings.threshold = 0.5; settings.thresholdV3 = true; save('rmsl-play-settings', settings); }
  let stats = load('rmsl-play-stats', { decisions: 0, good: 0 });
  const session = { decisions: 0, good: 0, streak: 0, handDecisions: 0, handMistakes: 0 };

  let st = null;        // game state
  let awaiting = null;  // the human decision currently being asked for
  let pending = null;   // a graded-wrong choice waiting for "retry" / "keep my play"
  let history = [];     // graded decisions, newest first
  let shown = null;     // history entry shown in the review panel
  let runToken = 0;

  /* ---------- stage ---------- */
  function scaleStage() { const k = Math.min(window.innerWidth / 1280, window.innerHeight / 720); $('#stage').style.transform = `scale(${k})`; }
  window.addEventListener('resize', scaleStage);
  scaleStage();
  (function drawTableLines() {
    const cx = 470, cy = 372, inner = 250, outer = 520;
    const sq = r => `M${cx - r} ${cy - r} H${cx + r} V${cy + r} H${cx - r} Z`;
    const diag = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => `M${cx + sx * inner} ${cy + sy * inner} L${cx + sx * outer} ${cy + sy * outer}`).join(' ');
    $('.table-lines').innerHTML = `<path d="${sq(inner)}"/><path d="${sq(outer)}"/><path d="${diag}"/>`;
  })();

  /* ---------- game loop ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function run() {
    const token = ++runToken;
    const alive = () => token === runToken;
    while (alive()) {
      if (st.phase === 'end') { render(); await sleep(600); if (alive()) showHandEnd(); return; }
      if (st.phase === 'gameover') { render(); showGameOver(); return; }
      if (st.phase === 'draw') { G.draw(st); render(); continue; }
      if (st.phase === 'self') {
        const p = st.turn, legal = G.legalSelf(st, p);
        if (p === 0) {
          const me = st.players[0];
          if (me.riichi && !legal.tsumo && !legal.kans.length) {
            await sleep(DELAY[settings.speed] / 2 + 200);
            if (!alive()) return;
            G.applySelf(st, 0, { type: 'discard', id: me.drawn.id });
            render();
            continue;
          }
          beginDecision('self', legal);
          return;
        }
        await sleep(DELAY[settings.speed]);
        if (!alive()) return;
        const act = G.npcSelf(st, p, legal);
        G.applySelf(st, p, act);
        if (act.type === 'tsumo') flash(p, 'Tsumo'); else if (act.type === 'kan') flash(p, 'Kan'); else if (act.riichi) flash(p, 'Riichi');
        render();
        continue;
      }
      if (st.phase === 'react') {
        const choices = {};
        for (let q = 1; q <= 3; q++) {
          if (q === st.lastDiscard.p) continue;
          const l = G.legalReact(st, q);
          if (G.hasOptions(l)) choices[q] = G.npcReact(st, q, l);
        }
        if (st.lastDiscard.p !== 0) {
          const l0 = G.legalReact(st, 0);
          if (G.hasOptions(l0)) { beginDecision('react', l0, choices); return; }
        }
        const out = G.resolveReactions(st, choices);
        announce(out);
        render();
        if (out.type === 'call') await sleep(DELAY[settings.speed]);
        continue;
      }
      return;
    }
  }

  function announce(out) {
    if (out.type === 'ron') out.rons.forEach(q => flash(q, 'Ron'));
    else if (out.type === 'call') flash(out.caller, out.call === 'chi' ? 'Chi' : out.call === 'pon' ? 'Pon' : 'Kan');
    else if (out.type === 'abort') flash(st.lastDiscard.p, 'Abortive draw');
  }

  /* ---------- human decisions ---------- */
  const Ako = window.Akochan;
  let lastCall = null; // the call you just made, matched against akochan's "call + discard" lines

  function beginDecision(kind, legal, npc) {
    const a = { kind, legal, npc: npc || {}, res: null, hinted: false, hintKey: null, attempts: 0, mode: null, afterCall: kind === 'self' && st.afterCall, ako: null, akoError: null, waiting: false };
    awaiting = a;
    pending = null;
    if (Ako.state.status !== 'offline' && Ako.state.status !== 'error') {
      a.akoPromise = Ako.analysis(Ako.lastReviewIndex(st.mjai))
        .then(r => { a.ako = r; }, e => { a.akoError = e.message; })
        .then(() => { if (awaiting === a) render(); });
    } else a.akoError = Ako.state.message || 'akochan is offline.';
    render();
  }
  /* Our own analysis – only used for the factual comparison lines, never for the verdict. */
  function getEval() {
    if (!awaiting.res) {
      const view = G.viewFor(st, 0);
      awaiting.res = awaiting.kind === 'self' ? E.evalSelf(view, awaiting.legal) : E.evalCalls(view, st.lastDiscard.tile, awaiting.legal);
    }
    return awaiting.res;
  }
  const tileById = id => st.players[0].hand.find(x => x.id === id);
  function keyOf(c) {
    if (c.type === 'discard') { const o = tileById(c.id); return 'd:' + o.t + (o.aka ? '*' : ''); }
    if (c.type === 'kan' && c.kind) return `k:${c.kind}:${c.tile}`;
    if (c.type === 'chi') return 'chi:' + c.tiles.join(',');
    return c.type;
  }
  function offeredKeys(a) {
    const k = new Set();
    if (a.kind === 'self') {
      a.legal.discards.forEach(x => k.add('d:' + x.t + (x.aka ? '*' : '')));
      a.legal.kans.forEach(x => k.add(`k:${x.kind}:${x.tile}`));
      if (a.legal.tsumo) k.add('tsumo');
    } else {
      k.add('skip');
      if (a.legal.ron) k.add('ron');
      if (a.legal.pon) k.add('pon');
      if (a.legal.kan) k.add('kan');
      a.legal.chi.forEach(p => k.add('chi:' + p.join(',')));
    }
    return k;
  }
  const akoCands = a => Ako.candidates(a.ako.actions, a.afterCall ? 'afterCall' : a.kind, lastCall);
  function roundLabel() { return `${T.WIND_NAME[G.roundWindOf(st)]} ${(st.roundIndex % 4) + 1}`; }

  async function choose(choice) {
    if (!awaiting || pending || awaiting.waiting) return;
    const a = awaiting;
    if (a.akoPromise && !a.ako && !a.akoError) {
      a.waiting = true; render();
      await a.akoPromise;
      a.waiting = false;
      if (awaiting !== a) return;
    }
    const key = keyOf(choice), offered = offeredKeys(a), facts = getEval();
    const g = a.ako ? Ako.grade(akoCands(a), key, offered, settings.threshold) : { graded: false, reason: a.akoError || 'akochan is offline' };
    g.reasons = []; g.notes = [];
    if (g.quickKey) {
      const what = a.kind === 'react' ? 'always passes on calls' : 'just discards its most isolated tile';
      g.reason = `your hand is 4+ shanten, so akochan doesn't evaluate it – it ${what} (${keyLabel(g.quickKey)})${g.quickKey === key ? ', same as you' : ''}`;
    }
    const mine = facts.cands.find(c => c.key === key);
    const isCall = a.kind === 'react' && ['pon', 'chi', 'kan'].includes(choice.type);
    if (g.graded) {
      // Hard rules from the spec, applied on top of akochan's verdict (only when akochan also rates the play lower).
      if (isCall && mine && mine.info.noYaku && g.loss > 0) {
        g.correct = false;
        g.reasons.push('This call opens your hand with <b>no yaku</b> to aim for (no yakuhai, tanyao, honitsu or toitoi shape). An open hand without a yaku cannot win.');
      }
      if (choice.riichi && mine && mine.info.s === 0 && mine.info.live === 0) {
        g.correct = false;
        g.reasons.push(`Riichi on a <b>dead wait</b>: every winning tile (${E.chips(mine.info.waits)}) is already visible, so nothing is left to win on.`);
      }
      if (!g.correct) g.reasons.push(...E.facts(facts, key, g.best.key));
    }
    if (choice.type === 'discard') {
      const t = tileById(choice.id).t;
      if (choice.riichi && mine && mine.info.furiten && mine.info.live > 0) g.notes.push('Furiten riichi: legal, but you can only win by tsumo. Riichi itself is not graded.');
      else if (!choice.riichi && a.legal.riichi.includes(t)) g.notes.push('Riichi was available with this discard. Riichi vs. staying dama is not graded.');
    }
    if (g.graded && g.chosen && g.chosen.variants && g.chosen.variants.length > 1) {
      const r = g.chosen.variants.find(v => v.riichi), d = g.chosen.variants.find(v => !v.riichi);
      if (r && d) g.notes.push(`akochan: with riichi ${fmtEv(r.ev)} · dama ${fmtEv(d.ev)} (the better of the two is used).`);
    }
    const forced = a.kind === 'self' && st.players[0].riichi && !a.legal.tsumo; // in riichi: only a closed kan vs. tsumogiri
    const graded = g.graded && offered.size > 1 && !forced;
    const counted = graded && a.attempts === 0 && !a.hinted;
    a.attempts++;
    const entry = { g, choiceKey: key, round: roundLabel(), graded, counted, retry: a.attempts > 1, hinted: a.hinted, riichi: !!choice.riichi, seconds: a.ako && a.ako.seconds };
    history.unshift(entry);
    if (history.length > 60) history.pop();
    shown = entry;
    if (counted) {
      stats.decisions++; session.decisions++; session.handDecisions++;
      if (g.correct) { stats.good++; session.good++; session.streak++; } else { session.handMistakes++; session.streak = 0; }
      save('rmsl-play-stats', stats);
    }
    if (graded && !g.correct && settings.pauseOnMistake) { pending = choice; render(); return; }
    commit(choice);
  }
  function commit(choice) {
    const a = awaiting;
    awaiting = null; pending = null;
    if (a.kind === 'self') {
      G.applySelf(st, 0, choice);
      if (choice.type === 'tsumo') flash(0, 'Tsumo'); else if (choice.type === 'kan') flash(0, 'Kan'); else if (choice.riichi) flash(0, 'Riichi');
    } else {
      if (choice.type === 'pon' || choice.type === 'chi') lastCall = keyOf(choice);
      const choices = Object.assign({}, a.npc, { 0: choice.type === 'skip' ? null : choice });
      announce(G.resolveReactions(st, choices));
    }
    render();
    run();
  }
  function retry() { if (!pending) return; pending = null; awaiting.mode = null; render(); }
  async function hint() {
    const a = awaiting;
    if (!a || pending || a.hinted) return;
    a.hinted = true; render();
    if (a.akoPromise) await a.akoPromise;
    if (awaiting !== a || !a.ako) { render(); return; }
    const cands = akoCands(a), pool = cands.filter(c => offeredKeys(a).has(c.key));
    a.hintKey = pool.length ? pool[0].key : cands.quick && offeredKeys(a).has(cands.quick) ? cands.quick : null;
    render();
  }

  /* ---------- tile helpers: dora marks + every visible copy of the tile you hover ---------- */
  let doraSet = new Set();
  let hoverId = null;
  const doraCls = x => (settings.helpers && (x.aka || doraSet.has(x.t)) ? 'dora' : '');
  function applySeen() {
    document.querySelectorAll('.tile.seen-hl').forEach(t => t.classList.remove('seen-hl'));
    document.querySelectorAll('.seen-count').forEach(b => b.remove());
    if (!settings.helpers || hoverId === null || !st) return;
    const el = document.querySelector(`#my-hand .concealed .tile[data-id="${hoverId}"]`);
    if (!el) return;
    const kind = el.dataset.tile;
    const seen = [...document.querySelectorAll('.discards .tile, .opp-melds .tile, #my-hand .melds .tile, #round-box .dora-slots .tile')]
      .filter(t => t.dataset.tile === kind && !(t.classList.contains('back') && t.closest('.dora-slots')));
    seen.forEach(t => t.classList.add('seen-hl'));
    const mine = st.players[0].hand.filter(x => x.t === kind).length;
    const left = Math.max(0, 4 - seen.length - mine);
    el.insertAdjacentHTML('beforeend', `<span class="seen-count">${seen.length} seen · ${left} left</span>`);
  }
  $('#my-hand').addEventListener('mouseover', e => {
    const t = e.target.closest('.concealed .tile');
    const id = t ? +t.dataset.id : null;
    if (id !== hoverId) { hoverId = id; applySeen(); }
  });
  $('#my-hand').addEventListener('mouseleave', () => { hoverId = null; applySeen(); });

  /* ---------- rendering ---------- */
  const posOf = p => POS[p];
  function render() { if (st && st.mjai) Ako.sync(); doraSet = new Set(G.indicators(st).map(x => T.nextTile(x.t))); renderPlayers(); renderCompass(); renderRoundBox(); renderDiscards(); renderOpponents(); renderMyHand(); renderActions(); renderReview(); applySeen(); }

  function renderPlayers() {
    const d = G.dealerOf(st);
    for (let p = 0; p < 4; p++) {
      const pl = st.players[p], w = G.seatWindOf(st, p);
      $(`#player-${posOf(p)}`).innerHTML = `<div class="avatar${st.turn === p && st.phase !== 'end' ? ' active' : ''}" style="background:${AVATAR_BG[p]}">${T.WIND_KANJI[w]}${p === d ? '<div class="dealer-chip" title="Dealer">親</div>' : ''}</div>
        <div class="pname">${NAMES[p]}</div>${pl.riichi ? '<div class="riichi-badge">立直 RIICHI</div>' : `<div class="ptitle">${p === 0 ? 'Trainee' : 'Engine bot'}</div>`}`;
    }
  }
  function renderCompass() {
    const d = G.dealerOf(st);
    let h = `<div class="inner"><div class="round">${roundLabel()}</div><div class="honba">${st.honba} honba</div><div class="wall-left" title="Tiles left in the wall">残 ${st.wall.length}</div></div>`;
    for (let p = 0; p < 4; p++) {
      const w = G.seatWindOf(st, p), pos = posOf(p);
      h += `<div class="seat ${p === d ? 'dealer' : ''} ${p === 0 ? 'me' : ''} ${st.turn === p ? 'turn' : ''}" data-pos="${pos}">${T.WIND_KANJI[w]}</div>`;
      h += `<div class="pts ${p === 0 ? 'me' : ''}" data-pos="${pos}">${fmt(st.scores[p])}</div>`;
    }
    $('#compass').innerHTML = h;
  }
  function renderRoundBox() {
    const ind = G.indicators(st);
    const slots = ind.map(x => T.tileHTML(x.t, { size: 'small', aka: x.aka })).join('') + T.tileHTML('E', { back: true, size: 'small' }).repeat(5 - ind.length);
    $('#round-box').innerHTML = `${T.tileHTML(G.roundWindOf(st), { size: 'small' })}<div class="dora-slots" title="Dora indicators">${slots}</div>
      <div class="sticks"><span><i class="stick"></i>× ${st.sticks}</span><span><i class="stick honba"></i>× ${st.honba}</span></div>`;
  }
  function renderDiscards() {
    const ld = st.lastDiscard;
    for (let p = 0; p < 4; p++) {
      $(`.discards[data-seat="${posOf(p)}"]`).innerHTML = st.players[p].discards.map(d => {
        const cls = [d.riichi ? 'riichi-tile' : '', d.called ? 'called' : '', d.tsumogiri ? 'tsumogiri' : '', ld && ld.rec === d && st.phase === 'react' ? 'last' : ''].filter(Boolean).join(' ');
        return T.tileHTML(d.tile.t, { size: 'mini', aka: d.tile.aka, extraClass: (cls + ' ' + doraCls(d.tile)).trim() });
      }).join('');
    }
  }
  function meldHTML(m, size) {
    const tile = (o, opts = {}) => T.tileHTML(o.t, Object.assign({ size, aka: o.aka, extraClass: opts.back ? '' : doraCls(o) }, opts));
    if (m.type === 'kan' && m.kanType === 'ankan') return `<div class="meld">${m.tiles.map((o, i) => tile(o, { back: i === 0 || i === 3 })).join('')}</div>`;
    const rest = m.tiles.filter(o => o !== m.called);
    const rotIdx = m.rel === 3 ? 0 : m.rel === 2 ? 1 : rest.length;
    const seq = rest.slice();
    seq.splice(rotIdx, 0, m.called);
    return `<div class="meld">${seq.map(o => tile(o, { rot: o === m.called })).join('')}</div>`;
  }
  function renderOpponents() {
    const reveal = settings.revealHands || st.phase === 'end' || st.phase === 'gameover';
    for (let p = 1; p < 4; p++) {
      const pl = st.players[p];
      const hand = reveal ? pl.hand.map(x => T.tileHTML(x.t, { size: 'small', aka: x.aka, extraClass: doraCls(x) })).join('') : T.tileHTML('E', { back: true, size: 'small' }).repeat(pl.hand.length);
      const melds = pl.melds.map(m => meldHTML(m, 'small')).join('');
      $(`.opp-hand[data-seat="${posOf(p)}"]`).innerHTML = `<div class="opp-tiles">${hand}</div>${melds ? `<div class="opp-melds">${melds}</div>` : ''}`;
    }
  }
  function renderMyHand() {
    const me = st.players[0];
    const a = awaiting && !pending && awaiting.kind === 'self' ? awaiting : null;
    const legalIds = a ? new Set(a.legal.discards.map(x => x.id)) : new Set();
    const hintTile = a && a.hintKey && a.hintKey.startsWith('d:') ? a.hintKey.slice(2) : null;
    const one = x => {
      const cls = [];
      if (a) {
        if (!legalIds.has(x.id) || (a.mode === 'riichi' && !a.legal.riichi.includes(x.t))) cls.push('disabled');
        else cls.push('clickable');
      }
      if (hintTile && hintTile === x.t + (x.aka ? '*' : '')) cls.push('hint');
      if (x === me.drawn) cls.push('drawn');
      if (doraCls(x)) cls.push('dora');
      return T.tileHTML(x.t, { size: 'hand', aka: x.aka, extraClass: cls.join(' ') }).replace('class="tile', `data-id="${x.id}" class="tile`);
    };
    const conc = me.hand.filter(x => x !== me.drawn).map(one).join('') + (me.drawn && me.hand.includes(me.drawn) ? one(me.drawn) : '');
    const melds = me.melds.map(m => meldHTML(m, 'meld')).join('');
    $('#my-hand').innerHTML = `<div class="concealed${a && a.mode === 'riichi' ? ' riichi-mode' : ''}">${conc}</div>${melds ? `<div class="melds">${melds}</div>` : ''}`;
    $('#my-hand').querySelectorAll('.tile.clickable').forEach(el => el.addEventListener('click', () => {
      const id = +el.dataset.id;
      choose({ type: 'discard', id, riichi: awaiting.mode === 'riichi' });
    }));
  }

  function renderActions() {
    const box = $('#actions');
    const a = awaiting && !pending ? awaiting : null;
    if (!a) { box.innerHTML = ''; return; }
    const hk = a.hintKey;
    const btn = (cls, label, key, extra = '') => `<button class="act-btn ${cls}${hk === key ? ' hint' : ''}" data-act="${key}" ${extra}>${label}</button>`;
    let h = '';
    if (a.kind === 'self') {
      const l = a.legal;
      if (a.mode === 'kan') {
        h += l.kans.map(k => `<button class="act-opt${hk === `k:${k.kind}:${k.tile}` ? ' hint' : ''}" data-kan="${k.kind}:${k.tile}">${T.tileHTML(k.tile, { size: 'inline' }).repeat(4)}<span>${k.kind === 'ankan' ? 'closed' : 'added'}</span></button>`).join('');
        h += btn('skip', 'Back', 'back');
      } else {
        if (l.kans.length) h += btn('kan', 'Kan', l.kans.length === 1 ? `k:${l.kans[0].kind}:${l.kans[0].tile}` : 'kanmenu');
        if (l.riichi.length) h += btn('riichi' + (a.mode === 'riichi' ? ' on' : ''), a.mode === 'riichi' ? 'Cancel' : 'Riichi', 'riichi');
        if (l.tsumo) h += btn('tsumo', 'Tsumo', 'tsumo');
      }
    } else {
      const l = a.legal;
      if (a.mode === 'chi') {
        h += l.chi.map(pair => { const key = 'chi:' + pair.join(','); return `<button class="act-opt${hk === key ? ' hint' : ''}" data-chi="${pair.join(',')}">${pair.map(t => T.tileHTML(t, { size: 'inline' })).join('')}</button>`; }).join('');
        h += btn('skip', 'Back', 'back');
      } else {
        if (l.chi.length) h += btn('chi', 'Chi', l.chi.length === 1 ? 'chi:' + l.chi[0].join(',') : 'chimenu' + (hk && hk.startsWith('chi:') ? '' : ''));
        if (l.pon) h += btn('pon', 'Pon', 'pon');
        if (l.kan) h += btn('kan', 'Kan', 'kan');
        if (l.ron) h += btn('ron', 'Ron', 'ron');
        h += btn('skip', 'Skip', 'skip');
      }
    }
    box.innerHTML = h;
    if (a.kind === 'react' && a.mode !== 'chi' && hk && hk.startsWith('chi:') && a.legal.chi.length > 1) { const b = box.querySelector('[data-act="chimenu"]'); if (b) b.classList.add('hint'); }
    if (a.kind === 'self' && !a.mode && hk && hk.startsWith('k:') && a.legal.kans.length > 1) { const b = box.querySelector('[data-act="kanmenu"]'); if (b) b.classList.add('hint'); }
    box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => onAction(b.dataset.act)));
    box.querySelectorAll('[data-chi]').forEach(b => b.addEventListener('click', () => choose({ type: 'chi', tiles: b.dataset.chi.split(',') })));
    box.querySelectorAll('[data-kan]').forEach(b => b.addEventListener('click', () => { const [kind, tile] = b.dataset.kan.split(':'); choose({ type: 'kan', kind, tile }); }));
  }
  function onAction(act) {
    const a = awaiting;
    if (!a || pending) return;
    if (act === 'back') { a.mode = null; render(); return; }
    if (act === 'riichi') { a.mode = a.mode === 'riichi' ? null : 'riichi'; render(); return; }
    if (act === 'kanmenu') { a.mode = 'kan'; render(); return; }
    if (act === 'chimenu') { a.mode = 'chi'; render(); return; }
    if (act.startsWith('k:')) { const [, kind, tile] = act.split(':'); choose({ type: 'kan', kind, tile }); return; }
    if (act.startsWith('chi:')) { choose({ type: 'chi', tiles: act.slice(4).split(',') }); return; }
    choose({ type: act });
  }

  /* ---------- review panel ---------- */
  const fmtEv = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  function keyLabel(key) {
    if (key.startsWith('d:')) return 'Discard ' + E.chip(key.slice(2).replace('*', ''), key.endsWith('*'));
    if (key.startsWith('k:')) { const [, kind, t] = key.split(':'); return (kind === 'ankan' ? 'Closed kan ' : 'Added kan ') + E.chip(t); }
    if (key.startsWith('chi:')) return 'Chi ' + key.slice(4).split(',').map(t => E.chip(t)).join('');
    return { tsumo: 'Tsumo', ron: 'Ron', pon: 'Pon', kan: 'Kan', skip: 'Skip', kyuushu: 'Nine-terminal draw' }[key] || key;
  }
  function candTable(g) {
    const rows = g.pool.slice(0, 5);
    if (g.chosen && !rows.includes(g.chosen)) rows.push(g.chosen);
    return `<table class="cand-table ev"><thead><tr><th>akochan</th><th>EV</th><th>vs best</th><th>deal-in</th></tr></thead><tbody>${rows.map(c => {
      const loss = g.best.ev - c.ev;
      const risk = c.review && typeof c.review.total_houjuu_hai_prob_now === 'number' ? (c.review.total_houjuu_hai_prob_now * 100).toFixed(1) + '%' : '–';
      const t = c.key.startsWith('d:') ? c.key.slice(2).replace('*', '') : '';
      const extra = (c.riichi ? ' <small>riichi</small>' : '') + (c.then ? ` <small>then ${keyLabel(c.then).replace('Discard ', '')}</small>` : '');
      return `<tr class="${loss <= g.threshold + 1e-9 ? 'acc' : ''}${g.chosen && c.key === g.chosen.key ? ' mine' : ''}"${t ? ` data-hl="${t}"` : ''}><td class="lbl">${keyLabel(c.key)}${extra}</td><td class="num">${fmtEv(c.ev)}</td><td class="num">${loss > 0.0005 ? '−' + loss.toFixed(2) : '—'}</td><td class="num">${risk}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function cardHTML(e) {
    const { g } = e;
    const tags = `${e.retry ? ' <small>retry · not counted</small>' : ''}${e.hinted ? ' <small>hint used · not counted</small>' : ''}`;
    if (!e.graded) {
      const why = !g.graded ? g.reason : 'no real alternative';
      return `<div class="feedback neutral"><div class="verdict">• ${keyLabel(e.choiceKey)} <small>not graded – ${why}</small></div>${g.notes.length ? `<div class="notes">${g.notes.join('<br>')}</div>` : ''}${g.graded ? candTable(g) : ''}</div>`;
    }
    const ok = g.correct, isBest = g.chosen.key === g.best.key;
    let h = `<div class="feedback ${ok ? 'correct' : 'wrong'}"><div class="verdict">${ok ? (isBest ? '✔ Matches akochan' : `✔ Accepted <small>−${g.loss.toFixed(2)} pt</small>`) : `✘ Mistake <small>−${g.loss.toFixed(2)} pt</small>`}${e.riichi ? ' <small>with riichi</small>' : ''}${tags}</div>`;
    h += `<div class="cmp">You: <b>${keyLabel(g.chosen.key)}</b>${isBest ? '' : ` · akochan: <b>${keyLabel(g.best.key)}</b>`}</div>`;
    if (g.reasons.length) h += `<div class="facts-title">What differs</div><ul class="reasons">${g.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
    else if (!ok) h += '<div class="notes">No simple factor (shanten, acceptance, waits, safety, dora) separates the two – akochan\'s search also weighs future draws, opponents\' hands and placement.</div>';
    if (g.notes.length) h += `<div class="notes">${g.notes.join('<br>')}</div>`;
    if (!ok || settings.showTableOnCorrect) h += candTable(g);
    h += `<div class="rule">EV = akochan's expected placement points. A play is a mistake when it loses more than ${g.threshold} pt against akochan's best.${e.seconds ? ` · analysed in ${e.seconds.toFixed(1)} s` : ''}</div></div>`;
    return h;
  }
  function engineLine() {
    const s = Ako.state;
    if (s.status === 'online') {
      if (!awaiting || pending || awaiting.ako) return '';
      if (awaiting.akoError) return `<div class="engine-line bad">akochan: ${awaiting.akoError} – this decision won't be graded.</div>`;
      return `<div class="engine-line busy">${awaiting.waiting ? 'Waiting for akochan to finish this decision…' : 'akochan is analysing…'}</div>`;
    }
    if (s.status === 'connecting') return '<div class="engine-line busy">Connecting to akochan…</div>';
    return `<div class="engine-line bad">akochan is offline (${s.message || s.status}). Decisions are <b>not graded</b> until the engine service is running – see deploy/DEPLOY.md.</div>`;
  }
  function promptHTML() {
    if (!awaiting) return `<div class="prompt muted">${st.phase === 'end' || st.phase === 'gameover' ? 'Hand over.' : 'Opponents are playing…'}</div>`;
    if (pending) return '';
    if (awaiting.kind === 'self') {
      const l = awaiting.legal;
      let s = awaiting.mode === 'riichi' ? 'Riichi: choose the tile to discard (only tiles that keep tenpai are enabled).' : st.afterCall ? 'Choose a tile to discard after your call.' : 'Your turn: click a tile to discard.';
      const extra = [l.tsumo ? 'Tsumo is available' : '', l.riichi.length && awaiting.mode !== 'riichi' ? 'Riichi is available' : '', l.kans.length ? 'Kan is available' : ''].filter(Boolean);
      if (extra.length) s += ` <b>${extra.join(' · ')}</b>`;
      return `<div class="prompt">${s}</div>`;
    }
    const ld = st.lastDiscard;
    return `<div class="prompt">${NAMES[ld.p]} discarded ${E.chip(ld.tile.t, ld.tile.aka)}. Call or skip?</div>`;
  }
  function renderReview() {
    const acc = session.decisions ? Math.round(100 * session.good / session.decisions) + '%' : '–';
    const life = stats.decisions ? Math.round(100 * stats.good / stats.decisions) + '%' : '–';
    let h = `<h1>打牌 <small>Play Trainer · graded by akochan</small></h1>
      <div class="stats-row">
        <div class="stat"><div class="lbl">Accuracy</div><div class="val hl">${acc}</div></div>
        <div class="stat"><div class="lbl">Decisions</div><div class="val">${session.good}<small>/${session.decisions}</small></div></div>
        <div class="stat"><div class="lbl">This hand</div><div class="val sm">${session.handMistakes} miss${session.handMistakes === 1 ? '' : 'es'}</div></div>
        <div class="stat" title="All games on this browser"><div class="lbl">Lifetime</div><div class="val sm">${life}</div></div>
      </div>`;
    h += engineLine() + promptHTML();
    const btns = [];
    if (pending) btns.push('<button class="btn secondary" id="btn-retry">↺ Retry</button>', '<button class="btn" id="btn-keep">Keep my play ▶</button>');
    else if (awaiting && Ako.state.status === 'online') btns.push(`<button class="btn secondary" id="btn-hint"${awaiting.hinted ? ' disabled' : ''}>${awaiting.hinted ? (awaiting.hintKey ? 'Hint shown' : 'Waiting for akochan…') : 'Hint'}</button>`);
    if (btns.length) h += `<div class="btn-row">${btns.join('')}</div>`;
    if (shown) h += cardHTML(shown);
    if (history.length) {
      h += `<div class="history"><div class="hist-title">Decisions</div>${history.map((e, i) => `<div class="hist ${!e.graded ? 'ng' : e.g.correct ? 'ok' : 'bad'}${e === shown ? ' sel' : ''}" data-h="${i}"><span>${e.round}</span><span class="what">${keyLabel(e.choiceKey)}</span><span class="rt">${e.graded ? (e.g.loss > 0.0005 ? '−' + e.g.loss.toFixed(2) : '0') : '–'}</span><span class="mark">${!e.graded ? '·' : e.g.correct ? '✔' : '✘'}</span></div>`).join('')}</div>`;
    }
    $('#review').innerHTML = h;
    const on = (id, f) => { const el = $(id); if (el) el.addEventListener('click', f); };
    on('#btn-retry', retry);
    on('#btn-keep', () => commit(pending));
    on('#btn-hint', hint);
    document.querySelectorAll('#review .hist').forEach(el => el.addEventListener('click', () => { shown = history[+el.dataset.h]; renderReview(); }));
    document.querySelectorAll('#review tr[data-hl]').forEach(tr => {
      tr.addEventListener('mouseenter', () => document.querySelectorAll('#my-hand .concealed .tile').forEach(t => t.classList.toggle('hl', t.dataset.tile === tr.dataset.hl)));
      tr.addEventListener('mouseleave', () => document.querySelectorAll('#my-hand .tile.hl').forEach(t => t.classList.remove('hl')));
    });
  }

  /* ---------- callouts ---------- */
  const CALL_AT = [[470, 540], [770, 372], [470, 190], [170, 372]];
  function flash(p, text) {
    const el = document.createElement('div');
    el.className = 'callout';
    el.textContent = text;
    el.style.left = CALL_AT[p][0] + 'px';
    el.style.top = CALL_AT[p][1] + 'px';
    $('#callouts').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /* ---------- end of hand / game ---------- */
  const limitText = pay => pay.limit || `${pay.fu} fu ${pay.han} han`;
  function payText(info) {
    const p = info.payments;
    if (!info.tsumo) return fmt(p.ron);
    return p.tsumoEach ? `${fmt(p.tsumoEach)} all` : `${fmt(p.tsumoNonDealer)} / ${fmt(p.tsumoDealer)}`;
  }
  function winHTML(w) {
    const info = w.info;
    const conc = info.concealed.slice().sort((a, b) => T.tileIndex(a.t) - T.tileIndex(b.t)).map(x => T.tileHTML(x.t, { size: 'meld', aka: x.aka })).join('');
    const win = T.tileHTML(info.winTile.t, { size: 'meld', aka: info.winTile.aka, extraClass: 'win-glow' });
    const melds = info.melds.map(m => meldHTML(m, 'small')).join('');
    const yaku = info.yaku.map(y => `<div class="yrow"><span>${y.name} <small style="color:var(--muted)">${y.jp}</small></span><span>${y.han >= 13 ? '<span class="ym">Yakuman</span>' : y.han + ' han'}</span></div>`).join('');
    const ura = info.riichi ? `<div class="ind-row">Ura dora indicators: ${st.result.ura.map(x => T.tileHTML(x.t, { size: 'mini' })).join('')}</div>` : '';
    return `<div class="win-block">
      <h2>${NAMES[w.p]} ${w.p === 0 ? 'win' : 'wins'} by ${info.tsumo ? 'Tsumo' : `Ron from ${NAMES[w.from]}`}</h2>
      <div class="end-hand">${conc}<span class="gap"></span>${win}${melds ? `<span class="gap"></span>${melds}` : ''}</div>
      <div class="yaku-box">${yaku}<div class="yrow total"><span>${info.yakuman ? 'Yakuman' : limitText(info.payments)}</span><span>${payText(info)}</span></div></div>
      <div class="ind-row">Dora indicators: ${G.indicators(st).map(x => T.tileHTML(x.t, { size: 'mini', aka: x.aka })).join('')}</div>${ura}
    </div>`;
  }
  function deltasHTML(deltas) {
    return `<div class="deltas">${[0, 1, 2, 3].map(p => `<div class="dl"><span>${NAMES[p]}</span><b class="${deltas[p] > 0 ? 'up' : deltas[p] < 0 ? 'down' : ''}">${deltas[p] > 0 ? '+' : ''}${fmt(deltas[p])}</b><small>${fmt(st.scores[p])}</small></div>`).join('')}</div>`;
  }
  function handSummaryHTML() {
    return `<div class="hand-sum">Your decisions this hand: <b>${session.handDecisions - session.handMistakes}</b> / ${session.handDecisions} accurate</div>`;
  }
  function showHandEnd() {
    const r = st.result;
    let h = '';
    if (r.type === 'win') h += r.wins.map(winHTML).join('') + (r.sticksWon ? `<div class="ind-row">${NAMES[r.wins[0].p]} also collects ${r.sticksWon} riichi stick${r.sticksWon > 1 ? 's' : ''}.</div>` : '');
    else {
      h += `<h2>${r.reason}</h2>`;
      if (!r.abortive) h += `<div class="ind-row">${r.tenpai.length ? 'Tenpai: ' + r.tenpai.map(p => NAMES[p]).join(', ') : 'Nobody is tenpai.'}</div>`;
    }
    h += deltasHTML(r.deltas) + handSummaryHTML();
    h += `<div class="btn-row"><button class="btn" id="btn-next-hand">Next hand</button></div>`;
    $('#end-body').innerHTML = h;
    $('#modal-end').classList.add('open');
    $('#btn-next-hand').addEventListener('click', nextHand);
    $('#btn-next-hand').focus();
  }
  function nextHand() {
    $('#modal-end').classList.remove('open');
    G.nextHand(st);
    session.handDecisions = 0; session.handMistakes = 0;
    awaiting = null; pending = null;
    if (st.phase === 'gameover') { render(); showGameOver(); return; }
    run();
  }
  function showGameOver() {
    const order = G.ranking(st);
    const acc = session.decisions ? Math.round(100 * session.good / session.decisions) : 0;
    $('#end-body').innerHTML = `<h2>Game over</h2>
      <div class="standings">${order.map((p, i) => `<div class="dl${p === 0 ? ' me' : ''}"><span>${i + 1}${['st', 'nd', 'rd', 'th'][i]} · ${NAMES[p]}</span><b>${fmt(st.scores[p])}</b></div>`).join('')}</div>
      <div class="hand-sum">Accuracy this game: <b>${acc}%</b> (${session.good} / ${session.decisions} decisions)</div>
      <div class="btn-row"><button class="btn" id="btn-again">New game</button></div>`;
    $('#modal-end').classList.add('open');
    $('#btn-again').addEventListener('click', newGame);
  }

  function newGame() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    st = G.newGame(settings.mode);
    lastCall = null;
    Ako.start(st.mjai);
    Object.assign(session, { decisions: 0, good: 0, streak: 0, handDecisions: 0, handMistakes: 0 });
    history = []; shown = null; awaiting = null; pending = null;
    $('#mode-label').textContent = settings.mode === 'tonpuu' ? '4-Player East' : '4-Player South';
    run();
  }

  /* ---------- menus, chart, modals, settings ---------- */
  function yakuMenuHTML(list, title) {
    const badge = y => y.han ? `<b title="closed">${y.han[0]}</b>${y.han[1] === null ? '<i title="open">closed only</i>' : `<i title="open">${y.han[1]} open</i>`}` : '<u>Yakuman</u>';
    return `<div class="dd-title">${title}</div>` + list.map(y => `<div class="yk"><div class="nm">${y.name}<small>${y.jp}</small></div><div class="han">${badge(y)}</div><div class="ds">${y.desc}</div></div>`).join('');
  }
  $('#dd-common').innerHTML = yakuMenuHTML(Y.COMMON_YAKU, 'Common yaku · han closed / open');
  $('#dd-rare').innerHTML = yakuMenuHTML(Y.RARE_YAKU, 'Rare yaku · han closed / open') + yakuMenuHTML(Y.YAKUMAN, 'Yakuman (limit hands)');
  document.querySelectorAll('.menu > .tb-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const m = b.parentElement, was = m.classList.contains('open'); document.querySelectorAll('.menu').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); }));
  document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(x => x.classList.remove('open')));
  $('#chart-body').innerHTML = S.chartHTML(false);

  const closeModals = () => document.querySelectorAll('.modal:not(#modal-end)').forEach(m => m.classList.remove('open'));
  $('#btn-chart').addEventListener('click', () => $('#modal-chart').classList.add('open'));
  $('#btn-settings').addEventListener('click', () => $('#modal-settings').classList.add('open'));
  $('#btn-help').addEventListener('click', () => $('#modal-help').classList.add('open'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal:not(#modal-end)').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

  const saveSettings = () => save('rmsl-play-settings', settings);
  $('#opt-mode').value = settings.mode;
  $('#opt-speed').value = settings.speed;
  $('#opt-threshold').value = String(settings.threshold);
  $('#opt-threshold').addEventListener('change', e => { settings.threshold = +e.target.value; saveSettings(); });
  const checks = { 'opt-pause': 'pauseOnMistake', 'opt-table': 'showTableOnCorrect', 'opt-reveal': 'revealHands', 'opt-helpers': 'helpers' };
  for (const [id, key] of Object.entries(checks)) {
    const el = document.getElementById(id);
    el.checked = settings[key];
    el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); if (st) render(); });
  }
  $('#opt-mode').addEventListener('change', e => { settings.mode = e.target.value; saveSettings(); });
  $('#opt-speed').addEventListener('change', e => { settings.speed = e.target.value; saveSettings(); });
  $('#btn-new-game').addEventListener('click', newGame);
  $('#btn-reset-stats').addEventListener('click', () => { stats = { decisions: 0, good: 0 }; save('rmsl-play-stats', stats); if (st) renderReview(); });

  Ako.state.onChange = () => { if (st) renderReview(); };
  window.PlayTrainer = { get state() { return st; }, get awaiting() { return awaiting; } }; // for debugging in the console
  newGame();
})();
