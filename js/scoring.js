/* Riichi scoring: basic points, limit hands, payments and the lookup chart. */
(function (global) {
  const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];

  const roundUp100 = x => Math.ceil(x / 100) * 100;

  /* Basic points + limit name. opts.kiriage = round 4han30fu / 3han60fu up to mangan. */
  function basicPoints(han, fu, opts = {}) {
    if (han >= 13) return { base: 8000, limit: 'Yakuman' };
    if (han >= 11) return { base: 6000, limit: 'Sanbaiman' };
    if (han >= 8) return { base: 4000, limit: 'Baiman' };
    if (han >= 6) return { base: 3000, limit: 'Haneman' };
    if (han === 5) return { base: 2000, limit: 'Mangan' };
    let base = fu * Math.pow(2, han + 2);
    if (base > 2000) return { base: 2000, limit: 'Mangan' };
    if (opts.kiriage && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) return { base: 2000, limit: 'Mangan (kiriage)' };
    return { base, limit: null };
  }

  /* Returns all payment figures for a win. */
  function computePayments({ han, fu, dealer, tsumo, honba = 0, kiriage = false }) {
    const { base, limit } = basicPoints(han, fu, { kiriage });
    const res = { base, limit, han, fu, dealer, tsumo, honba };
    if (tsumo) {
      if (dealer) {
        res.tsumoEach = roundUp100(base * 2) + 100 * honba;
        res.total = res.tsumoEach * 3;
      } else {
        res.tsumoDealer = roundUp100(base * 2) + 100 * honba;
        res.tsumoNonDealer = roundUp100(base) + 100 * honba;
        res.total = res.tsumoDealer + res.tsumoNonDealer * 2;
      }
    } else {
      res.ron = roundUp100(base * (dealer ? 6 : 4)) + 300 * honba;
      res.total = res.ron;
    }
    return res;
  }

  /* Which han/fu combinations can actually occur (mirrors the dashes in the chart). */
  function comboPossible(han, fu, tsumo) {
    if (fu === 20) return tsumo && han >= 2;           // pinfu tsumo only
    if (fu === 25) return tsumo ? han >= 3 : han >= 2; // chiitoitsu (+tsumo)
    if (fu === 110 && tsumo && han < 2) return false;  // 110 fu tsumo needs a closed hand => menzen tsumo yaku + more
    return true;
  }

  const fmt = n => n.toLocaleString();

  /* Builds the lookup chart as HTML, in the style of the reference image. */
  function chartHTML(kiriage) {
    const hanCols = [1, 2, 3, 4];
    let h = '<div class="chart-wrap"><table class="score-chart"><thead>';
    h += '<tr><th colspan="4" class="hdr dealer-hdr">Dealer (親)</th><th class="hdr fu-hdr">Fu</th><th colspan="4" class="hdr nd-hdr">Non-Dealer (子)</th></tr>';
    h += '<tr>' + hanCols.slice().reverse().map(x => `<th>${x} han</th>`).join('') + '<th><span class="ron-lbl">Ron</span><span class="tsumo-lbl">Tsumo</span></th>' + hanCols.map(x => `<th>${x} han</th>`).join('') + '</tr></thead><tbody>';
    for (const fu of FU_LIST) {
      const cell = (han, dealer) => {
        const bp = basicPoints(han, fu, { kiriage });
        const isMangan = bp.limit !== null;
        const ronOk = comboPossible(han, fu, false), tsumoOk = comboPossible(han, fu, true);
        const ron = computePayments({ han, fu, dealer, tsumo: false, kiriage });
        const ts = computePayments({ han, fu, dealer, tsumo: true, kiriage });
        const cls = `fu${fu}${isMangan ? ' mangan' : ''}`;
        let ronTxt = ronOk ? fmt(ron.ron) : '–';
        let tsTxt = tsumoOk ? (dealer ? `${fmt(ts.tsumoEach)} <small>ALL</small>` : `${fmt(ts.tsumoNonDealer)}<br>${fmt(ts.tsumoDealer)}`) : '–';
        if (isMangan) { ronTxt = 'Mangan'; tsTxt = dealer ? `${fmt(ron.ron)}<br>${fmt(ts.tsumoEach)} <small>ALL</small>` : `${fmt(ron.ron)}<br>${fmt(ts.tsumoNonDealer)} / ${fmt(ts.tsumoDealer)}`; }
        return `<td class="${cls}"><div class="ron">${ronTxt}</div><div class="tsumo">${tsTxt}</div></td>`;
      };
      h += '<tr>' + hanCols.slice().reverse().map(x => cell(x, true)).join('') +
        `<th class="fu-cell">${fu} fu</th>` + hanCols.map(x => cell(x, false)).join('') + '</tr>';
    }
    h += '</tbody></table>';

    // Limit hands
    const limits = [[5, '5 han', 'Mangan'], [6, '6–7 han', 'Haneman'], [8, '8–10 han', 'Baiman'], [11, '11–12 han', 'Sanbaiman'], [13, '13+ han', 'Yakuman']];
    h += '<table class="limit-chart"><thead><tr><th>Dealer</th><th>Limit</th><th>Non-dealer</th></tr></thead><tbody>';
    for (const [han, lbl, name] of limits) {
      const dR = computePayments({ han, fu: 30, dealer: true, tsumo: false }), dT = computePayments({ han, fu: 30, dealer: true, tsumo: true });
      const nR = computePayments({ han, fu: 30, dealer: false, tsumo: false }), nT = computePayments({ han, fu: 30, dealer: false, tsumo: true });
      h += `<tr><td><div class="ron">${fmt(dR.ron)}</div><div class="tsumo">${fmt(dT.tsumoEach)} <small>ALL</small></div></td><td class="lim-name"><b>${name}</b><br><small>${lbl}</small></td><td><div class="ron">${fmt(nR.ron)}</div><div class="tsumo">${fmt(nT.tsumoNonDealer)} / ${fmt(nT.tsumoDealer)}</div></td></tr>`;
    }
    h += '</tbody></table></div>';
    return h;
  }

  global.Scoring = { FU_LIST, roundUp100, basicPoints, computePayments, comboPossible, chartHTML, fmt };
})(window);
