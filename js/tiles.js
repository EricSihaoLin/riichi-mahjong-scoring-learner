/* Tile definitions and SVG rendering.
   Tile ids: "1m".."9m", "1p".."9p", "1s".."9s", "E","S","W","N","Wh","G","R" */
(function (global) {
  const SUITS = ['m', 'p', 's'];
  const HONORS = ['E', 'S', 'W', 'N', 'Wh', 'G', 'R'];
  const WINDS = ['E', 'S', 'W', 'N'];
  const DRAGONS = ['Wh', 'G', 'R'];
  const ALL_TILES = [];
  for (const s of SUITS) for (let n = 1; n <= 9; n++) ALL_TILES.push(n + s);
  ALL_TILES.push(...HONORS);

  const KANJI_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WIND_KANJI = { E: '東', S: '南', W: '西', N: '北' };
  const WIND_NAME = { E: 'East', S: 'South', W: 'West', N: 'North' };
  const HONOR_NAME = { E: 'East', S: 'South', W: 'West', N: 'North', Wh: 'White', G: 'Green', R: 'Red' };
  const SUIT_NAME = { m: 'man', p: 'pin', s: 'sou' };

  const isHonor = t => HONORS.includes(t);
  const isWind = t => WINDS.includes(t);
  const isDragon = t => DRAGONS.includes(t);
  const suitOf = t => (isHonor(t) ? null : t[1]);
  const numOf = t => (isHonor(t) ? 0 : +t[0]);
  const isTerminal = t => !isHonor(t) && (numOf(t) === 1 || numOf(t) === 9);
  const isTermOrHonor = t => isHonor(t) || isTerminal(t);
  const isSimple = t => !isTermOrHonor(t);
  const tileIndex = t => ALL_TILES.indexOf(t);

  /* Dora: the tile after the indicator. */
  function nextTile(t) {
    if (isWind(t)) return WINDS[(WINDS.indexOf(t) + 1) % 4];
    if (isDragon(t)) return DRAGONS[(DRAGONS.indexOf(t) + 1) % 3];
    const n = numOf(t); return (n === 9 ? 1 : n + 1) + suitOf(t);
  }
  function prevTile(t) {
    if (isWind(t)) return WINDS[(WINDS.indexOf(t) + 3) % 4];
    if (isDragon(t)) return DRAGONS[(DRAGONS.indexOf(t) + 2) % 3];
    const n = numOf(t); return (n === 1 ? 9 : n - 1) + suitOf(t);
  }

  function tileName(t) {
    if (isHonor(t)) return HONOR_NAME[t] + (isWind(t) ? ' wind' : ' dragon');
    return numOf(t) + ' ' + SUIT_NAME[suitOf(t)];
  }

  /* Sort: man, pin, sou, honors */
  function sortTiles(arr) {
    return arr.slice().sort((a, b) => tileIndex(a) - tileIndex(b));
  }

  /* ---------- SVG face rendering ---------- */
  const GREEN = '#2e7d32', BLUE = '#1f3f8f', RED = '#c62828', BLACK = '#1b1b1b';
  const FONT = "'Yu Mincho','MS Mincho','Noto Serif CJK JP','Noto Serif JP','Hiragino Mincho ProN',serif";

  function circle(cx, cy, r, color) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fbf8ef"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="${color}"/>`;
  }
  const PIN_LAYOUT = {
    1: [[30, 40, 18]],
    2: [[30, 22, 10], [30, 58, 10]],
    3: [[17, 20, 9], [30, 40, 9], [43, 60, 9]],
    4: [[17, 22, 9], [43, 22, 9], [17, 58, 9], [43, 58, 9]],
    5: [[16, 20, 8], [44, 20, 8], [30, 40, 8], [16, 60, 8], [44, 60, 8]],
    6: [[17, 18, 8], [43, 18, 8], [17, 40, 8], [43, 40, 8], [17, 62, 8], [43, 62, 8]],
    7: [[14, 15, 7], [30, 21, 7], [46, 27, 7], [17, 46, 7], [43, 46, 7], [17, 64, 7], [43, 64, 7]],
    8: [[17, 13, 7], [43, 13, 7], [17, 31, 7], [43, 31, 7], [17, 49, 7], [43, 49, 7], [17, 67, 7], [43, 67, 7]],
    9: [[14, 18, 7], [30, 18, 7], [46, 18, 7], [14, 40, 7], [30, 40, 7], [46, 40, 7], [14, 62, 7], [30, 62, 7], [46, 62, 7]],
  };
  function pinFace(n, aka) {
    const cols = [GREEN, BLUE];
    return PIN_LAYOUT[n].map((c, i) => {
      let color = n === 1 ? RED : cols[i % 2];
      if (n === 5 && i === 2) color = RED;
      if (n === 9 && i >= 3 && i <= 5) color = RED;
      if (n === 7 && i < 3) color = RED;
      if (aka && n === 5) color = RED;
      return circle(c[0], c[1], c[2], color);
    }).join('');
  }

  function stick(cx, cy, color, w, h) {
    const x = cx - w / 2, y = cy - h / 2;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${color}"/>` +
      `<rect x="${x}" y="${cy - 1.2}" width="${w}" height="2.4" fill="#fbf8ef"/>` +
      `<circle cx="${cx}" cy="${y + 4}" r="1.6" fill="#fbf8ef"/><circle cx="${cx}" cy="${y + h - 4}" r="1.6" fill="#fbf8ef"/>`;
  }
  const SOU_LAYOUT = {
    2: [[30, 22], [30, 58]],
    3: [[30, 20], [18, 58], [42, 58]],
    4: [[18, 22], [42, 22], [18, 58], [42, 58]],
    5: [[17, 20], [43, 20], [30, 40], [17, 60], [43, 60]],
    6: [[16, 22], [30, 22], [44, 22], [16, 58], [30, 58], [44, 58]],
    7: [[30, 15], [16, 40], [30, 40], [44, 40], [16, 64], [30, 64], [44, 64]],
    8: [[16, 15], [30, 15], [44, 15], [21, 40], [39, 40], [16, 65], [30, 65], [44, 65]],
    9: [[16, 16], [30, 16], [44, 16], [16, 40], [30, 40], [44, 40], [16, 64], [30, 64], [44, 64]],
  };
  function souFace(n, aka) {
    if (n === 1) {
      return `<ellipse cx="27" cy="46" rx="13" ry="10" fill="${GREEN}"/>
        <circle cx="40" cy="30" r="7" fill="${GREEN}"/>
        <polygon points="46,28 55,31 46,34" fill="#f4b400"/>
        <circle cx="42" cy="28" r="1.6" fill="#fff"/>
        <path d="M15 43 L6 35 M15 47 L4 47 M15 51 L6 59" stroke="${RED}" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path d="M23 56 L21 69 M31 56 L33 69" stroke="#f4b400" stroke-width="3" stroke-linecap="round"/>
        <path d="M17 44 Q28 34 38 45" stroke="#a5d6a7" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    }
    const small = n >= 6;
    const w = small ? 8 : 9, h = small ? 18 : 20;
    return SOU_LAYOUT[n].map((c, i) => {
      let color = GREEN;
      if (n === 5 && i === 2) color = RED;
      if (n === 7 && i === 0) color = RED;
      if (n === 9 && i >= 3 && i <= 5) color = RED;
      if (n === 8 && (i === 3 || i === 4)) color = RED;
      if (aka && n === 5) color = RED;
      return stick(c[0], c[1], color, w, h);
    }).join('');
  }

  function manFace(n, aka) {
    return `<text x="30" y="34" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="bold" fill="${aka ? RED : BLUE}">${KANJI_NUM[n]}</text>` +
      `<text x="30" y="68" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="bold" fill="${RED}">萬</text>`;
  }
  function honorFace(t) {
    if (t === 'Wh') return `<rect x="12" y="10" width="36" height="60" rx="5" fill="none" stroke="${BLUE}" stroke-width="3.5"/>`;
    const map = { E: ['東', BLACK], S: ['南', BLACK], W: ['西', BLACK], N: ['北', BLACK], G: ['發', GREEN], R: ['中', RED] };
    const [k, c] = map[t];
    return `<text x="30" y="55" text-anchor="middle" font-family="${FONT}" font-size="42" font-weight="bold" fill="${c}">${k}</text>`;
  }

  function faceSVG(t, aka) {
    let inner;
    if (isHonor(t)) inner = honorFace(t);
    else {
      const n = numOf(t), s = suitOf(t);
      inner = s === 'm' ? manFace(n, aka) : s === 'p' ? pinFace(n, aka) : souFace(n, aka);
    }
    return `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-label="${tileName(t)}">${inner}</svg>`;
  }

  /* HTML string for one tile. opts: {aka, back, size, rot, extraClass} */
  function tileHTML(t, opts = {}) {
    const cls = ['tile'];
    if (opts.size) cls.push('tile-' + opts.size);
    if (opts.back) cls.push('back');
    if (opts.rot) cls.push('rot');
    if (opts.extraClass) cls.push(opts.extraClass);
    if (opts.aka) cls.push('aka');
    const title = opts.back ? '' : ` title="${tileName(t)}${opts.aka ? ' (red dora)' : ''}"`;
    return `<div class="${cls.join(' ')}" data-tile="${t}"${title}>${opts.back ? '' : faceSVG(t, !!opts.aka)}</div>`;
  }

  global.Tiles = {
    SUITS, HONORS, WINDS, DRAGONS, ALL_TILES, WIND_KANJI, WIND_NAME, HONOR_NAME,
    isHonor, isWind, isDragon, suitOf, numOf, isTerminal, isTermOrHonor, isSimple, tileIndex,
    nextTile, prevTile, tileName, sortTiles, faceSVG, tileHTML,
  };
})(window);
