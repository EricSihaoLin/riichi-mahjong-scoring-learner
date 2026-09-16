/* UI: table rendering, quiz flow, chart & yaku menus. */
(function () {
  const T = window.Tiles, S = window.Scoring, H = window.Hand, Y = window.YakuData;
  const $ = s => document.querySelector(s);
  const fmt = S.fmt;
  const rand = n => Math.floor(Math.random() * n);

  /* ---------- persistent state ---------- */
  const DEFAULTS = { kiriage: false, honba: false, hideFu: false, hideHan: false, showYaku: true };
  let settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('rmsl-settings') || '{}'));
  let stats = Object.assign({ correct: 0, total: 0, streak: 0, best: 0 }, JSON.parse(localStorage.getItem('rmsl-stats') || '{}'));
  const saveSettings = () => localStorage.setItem('rmsl-settings', JSON.stringify(settings));
  const saveStats = () => localStorage.setItem('rmsl-stats', JSON.stringify(stats));

  let problem = null, answered = false, fuRevealed = false, hanRevealed = false;

  /* ---------- stage scaling ---------- */
  function scaleStage() {
    const k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    $('#stage').style.transform = `scale(${k})`;
  }
  window.addEventListener('resize', scaleStage);
  scaleStage();

  /* ---------- static table decoration ---------- */
  function drawTableLines() {
    const cx = 470, cy = 372, inner = 250, outer = 520;
    const sq = (r) => `M${cx - r} ${cy - r} H${cx + r} V${cy + r} H${cx - r} Z`;
    const diag = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => `M${cx + sx * inner} ${cy + sy * inner} L${cx + sx * outer} ${cy + sy * outer}`).join(' ');
    $('.table-lines').innerHTML = `<path d="${sq(inner)}"/><path d="${sq(outer)}"/><path d="${diag}"/>`;
    document.querySelectorAll('.wall').forEach(w => { w.innerHTML = '<i></i>'.repeat(17); });
    document.querySelectorAll('.opp-hand').forEach(o => { o.innerHTML = T.tileHTML('E', { back: true, size: 'small' }).repeat(13); });
  }

  const SEAT_OFFSET = { bottom: 0, right: 1, top: 2, left: 3 };
  const windAt = pos => T.WINDS[(T.WINDS.indexOf(problem.seatWind) + SEAT_OFFSET[pos]) % 4];
  const NAMES = { bottom: 'You', right: 'Shimocha', top: 'Toimen', left: 'Kamicha' };
  const AVATAR_BG = { bottom: 'linear-gradient(135deg,#6a8cff,#3b3f9e)', right: 'linear-gradient(135deg,#ff8f8f,#a23a5a)', top: 'linear-gradient(135deg,#9be3ff,#3c6aa8)', left: 'linear-gradient(135deg,#d9c1ff,#6c4fa8)' };

  function renderPlayers() {
    for (const pos of ['bottom', 'left', 'top', 'right']) {
      const el = $(`#player-${pos}`), w = windAt(pos), dealer = w === 'E';
      el.innerHTML = `<div class="avatar" style="background:${AVATAR_BG[pos]}">${T.WIND_KANJI[w]}${dealer ? '<div class="dealer-chip" title="Dealer">親</div>' : ''}</div>
        <div class="pname">${NAMES[pos]}</div><div class="ptitle">${pos === 'bottom' ? 'Score Learner' : 'No Title'}</div>`;
    }
  }

  function renderCompass() {
    const pts = { bottom: 25000, right: 25000, top: 25000, left: 25000 };
    const seats = Object.keys(pts);
    for (let i = 0; i < 3; i++) { const a = seats[rand(4)], b = seats[rand(4)], d = 1000 * (1 + rand(8)); pts[a] += d; pts[b] -= d; }
    const handNo = 1 + rand(4);
    let h = `<div class="inner"><div class="round">${T.WIND_NAME[problem.roundWind]} ${handNo}</div><div class="honba">× ${problem.honba} honba</div></div>`;
    for (const pos of seats) {
      const w = windAt(pos);
      h += `<div class="seat ${w === 'E' ? 'dealer' : ''} ${pos === 'bottom' ? 'me' : ''}" data-pos="${pos}" title="${T.WIND_NAME[w]} seat">${T.WIND_KANJI[w]}</div>`;
      h += `<div class="pts ${pos === 'bottom' ? 'me' : ''}" data-pos="${pos}">${fmt(pts[pos])}</div>`;
    }
    $('#compass').innerHTML = h;
  }

  function renderRoundBox() {
    const slots = problem.doraIndicators.map(t => T.tileHTML(t, { size: 'small' })).join('') +
      T.tileHTML('E', { back: true, size: 'small' }).repeat(5 - problem.doraIndicators.length);
    $('#round-box').innerHTML = `${T.tileHTML(problem.roundWind, { size: 'small', extraClass: 'round-wind' })}
      <div class="dora-slots" title="Dora indicators">${slots}</div>
      <div class="sticks"><span><i class="stick"></i>× ${problem.riichi ? 1 : 0}</span><span><i class="stick honba"></i>× ${problem.honba}</span></div>`;
  }

  function renderDiscards() {
    const pool = []; for (const t of T.ALL_TILES) for (let i = (problem.used[t] || 0); i < 4; i++) pool.push(t);
    for (const pos of ['bottom', 'left', 'top', 'right']) {
      const n = 6 + rand(9), tiles = [];
      for (let i = 0; i < n && pool.length; i++) tiles.push(pool.splice(rand(pool.length), 1)[0]);
      const riichiAt = pos === 'bottom' && problem.riichi && tiles.length > 1 ? rand(tiles.length - 1) : -1;
      $(`.discards[data-seat="${pos}"]`).innerHTML = tiles.map((t, i) => T.tileHTML(t, { size: 'mini', extraClass: i === riichiAt ? 'riichi-tile' : '' })).join('');
    }
  }

  function meldHTML(m) {
    const tile = (o, opts = {}) => T.tileHTML(o.t, Object.assign({ size: 'meld', aka: o.aka }, opts));
    let tiles;
    if (m.type === 'kan' && !m.open) {
      tiles = [tile(m.tiles[0], { back: true }), tile(m.tiles[1]), tile(m.tiles[2]), tile(m.tiles[3], { back: true })];
    } else if (m.type === 'chi') {
      const called = m.tiles[m.calledIdx], rest = m.tiles.filter((_, i) => i !== m.calledIdx);
      tiles = [tile(called, { rot: true }), ...rest.map(o => tile(o))];
    } else {
      const rotIdx = m.from === 'kamicha' ? 0 : m.from === 'toimen' ? 1 : m.tiles.length - 1;
      tiles = m.tiles.map((o, i) => tile(o, { rot: i === rotIdx }));
    }
    const label = m.type === 'kan' ? (m.open ? 'Open kan' : 'Closed kan') : m.type === 'pon' ? 'Pon' : 'Chi';
    return `<div class="meld" title="${label}${m.open ? ' from ' + m.from : ''}">${tiles.join('')}</div>`;
  }

  function renderHand() {
    const conc = problem.concealed.map(o => T.tileHTML(o.t, { size: 'hand', aka: o.aka })).join('');
    const win = T.tileHTML(problem.winTile.t, { size: 'hand', aka: problem.winTile.aka, extraClass: 'win-glow' });
    const melds = problem.melds.map(meldHTML).join('');
    $('#my-hand').innerHTML = `<div class="concealed">${conc}</div>
      <div class="win-tile"><span class="badge ${problem.tsumo ? 'tsumo' : 'ron'}">${problem.tsumo ? 'TSUMO' : 'RON'}</span>${win}</div>
      ${melds ? `<div class="melds">${melds}</div>` : ''}`;
  }

  /* ---------- quiz panel ---------- */
  const SITUATIONAL = ['Riichi', 'Ippatsu', 'Haitei Raoyue', 'Houtei Raoyui', 'Rinshan Kaihou'];

  function yakuListHTML() {
    const rows = problem.yaku.map(y => `<div class="yrow"><span>${y.name} <small style="color:var(--muted)">${y.jp}</small></span><span>${y.han >= 13 ? '<span class="ym">Yakuman</span>' : y.han + ' han'}</span></div>`).join('');
    const total = problem.yakuman ? '<span class="ym">Yakuman</span>' : `${problem.han} han`;
    return `<div class="yaku-box">${rows}<div class="yrow total"><span>Total</span><span>${total}</span></div></div>`;
  }

  function fuTipHTML() {
    const p = problem;
    const rows = p.fuDetails.map(d => `<li${d.tiles ? ` data-tiles="${d.tiles.join(',')}"${d.win ? ' data-win="1"' : ''}` : ''}><span>${d.label}</span><b>${d.fu ? '+' + d.fu : '–'}</b></li>`).join('');
    const raw = p.fuDetails.reduce((a, d) => a + d.fu, 0);
    return `<div class="tip"><div class="tip-title">How the ${p.fu} fu is counted</div><ul>${rows}</ul>
      <div class="tip-total"><span>Total${raw !== p.fu ? ` ${raw}, rounded up` : ''}</span><b>${p.fu} fu</b></div>
      <div class="tip-hint">Hover a line to highlight those tiles</div></div>`;
  }
  function hanTipHTML() {
    return `<div class="tip"><div class="tip-title">Yaku &amp; dora</div>${yakuListHTML()}</div>`;
  }

  function bindTileHighlights(sel) {
    document.querySelectorAll(sel).forEach(li => {
      li.addEventListener('mouseenter', () => highlightTiles(li.dataset.tiles.split(','), !!li.dataset.win));
      li.addEventListener('mouseleave', () => highlightTiles([]));
    });
  }

  function renderQuiz() {
    const p = problem, pay = p.payments;
    const showFu = !settings.hideFu || fuRevealed || answered;
    const showHan = !settings.hideHan || hanRevealed || answered;
    const stat = (lbl, val, cls, hidden, key, tip) => `<div class="stat${tip && !hidden ? ' has-tip' : ''}"><div class="lbl">${lbl}</div><div class="val ${cls}${hidden ? ' hidden-val' : ''}">${hidden ? '?' : val}</div>${hidden ? `<button class="reveal" data-reveal="${key}">reveal</button>` : (tip ? `<div class="hint">hover ⓘ</div>${tip}` : '')}</div>`;
    const yakuVisible = showHan && settings.showYaku && !answered;
    let h = `<h1>和了 <small>Winning hand</small></h1>
      <div class="stats-row">
        ${stat('Han', p.yakuman ? '役満' : p.han, 'hl', !showHan, 'han', yakuVisible ? '' : hanTipHTML())}
        ${stat('Fu', p.fu, 'hl', !showFu, 'fu', fuTipHTML())}
        ${stat('Win', p.tsumo ? 'Tsumo' : 'Ron', 'sm ' + (p.tsumo ? 'tsumo' : 'ron'), false)}
        ${stat('Seat', p.dealer ? 'Dealer' : 'Non-dealer', 'sm' + (p.dealer ? ' ron' : ''), false)}
      </div>`;
    if (yakuVisible) h += yakuListHTML();
    if (!showHan) {
      const sit = p.yaku.filter(y => SITUATIONAL.includes(y.name)).map(y => y.name);
      h += `<div class="yaku-box"><div class="yrow"><span>Situational yaku</span><span>${sit.length ? sit.join(', ') : 'none'}</span></div>`;
      if (p.riichi) h += `<div class="yrow"><span>Ura dora indicators</span><span style="display:flex;gap:2px">${p.uraIndicators.map(t => T.tileHTML(t, { size: 'mini' })).join('')}</span></div>`;
      h += `<div class="yrow" style="color:var(--muted);font-size:11px">Count the yaku + dora yourself (dora indicators are top-left).</div></div>`;
    }
    h += '<div class="answer">';
    if (!p.tsumo) h += `<label>Points paid by the discarder<input type="text" inputmode="numeric" data-ans="ron" placeholder="e.g. 3900"></label>`;
    else if (p.dealer) h += `<label>Each player pays (ALL)<input type="text" inputmode="numeric" data-ans="tsumoEach" placeholder="e.g. 2000"></label>`;
    else h += `<label>Each non-dealer pays<input type="text" inputmode="numeric" data-ans="tsumoNonDealer" placeholder="e.g. 1000"></label>
               <label>The dealer pays<input type="text" inputmode="numeric" data-ans="tsumoDealer" placeholder="e.g. 2000"></label>`;
    h += '</div>';
    h += `<div class="btn-row"><button class="btn" id="btn-check">Check</button><button class="btn secondary" id="btn-next">Next hand</button></div>`;
    h += `<div id="feedback"></div>`;
    h += `<div class="tally">Correct <b>${stats.correct}</b> / ${stats.total} · Streak <b>${stats.streak}</b> · Best <b>${stats.best}</b></div>`;
    $('#quiz').innerHTML = h;
    $('#btn-check').addEventListener('click', check);
    $('#btn-next').addEventListener('click', newProblem);
    document.querySelectorAll('[data-reveal]').forEach(b => b.addEventListener('click', () => { if (b.dataset.reveal === 'fu') fuRevealed = true; else hanRevealed = true; renderQuiz(); }));
    bindTileHighlights('#quiz .tip li[data-tiles]');
    const first = $('#quiz input'); if (first) first.focus();
  }

  function highlightTiles(tiles, includeWin) {
    document.querySelectorAll('#my-hand .tile').forEach(t => t.classList.remove('hl'));
    if (!tiles.length) return;
    document.querySelectorAll('#my-hand .tile:not(.back)').forEach(t => { if (tiles.includes(t.dataset.tile)) t.classList.add('hl'); });
    if (includeWin) document.querySelector('#my-hand .win-tile .tile').classList.add('hl');
  }

  function parseNum(v) { const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10); return isNaN(n) ? null : n; }

  function check() {
    if (answered) return;
    const pay = problem.payments;
    let allOk = true;
    document.querySelectorAll('#quiz input[data-ans]').forEach(inp => {
      const ok = parseNum(inp.value) === pay[inp.dataset.ans];
      inp.classList.add(ok ? 'ok' : 'bad'); inp.disabled = true;
      if (!ok) allOk = false;
    });
    answered = true;
    stats.total++;
    if (allOk) { stats.correct++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); } else stats.streak = 0;
    saveStats();
    $('#counter').innerHTML = `${stats.streak}<small> streak</small>`;
    const inputs = [...document.querySelectorAll('#quiz input[data-ans]')].map(i => [i.dataset.ans, i.value, i.classList.contains('ok')]);
    renderQuiz();
    // restore the graded inputs
    inputs.forEach(([k, v, ok]) => { const i = $(`#quiz input[data-ans="${k}"]`); i.value = v; i.disabled = true; i.classList.add(ok ? 'ok' : 'bad'); });
    $('#btn-check').disabled = true;
    $('#feedback').outerHTML = explanationHTML(allOk);
    bindTileHighlights('#feedback li[data-tiles]');
    $('#btn-next').focus();
  }

  function explanationHTML(correct) {
    const p = problem, pay = p.payments;
    let ans;
    if (!p.tsumo) ans = `Ron: ${fmt(pay.ron)}`;
    else if (p.dealer) ans = `Tsumo: ${fmt(pay.tsumoEach)} ALL (${fmt(pay.total)} total)`;
    else ans = `Tsumo: ${fmt(pay.tsumoNonDealer)} / ${fmt(pay.tsumoDealer)} (${fmt(pay.total)} total)`;

    const calc = [];
    const hanTxt = p.yakuman ? 'Yakuman' : `${p.han} han`;
    if (pay.limit) {
      if (p.yakuman) calc.push(`Yakuman → basic points <code>8,000</code>`);
      else if (p.han >= 5) calc.push(`${hanTxt} → ${pay.limit}: basic points <code>${fmt(pay.base)}</code> (fu no longer matters)`);
      else if (pay.limit.includes('kiriage')) calc.push(`${p.fu} fu × 2<sup>${p.han}+2</sup> = ${fmt(p.fu * Math.pow(2, p.han + 2))} → rounded up to mangan (kiriage): <code>2,000</code>`);
      else calc.push(`${p.fu} fu × 2<sup>${p.han}+2</sup> = ${p.fu} × ${Math.pow(2, p.han + 2)} = ${fmt(p.fu * Math.pow(2, p.han + 2))} → capped at mangan: <code>2,000</code>`);
    } else {
      calc.push(`Basic points = ${p.fu} fu × 2<sup>${p.han}+2</sup> = ${p.fu} × ${Math.pow(2, p.han + 2)} = <code>${fmt(pay.base)}</code>`);
    }
    const hb = pay.honba ? ` + ${pay.honba} honba × ${p.tsumo ? 100 : 300}` : '';
    const ru = (raw, val) => raw === val - (pay.honba ? (p.tsumo ? 100 : 300) * pay.honba : 0) ? '' : ` → round up`;
    if (!p.tsumo) {
      const raw = pay.base * (p.dealer ? 6 : 4);
      calc.push(`Ron, ${p.dealer ? 'dealer' : 'non-dealer'}: ${fmt(pay.base)} × ${p.dealer ? 6 : 4} = ${fmt(raw)}${ru(raw, pay.ron)}${hb} = <code>${fmt(pay.ron)}</code>`);
    } else if (p.dealer) {
      const raw = pay.base * 2;
      calc.push(`Dealer tsumo: everyone pays ${fmt(pay.base)} × 2 = ${fmt(raw)}${ru(raw, pay.tsumoEach)}${hb} = <code>${fmt(pay.tsumoEach)}</code> each`);
    } else {
      calc.push(`Non-dealer tsumo: each non-dealer pays ${fmt(pay.base)} × 1${ru(pay.base, pay.tsumoNonDealer)}${hb} = <code>${fmt(pay.tsumoNonDealer)}</code>; the dealer pays ${fmt(pay.base)} × 2 = ${fmt(pay.base * 2)}${ru(pay.base * 2, pay.tsumoDealer)}${hb} = <code>${fmt(pay.tsumoDealer)}</code>`);
    }

    const fuRows = p.fuDetails.map(d => `<li${d.tiles ? ` data-tiles="${d.tiles.join(',')}"${d.win ? ' data-win="1"' : ''}` : ''}>${d.label}${d.fu ? `: <b>+${d.fu}</b>` : ''}</li>`).join('');
    let h = `<div id="feedback" class="feedback ${correct ? 'correct' : 'wrong'}">
      <div class="verdict">${correct ? '✔ Correct!' : '✘ Not quite'}</div>
      <div class="ans">${ans}</div>
      <h4>Calculation</h4><ul>${calc.map(c => `<li>${c}</li>`).join('')}</ul>
      <h4>Fu breakdown (${p.fu} fu)</h4><ul>${fuRows}</ul>
      <h4>Yaku (${hanTxt})</h4>${yakuListHTML()}`;
    if (p.riichi) h += `<div style="margin-top:6px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">Ura dora indicators: ${p.uraIndicators.map(t => T.tileHTML(t, { size: 'mini' })).join('')}</div>`;
    h += '</div>';
    return h;
  }

  function newProblem() {
    problem = H.generateProblem(settings);
    answered = false; fuRevealed = false; hanRevealed = false;
    renderPlayers(); renderCompass(); renderRoundBox(); renderDiscards(); renderHand(); renderQuiz();
  }

  /* ---------- menus, chart, modals, settings ---------- */
  function yakuMenuHTML(list, title) {
    const badge = y => y.han ? `<b title="closed">${y.han[0]}</b>${y.han[1] === null ? '<i title="open">closed only</i>' : `<i title="open">${y.han[1]} open</i>`}` : '<u>Yakuman</u>';
    return `<div class="dd-title">${title}</div>` + list.map(y => `<div class="yk"><div class="nm">${y.name}<small>${y.jp}</small></div><div class="han">${badge(y)}</div><div class="ds">${y.desc}</div></div>`).join('');
  }
  $('#dd-common').innerHTML = yakuMenuHTML(Y.COMMON_YAKU, 'Common yaku · han closed / open');
  $('#dd-rare').innerHTML = yakuMenuHTML(Y.RARE_YAKU, 'Rare yaku · han closed / open') + yakuMenuHTML(Y.YAKUMAN, 'Yakuman (limit hands)');
  document.querySelectorAll('.menu > .tb-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const m = b.parentElement; const was = m.classList.contains('open'); document.querySelectorAll('.menu').forEach(x => x.classList.remove('open')); if (!was) m.classList.add('open'); }));
  document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(x => x.classList.remove('open')));

  function buildChart() { $('#chart-body').innerHTML = S.chartHTML(settings.kiriage); }
  buildChart();

  const openModal = id => $(id).classList.add('open');
  const closeModals = () => document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  $('#btn-chart').addEventListener('click', () => openModal('#modal-chart'));
  $('#btn-settings').addEventListener('click', () => openModal('#modal-settings'));
  $('#btn-help').addEventListener('click', () => openModal('#modal-help'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));

  const optMap = { 'opt-kiriage': 'kiriage', 'opt-honba': 'honba', 'opt-hidefu': 'hideFu', 'opt-hidehan': 'hideHan', 'opt-showyaku': 'showYaku' };
  for (const [id, key] of Object.entries(optMap)) {
    const el = document.getElementById(id);
    el.checked = settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked; saveSettings();
      if (key === 'kiriage') { buildChart(); if (problem && !answered) problem.payments = S.computePayments({ han: problem.han, fu: problem.fu, dealer: problem.dealer, tsumo: problem.tsumo, honba: problem.honba, kiriage: settings.kiriage }); }
      if (key === 'honba' && problem && !answered) { problem.honba = settings.honba ? rand(4) : 0; problem.payments = S.computePayments({ han: problem.han, fu: problem.fu, dealer: problem.dealer, tsumo: problem.tsumo, honba: problem.honba, kiriage: settings.kiriage }); renderCompass(); renderRoundBox(); }
      if (!answered) renderQuiz();
    });
  }
  $('#btn-reset-stats').addEventListener('click', () => { stats = { correct: 0, total: 0, streak: 0, best: 0 }; saveStats(); $('#counter').innerHTML = '0<small> streak</small>'; renderQuiz(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModals(); return; }
    if (e.key === 'Enter' && !document.querySelector('.modal.open')) { e.preventDefault(); if (answered) newProblem(); else check(); }
  });

  /* ---------- go ---------- */
  drawTableLines();
  $('#counter').innerHTML = `${stats.streak}<small> streak</small>`;
  newProblem();
})();
