/* Yaku reference lists for the hover menus. han: [closed, open]; null = not allowed open. */
(function (global) {
  const COMMON_YAKU = [
    { name: 'Riichi', jp: '立直', han: [1, null], desc: 'Declare a ready hand while closed, betting 1000 points.' },
    { name: 'Menzen Tsumo', jp: '門前清自摸和', han: [1, null], desc: 'Win by self-draw with a closed hand.' },
    { name: 'Tanyao', jp: '断幺九', han: [1, 1], desc: 'All simples: no terminals (1, 9) or honor tiles.' },
    { name: 'Pinfu', jp: '平和', han: [1, null], desc: 'Four sequences, a non-yakuhai pair, and a two-sided (ryanmen) wait. Always 20 fu tsumo / 30 fu ron.' },
    { name: 'Yakuhai', jp: '役牌', han: [1, 1], desc: 'A triplet/quad of dragons, your seat wind, or the round wind. 1 han each (double wind = 2).' },
    { name: 'Iipeikou', jp: '一盃口', han: [1, null], desc: 'Two identical sequences in the same suit (e.g. 234m 234m).' },
    { name: 'Ippatsu', jp: '一発', han: [1, null], desc: 'Win within one go-around after declaring riichi, with no calls in between.' },
    { name: 'Dora', jp: 'ドラ', han: [1, 1], desc: 'Each dora, red five (aka) or ura dora (riichi only) adds 1 han. Not a yaku by itself!' },
    { name: 'Chiitoitsu', jp: '七対子', han: [2, null], desc: 'Seven distinct pairs. Always 25 fu.' },
    { name: 'Sanshoku Doujun', jp: '三色同順', han: [2, 1], desc: 'The same sequence in all three suits (e.g. 456m 456p 456s).' },
    { name: 'Ittsu', jp: '一気通貫', han: [2, 1], desc: 'A straight 123-456-789 in one suit.' },
    { name: 'Toitoi', jp: '対々和', han: [2, 2], desc: 'All four sets are triplets or quads.' },
    { name: 'Chanta', jp: '混全帯幺九', han: [2, 1], desc: 'Every set and the pair contains a terminal or honor; includes at least one sequence.' },
    { name: 'Sanankou', jp: '三暗刻', han: [2, 2], desc: 'Three concealed triplets (a triplet completed by ron does not count as concealed).' },
    { name: 'Honitsu', jp: '混一色', han: [3, 2], desc: 'Half flush: one suit plus honor tiles.' },
    { name: 'Chinitsu', jp: '清一色', han: [6, 5], desc: 'Full flush: one suit only, no honors.' },
  ];

  const RARE_YAKU = [
    { name: 'Double Riichi', jp: 'ダブル立直', han: [2, null], desc: 'Riichi declared on your very first discard.' },
    { name: 'Haitei Raoyue', jp: '海底摸月', han: [1, 1], desc: 'Tsumo on the last tile of the wall.' },
    { name: 'Houtei Raoyui', jp: '河底撈魚', han: [1, 1], desc: 'Ron on the last discard of the round.' },
    { name: 'Rinshan Kaihou', jp: '嶺上開花', han: [1, 1], desc: 'Tsumo on the replacement tile drawn after declaring a kan.' },
    { name: 'Chankan', jp: '槍槓', han: [1, 1], desc: 'Ron on a tile another player adds to their pon to make a kan.' },
    { name: 'Sanshoku Doukou', jp: '三色同刻', han: [2, 2], desc: 'The same triplet in all three suits (e.g. 777m 777p 777s).' },
    { name: 'Sankantsu', jp: '三槓子', han: [2, 2], desc: 'Three quads (kans).' },
    { name: 'Shousangen', jp: '小三元', han: [2, 2], desc: 'Two dragon triplets plus a pair of the third dragon (plus 2 han of yakuhai).' },
    { name: 'Honroutou', jp: '混老頭', han: [2, 2], desc: 'Only terminals and honors (always pairs with toitoi or chiitoitsu).' },
    { name: 'Junchan', jp: '純全帯幺九', han: [3, 2], desc: 'Every set and the pair contains a terminal (no honors); includes at least one sequence.' },
    { name: 'Ryanpeikou', jp: '二盃口', han: [3, null], desc: 'Two sets of iipeikou (two pairs of identical sequences).' },
    { name: 'Nagashi Mangan', jp: '流し満貫', han: [5, 5], desc: 'All your discards were terminals/honors and none were called. Scored as mangan at exhaustive draw.' },
  ];

  const YAKUMAN = [
    { name: 'Kokushi Musou', jp: '国士無双', desc: 'Thirteen orphans: one of every terminal and honor plus one duplicate.' },
    { name: 'Suuankou', jp: '四暗刻', desc: 'Four concealed triplets (tsumo, or ron on a tanki wait).' },
    { name: 'Daisangen', jp: '大三元', desc: 'Triplets of all three dragons.' },
    { name: 'Shousuushii', jp: '小四喜', desc: 'Three wind triplets plus a pair of the fourth wind.' },
    { name: 'Daisuushii', jp: '大四喜', desc: 'Triplets of all four winds.' },
    { name: 'Tsuuiisou', jp: '字一色', desc: 'All honors.' },
    { name: 'Chinroutou', jp: '清老頭', desc: 'All terminals (1s and 9s only).' },
    { name: 'Ryuuiisou', jp: '緑一色', desc: 'All green: only 2,3,4,6,8 sou and green dragon.' },
    { name: 'Chuuren Poutou', jp: '九蓮宝燈', desc: 'Nine gates: 1112345678999 in one suit plus any tile of that suit.' },
    { name: 'Suukantsu', jp: '四槓子', desc: 'Four quads.' },
    { name: 'Tenhou / Chiihou', jp: '天和 / 地和', desc: 'Dealer wins on the initial deal / non-dealer wins on the first draw.' },
  ];

  global.YakuData = { COMMON_YAKU, RARE_YAKU, YAKUMAN };
})(window);
