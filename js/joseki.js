// 人の定跡（手で書いた本筋の手順）。AIの序盤はまずこれに沿って指す
// s: 先手の戦法、g: 後手の戦法（AIの戦法の指定と同じ名前）。moves は初形からのUSI
// 手順は tests でエンジンに通し、どの手も最善から大きく損していないことを確かめてある
import { Position, moveToUsi, usiToMove, typeOf, colorOf } from './shogi.js';
import { hashKey, shapeKey, rotSq } from './book.js';
import { SN_LINES } from './joseki_sn.js';
import { SJ_LINES } from './joseki_sj.js';
import { SN2_LINES } from './joseki_sn2.js';
import { SN3_LINES } from './joseki_sn3.js';
import { SN4_LINES } from './joseki_sn4.js';
import { SL_LINES } from './joseki_sl.js';
import { SL2_LINES } from './joseki_sl2.js';
import { POINTS } from './joseki_points.js';
import { EVALS } from './joseki_evals.js';
import { SUCCESS_LINES } from './joseki_success.js';

export const LINES = [
  // 相矢倉（24手組）
  { s: 'yagura', g: 'yagura', note: '相矢倉（24手組）', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 5h6g 7c7d 6h7g 4b3c 8h7i 2b3a 3g3f 4c4d' },
  // 相矢倉の手順違い（▲７六歩△３四歩▲６八銀△８四歩）
  { s: 'yagura', g: 'yagura', note: '相矢倉の手順違い（▲７六歩△３四歩▲６八銀△８四歩）', moves: '7g7f 3c3d 7i6h 8c8d' },
  // 先手矢倉 対 後手雁木
  { s: 'yagura', g: 'gangi', note: '先手矢倉 対 後手雁木', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 6c6d 5g5f 7a6b 3i4h 6b6c 4i5h 4c4d 6i7h 3a4b 5h6g 4b4c 5i6i 6a5b 6h7g 4a3b' },
  // 先手雁木 対 後手居飛車
  { s: 'gangi', g: 'ibisha', note: '先手雁木 対 後手居飛車', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 2g2f 5c5d 6h6g 4a3b 3i4h 3a4b 4g4f 5a4a 4h4g 6a5b 6i7h 7c7d 5i6i 6c6d 4i5h' },
  // 角換わり腰掛け銀
  { s: 'kakugawari', g: 'kakugawari', note: '角換わり腰掛け銀', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 3i3h 2b3c 4g4f 7a6b 3h4g 6c6d 3g3f 6b6c 2i3g 7c7d 4g5f 6c5d' },
  // 角換わり棒銀
  { s: 'bougin', g: 'kakugawari', note: '角換わり棒銀', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 2f2e 2b3c 3i3h 7a6b 3h2g 6a5b 2g2f' },
  // 相掛かり
  { s: 'aigakari', g: 'aigakari', note: '相掛かり', moves: '2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d P*2c 2d2h 8e8f 8g8f 8b8f P*8g 8f8d' },
  // 横歩取り △３三角
  { s: 'yokofu', g: 'yokofu', note: '横歩取り △３三角', moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f 8f8d 3f2f 3a2b P*8g' },
  // 先手四間飛車 対 後手居飛車
  { s: 'shiken', g: 'ibisha', note: '先手四間飛車 対 後手居飛車', moves: '7g7f 8c8d 6g6f 3c3d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 7c7d 6i5h 8d8e 8h7g' },
  // 先手三間飛車 対 後手居飛車
  { s: 'sangen', g: 'ibisha', note: '先手三間飛車 対 後手居飛車', moves: '7g7f 8c8d 6g6f 3c3d 2h7h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 7c7d 6i5h' },
  // 先手中飛車 対 後手居飛車
  { s: 'naka', g: 'ibisha', note: '先手中飛車 対 後手居飛車', moves: '7g7f 8c8d 6g6f 3c3d 5g5f 8d8e 8h7g 7a6b 2h5h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 7c7d 3i3h' },
  // 先手向かい飛車 対 後手居飛車
  { s: 'mukai', g: 'ibisha', note: '先手向かい飛車 対 後手居飛車', moves: '7g7f 8c8d 6g6f 3c3d 8h7g 7a6b 2h8h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h' },
  // 先手居飛車 対 後手四間飛車
  { s: 'ibisha', g: 'shiken', note: '先手居飛車 対 後手四間飛車', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手三間飛車
  { s: 'ibisha', g: 'sangen', note: '先手居飛車 対 後手三間飛車', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b3b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手中飛車
  { s: 'ibisha', g: 'naka', note: '先手居飛車 対 後手中飛車', moves: '7g7f 3c3d 2g2f 5c5d 2f2e 8b5b 3i4h 5d5e 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 9g9f 7a7b' },
  // 先手居飛車 対 後手向かい飛車
  { s: 'ibisha', g: 'mukai', note: '先手居飛車 対 後手向かい飛車', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b2b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 角換わり：後手が早く８五歩と突いたら▲７七角
  { s: 'kakugawari', g: 'kakugawari', note: '角換わり：後手が早く８五歩と突いたら▲７七角', moves: '7g7f 8c8d 2g2f 8d8e 8h7g 3c3d 7i8h 4a3b 6i7h 2b7g+ 8h7g 3a2b 3i3h 2b3c 4g4f 7a6b 3h4g 6c6d 3g3f 6b6c 2i3g 7c7d 4g5f 6c5d' },
  // 角換わり早繰り銀
  { s: 'kakugawari', g: 'kakugawari', note: '角換わり早繰り銀', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 3i3h 2b3c 3g3f 7a6b 3h3g 6c6d 3g4f 6b6c 3f3e' },
  // 相矢倉：後手が早く８五歩と突いたら▲７七銀
  { s: 'yagura', g: 'yagura', note: '相矢倉：後手が早く８五歩と突いたら▲７七銀', moves: '7g7f 8c8d 7i6h 8d8e 6h7g 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 5h6g 7c7d 8h7i' },
  // 矢倉：▲７七銀を早く上がり、▲２六歩と突く形
  { s: 'yagura', g: 'yagura', note: '矢倉：▲７七銀を早く上がり、▲２六歩と突く形', moves: '7g7f 8c8d 7i6h 3c3d 6h7g 7a6b 2g2f 3a4b 3i4h 5c5d 2f2e 4b3c 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 6g6f 7c7d 5h6g 2b3a 8h7i 4c4d' },
  // 先手居飛車穴熊 対 後手四間飛車
  { s: 'ibisha', g: 'shiken', note: '先手居飛車穴熊 対 後手四間飛車', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 8h7g 7b8b 9i9h 7a7b 7h8h 6a5b 8h9i 9c9d 7i8h 1c1d 6i7i' },
  // 先手居飛車 対 後手四間飛車（初手▲２六歩）
  { s: 'ibisha', g: 'shiken', note: '先手居飛車 対 後手四間飛車（初手▲２六歩）', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手三間飛車（初手▲２六歩）
  { s: 'ibisha', g: 'sangen', note: '先手居飛車 対 後手三間飛車（初手▲２六歩）', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b3b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手向かい飛車（初手▲２六歩）
  { s: 'ibisha', g: 'mukai', note: '先手居飛車 対 後手向かい飛車（初手▲２六歩）', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b2b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手石田流（三間飛車）
  { s: 'sangen', g: 'ibisha', note: '先手石田流（三間飛車）', moves: '7g7f 3c3d 7f7e 8c8d 2h7h 8d8e 5i4h 7a6b 4h3h 5a4b 3h2h 4b3b 3i3h 6a5b' },
  // 先手四間飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'shiken', g: 'ibisha', note: '先手四間飛車 対 後手居飛車（後手が△３四歩を先に突く）', moves: '7g7f 3c3d 6g6f 8c8d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 8d8e 8h7g' },
  // 先手中飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'naka', g: 'ibisha', note: '先手中飛車 対 後手居飛車（後手が△３四歩を先に突く）', moves: '7g7f 3c3d 6g6f 8c8d 5g5f 8d8e 8h7g 7a6b 2h5h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 7c7d 3i3h' },
  // 先手向かい飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'mukai', g: 'ibisha', note: '先手向かい飛車 対 後手居飛車（後手が△３四歩を先に突く）', moves: '7g7f 3c3d 6g6f 8c8d 8h7g 7a6b 2h8h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h' },
  // 相矢倉：▲２六歩には△４二銀、▲２五歩に△３三銀と受ける
  { s: 'yagura', g: 'yagura', note: '相矢倉：▲２六歩には△４二銀、▲２五歩に△３三銀と受ける', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 2g2f 3a4b 2f2e 4b3c 5g5f 5c5d 3i4h 4a3b 4i5h 5a4a 6i7h 6a5b 5i6i 7c7d 5h6g 2b3a 6h7g 4c4d 8h7i' },
  { s: 'yagura', g: 'yagura', note: '相矢倉：▲２六歩には△４二銀、▲２五歩に△３三銀と受ける', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 2g2f 3a4b 3i4h 4a3b 2f2e 4b3c 4i5h 5a4a 6i7h 6a5b 5i6i 7c7d' },
  // 先手居飛車（舟囲い・▲５七銀左）対 後手四間飛車
  { s: 'ibisha', g: 'shiken', note: '先手居飛車（舟囲い・▲５七銀左）対 後手四間飛車', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b 7i6h 6a5b 6h5g 9c9d 9g9f 1c1d 1g1f' },
  // 先手居飛車 対 後手雁木（△４四歩・△３三角から）
  { s: 'ibisha', g: 'gangi', note: '先手居飛車 対 後手雁木（△４四歩・△３三角から）', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 3a4b 6i7h 4a3b 5i6i 7a6b 9g9f 6c6d 4g4f 6b6c 4h4g 4b4c 3g3f 5a4a 5g5f 6a5b' },
  // 先手四間飛車 対 後手居飛車穴熊
  { s: 'shiken', g: 'ibisha', note: '先手四間飛車 対 後手居飛車穴熊', moves: '7g7f 8c8d 6g6f 3c3d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 2b3c 3i3h 3b2b 1g1f 1a1b 6i5h 2b1a 9g9f 3a2b' },
  // 先手三間飛車 対 後手居飛車穴熊
  { s: 'sangen', g: 'ibisha', note: '先手三間飛車 対 後手居飛車穴熊', moves: '7g7f 8c8d 6g6f 3c3d 2h7h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 2b3c 3i3h 3b2b 1g1f 1a1b 6i5h 2b1a 9g9f 3a2b' },
  // 手順違いで角換わり・相掛かりの本筋に合流する入り口
  { s: 'kakugawari', g: 'kakugawari', note: '手順違いで角換わり・相掛かりの本筋に合流する入り口', moves: '2g2f 8c8d 7g7f' },
  { s: 'yagura', g: 'yagura', note: '手順違いで角換わり・相掛かりの本筋に合流する入り口', moves: '7g7f 8c8d 2g2f 3a4b' },
  // 相矢倉24手組の続き（△６四角▲６八角△４三金右▲７九玉）
  { s: 'yagura', g: 'yagura', note: '相矢倉24手組の続き（△６四角▲６八角△４三金右▲７九玉）', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 7c7d 5h6g 6a5b 6h7g 4b3c 8h7i 2b3a 3g3f 4c4d 4h3g 3a6d 7i6h 5b4c 6i7i' },
  // 急戦矢倉（後手の端角・△８四飛）
  { s: 'yagura', g: 'yagura', note: '急戦矢倉（後手の端角・△８四飛）', moves: '7g7f 8c8d 7i6h 1c1d 1g1f 8d8e 6h7g 2b1c 3i4h 8b8d 6i7h 7a6b 5i6i 6a7a 4i5h 9c9d 9g9f 4a3b 8h7i' },
  // 先手右四間飛車 対 後手矢倉
  { s: 'migishiken', g: 'yagura', note: '先手右四間飛車 対 後手矢倉', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 2h4h 3a4b 3i3h 4a3b 4g4f 5a4a 3h4g 6a5b 6i7h 4b3c 5i6i' },
  // 後手右四間飛車（エルモ囲い）対 先手石田流
  { s: 'sangen', g: 'migishiken', note: '後手右四間飛車（エルモ囲い）対 先手石田流', moves: '7g7f 3c3d 7f7e 6c6d 2h7h 8b6b 5i4h 5a4b 4h3h 4b3b 3h2h 3a4b 3i3h 4a3a 6i5h 6a5b 9g9f' },
  // 後手一手損角換わり
  { s: 'kakugawari', g: 'kakugawari', note: '後手一手損角換わり', moves: '7g7f 3c3d 2g2f 2b8h+ 7i8h 3a2b 6i7h 2b3c 3i4h 7a6b 4g4f 6c6d 4h4g 6b6c 3g3f 4a3b 2i3g 5a4b' },
  // 対四間飛車の急戦：棒銀
  { s: 'bougin', g: 'shiken', note: '対四間飛車の急戦：棒銀', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 3i3h 7a7b 3h2g 6a5b 2g2f 9c9d 9g9f' },
  // 対四間飛車の急戦：▲４六銀右
  { s: 'ibisha', g: 'shiken', note: '対四間飛車の急戦：▲４六銀右', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 3i4h 7a7b 3g3f 6a5b 4h3g 9c9d 3g4f' },
  // 対四間飛車の急戦：▲４六銀左
  { s: 'ibisha', g: 'shiken', note: '対四間飛車の急戦：▲４六銀左', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 7i6h 7a7b 6h5g 6a5b 5g4f 9c9d' },
  // 対四間飛車の急戦：▲４五歩早仕掛け
  { s: 'ibisha', g: 'shiken', note: '対四間飛車の急戦：▲４五歩早仕掛け', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 7i6h 7a7b 6h5g 6a5b 3g3f 9c9d 2i3g 1c1d 4g4f' },
  // 対四間飛車の急戦：エルモ囲い（玉７八・金７九・銀６八）
  { s: 'elmo', g: 'shiken', note: '対四間飛車の急戦：エルモ囲い（玉７八・金７九・銀６八）', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 7i6h 7b8b 6i7i 7a7b 5g5f 6a5b 3i4h 9c9d' },
  // 先手居飛車穴熊 対 後手四間飛車（▲４八銀・▲５七銀から）
  { s: 'ibisha', g: 'shiken', note: '先手居飛車穴熊 対 後手四間飛車（▲４八銀・▲５七銀から）', moves: '7g7f 3c3d 2g2f 4c4d 3i4h 8b4b 5i6h 5a6b 2f2e 2b3c 6h7h 7a7b 5g5f 3a3b 4i5h 6b7a 4h5g 6a5b 8h7g 9c9d 7h8h 6c6d 9i9h 7c7d 8h9i 8a7c' },
  // 先手ミレニアム 対 後手四間飛車（玉８九・桂７七・金７八・銀７九）
  { s: 'millennium', g: 'shiken', note: '先手ミレニアム 対 後手四間飛車（玉８九・桂７七・金７八・銀７九）', moves: '7g7f 3c3d 2g2f 4c4d 3i4h 8b4b 5i6h 5a6b 2f2e 2b3c 6h7h 7a7b 5g5f 3a3b 4i5h 6b7a 4h5g 6a5b 7i6h 9c9d 7h7i 6c6d 8i7g 7c7d 7i8i 1c1d 6i7h 8a7c 6h7i' },
  // 先手角交換四間飛車 対 後手居飛車
  { s: 'shiken', g: 'ibisha', note: '先手角交換四間飛車 対 後手居飛車', moves: '7g7f 8c8d 2h6h 8d8e 8h7g 7a6b 5i4h 3c3d 7g2b+ 3a2b 7i8h 5a4b 8h7g 4b3b 4h3h 6a5b 3h2h 6c6d 6g6f 6b6c' },
  // 後手ダイレクト向かい飛車 対 先手居飛車
  { s: 'ibisha', g: 'mukai', note: '後手ダイレクト向かい飛車 対 先手居飛車', moves: '7g7f 3c3d 2g2f 2b8h+ 7i8h 8b2b' },
  // 先手筋違い角 対 後手居飛車
  { s: 'sujichigai', g: 'ibisha', note: '先手筋違い角 対 後手居飛車', moves: '7g7f 3c3d 8h2b+ 3a2b B*4e 7a6b 4e3d 4a3b 6g6f 2b3c 3d6g 6c6d 7i8h 6b6c 8h7g 6c5d 2h6h 4c4d 7f7e 4d4e 6i5h 3c3d 5i4h 2c2d 4h3h 3b4c 8g8f 2d2e 8f8e 8b2b' },
];

// 居飛車・定跡まかせを選んだときに使える戦法
const IBISHA_FAMILY = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'bougin', 'migishiken', 'elmo', 'millennium'];
export function fitsStrategy(tag, strategy) {
  if (strategy === 'none' || strategy === 'auto') return true;
  if (strategy === 'ibisha') return IBISHA_FAMILY.includes(tag);
  if (strategy === 'shiken') return tag === 'shiken' || tag === 'fujii'; // 藤井システムも四間飛車
  if (strategy === 'kishu') return tag === 'kishu' || tag === 'sujichigai';
  if (strategy === 'bougin') return tag === 'bougin' || tag === 'kakugawari';
  return tag === strategy;
}

// 細かい戦法：大きな戦法（base）の手順のうち、名前（note）で見分けられるもの。side を書いたものはその手番だけ
export const SUB_RULES = [
  { key: 'gokigen', base: 'naka', re: /ゴキゲン/, name: 'ゴキゲン中飛車' },
  { key: 'tsunogin', base: 'naka', re: /ツノ銀/, name: 'ツノ銀中飛車' },
  { key: 'chosoku', base: 'ibisha', re: /超速/, name: '超速（対ゴキゲン中飛車）' },
  { key: 'taigokigen', base: 'ibisha', re: /ゴキゲン/, name: '対ゴキゲン中飛車（超急戦・丸山ワクチン・穴熊など）' },
  { key: 'ibianaguma', base: 'ibisha', re: /居飛車穴熊|相穴熊|対穴熊/, name: '居飛車穴熊（対振り飛車）' },
  { key: 'yamada', base: 'ibisha', re: /山田定跡/, name: '山田定跡（対四間飛車）' },
  { key: 'sagimiya', base: 'ibisha', re: /鷺宮/, name: '鷺宮定跡（対四間飛車）' },
  { key: 'hayashikake', base: 'ibisha', re: /４五歩早仕掛け/, name: '４五歩早仕掛け（対四間飛車）' },
  { key: 'ponpon', base: 'ibisha', re: /ポンポン桂/, name: 'ポンポン桂（対四間飛車）' },
  { key: 'torisashi', base: 'ibisha', re: /鳥刺し/, name: '鳥刺し（対四間飛車）' },
  { key: 'naname', base: 'bougin', re: /斜め棒銀/, name: '斜め棒銀（対四間飛車）' },
  { key: 'kei45', base: 'kakugawari', re: /４五桂急戦/, name: '角換わり▲４五桂急戦' },
  { key: 'aigakari37kei', base: 'aigakari', re: /相掛かり▲３七桂/, name: '相掛かり▲３七桂戦法' },
  { key: 'aigakaribougin', base: 'aigakari', re: /相掛かり棒銀/, name: '相掛かり棒銀' },
  { key: 'onimukai', base: 'mukai', re: /鬼殺し向かい/, name: '鬼殺し向かい飛車' },
  { key: 'koyan', base: 'sangen', re: /コーヤン/, name: 'コーヤン流三間飛車' },
  { key: 'migigyoku', base: ['ibisha', 'kakugawari'], re: /右玉/, name: '右玉' },
  { key: 'koshikake', base: 'kakugawari', re: /腰掛け銀/, name: '角換わり腰掛け銀' },
  { key: 'hayakuri', base: ['kakugawari', 'aigakari', 'ibisha'], re: /早繰り銀/, name: '早繰り銀' },
  { key: 'ichitezon', base: 'kakugawari', re: /一手損/, side: 1, name: '一手損角換わり' },
  { key: 'aono', base: 'yokofu', re: /青野/, side: 0, name: '横歩取り青野流' },
  { key: 'waki', base: 'yagura', re: /脇システム/, name: '矢倉・脇システム' },
  { key: 'kakushiken', base: 'shiken', re: /角交換四間/, name: '角交換四間飛車' },
  { key: 'tateishi', base: 'shiken', re: /立石/, name: '立石流' },
  { key: 'furiana', base: ['shiken', 'sangen', 'naka', 'mukai'], re: /(四間飛車|三間飛車|中飛車左)穴熊/, name: '振り飛車穴熊' },
  { key: 'furimille', base: 'shiken', re: /振り飛車ミレニアム/, name: '振り飛車ミレニアム' },
  { key: 'ishida', base: 'sangen', re: /石田|升田|真部/, name: '石田流（升田式・真部流など）' },
  { key: 'kakumukai', base: 'mukai', re: /角交換向かい|ダイレクト/, name: '角交換・ダイレクト向かい飛車' },
  { key: 'aifuri', base: ['shiken', 'sangen', 'naka', 'mukai'], re: /相振り|相中飛車|相三間/, name: '相振り飛車' },
  { key: 'ureshino', base: 'kishu', re: /嬉野/, name: '嬉野流' },
];

// 手順の、手番 side の戦法の印（大きな戦法＋当てはまる細かい戦法）
export function lineTags(line, side) {
  const t = side === 0 ? line.s : line.g;
  const out = [t];
  for (const r of SUB_RULES) {
    const bases = Array.isArray(r.base) ? r.base : [r.base];
    if (bases.includes(t) && r.re.test(line.note || '') && (r.side == null || r.side === side)) out.push(r.key);
  }
  return out;
}

let tree = null; // 局面 → Map(usi → [先手の戦法の集合, 後手の戦法の集合])
let shapes = null; // 自分の駒の形 → Map(usi → 指す側の戦法の集合)

function build() {
  tree = new Map();
  shapes = new Map();
  for (const line of [...LINES, ...SN_LINES, ...SJ_LINES, ...SN2_LINES, ...SN3_LINES, ...SN4_LINES, ...SL_LINES, ...SL2_LINES]) {
    const pos = new Position();
    for (const u of line.moves.split(' ')) {
      const mv = pos.legalMoves().find((m) => moveToUsi(m) === u);
      if (!mv) { console.warn('joseki: 指せない手', u, line.moves); break; }
      const k = hashKey(pos.toSfen(false));
      if (!tree.has(k)) tree.set(k, new Map());
      const e = tree.get(k).get(u) || [new Set(), new Set()];
      for (const t of lineTags(line, 0)) e[0].add(t);
      for (const t of lineTags(line, 1)) e[1].add(t);
      tree.get(k).set(u, e);
      // 形は、駒を取る手・打つ手を除く（相手の駒に関係なく指せる駒組みの手だけ）
      if (mv.from != null && !pos.board[mv.to]) {
        const sk = pos.turn + ":" + shapeKey(pos); // 先手と後手では同じ形でも指す手が違うので分ける
        if (!shapes.has(sk)) shapes.set(sk, new Map());
        const nu = pos.turn === 0 ? u : rotSq(u); // 形は手番側が先手の向きでそろえる
        const se = shapes.get(sk).get(nu) || new Set();
        for (const t of lineTags(line, pos.turn)) se.add(t);
        shapes.get(sk).set(nu, se);
      }
      pos.applyMove(mv);
    }
  }
}

// この局面の定跡手（手番側の戦法に合うもの）: [usi]
export function josekiMoves(pos, strategy) {
  if (!tree) build();
  const m = tree.get(hashKey(pos.toSfen(false)));
  if (!m) return [];
  const me = pos.turn;
  return [...m].filter(([, tags]) => [...tags[me]].some((t) => fitsStrategy(t, strategy))).map(([u]) => u);
}

// 自分の駒の形が定跡の手順に出てくる形なら、そこで指された駒組みの手: [usi]
export function josekiShapeMoves(pos, strategy) {
  if (!shapes) build();
  const m = shapes.get(pos.turn + ":" + shapeKey(pos));
  if (!m) return [];
  return [...m].filter(([, tags]) => [...tags].some((t) => fitsStrategy(t, strategy))).map(([u]) => (pos.turn === 0 ? u : rotSq(u)));
}

// ---- 定跡の勉強用 ----
const TAG_NAMES = {
  ibisha: '居飛車', yagura: '矢倉', gangi: '雁木', kakugawari: '角換わり', aigakari: '相掛かり', yokofu: '横歩取り', bougin: '棒銀',
  migishiken: '右四間飛車', elmo: 'エルモ急戦', millennium: 'ミレニアム', shiken: '四間飛車', fujii: '藤井システム', sangen: '三間飛車',
  naka: '中飛車', mukai: '向かい飛車', sujichigai: '筋違い角', kishu: '奇襲',
};
for (const r of SUB_RULES) TAG_NAMES[r.key] = r.name;
export const tagName = (t) => TAG_NAMES[t] || t;
// 一覧の並び：大きな戦法のすぐ後に、その細かい戦法
export const STUDY_TAGS = [];
for (const t of ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'bougin', 'migishiken', 'elmo', 'millennium', 'shiken', 'fujii', 'sangen', 'naka', 'mukai', 'sujichigai', 'kishu']) {
  STUDY_TAGS.push(t);
  for (const r of SUB_RULES) if ((Array.isArray(r.base) ? r.base[0] : r.base) === t) STUDY_TAGS.push(r.key);
}

// 勉強に使う手順の一覧。同じ手順や、ほかの手順の途中までしかない手順は除く
// 手順の文字列から短い鍵を作る（定跡の勉強のポイント表 js/joseki_points.js で使う）
export function lineKey(moves) {
  let h = 5381;
  for (let i = 0; i < moves.length; i++) h = ((h * 33) ^ moves.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function studyLines() {
  const all = [...LINES, ...SN_LINES, ...SJ_LINES, ...SN2_LINES, ...SN3_LINES, ...SN4_LINES, ...SL_LINES, ...SL2_LINES];
  const uniq = [];
  for (const l of all) {
    if (all.some((o) => o !== l && o.moves.length > l.moves.length && o.moves.startsWith(l.moves + ' ') && o.s === l.s && o.g === l.g)) continue;
    if (uniq.some((o) => o.moves === l.moves)) continue;
    if (l.moves.split(' ').length < 8) continue; // 手順違いの入り口など、短すぎるものは除く
    uniq.push(l);
  }
  // かっこの中は省くが、省くと同じ題名がほかにもできるときは、かっこの中も残して見分けられるようにする
  const short = (l) => (l.note ? l.note.replace(/（.*?）/g, '') : `${tagName(l.s)} 対 ${tagName(l.g)}`);
  return uniq.map((l) => {
    const t = short(l);
    const dup = l.note && uniq.some((o) => o !== l && short(o) === t && o.note !== l.note);
    return { ...l, title: dup ? l.note : t };
  });
}

// 定跡の勉強で問題にする手（side の手番の手だけ、初手を0とした手数）。表になければ side の手を全部
export function studyPoints(l, side) {
  const p = POINTS[lineKey(l.moves)];
  const all = l.moves.split(' ').map((_, k) => k).filter((k) => k % 2 === side);
  if (p == null) return all;
  const ks = p ? p.split(',').map(Number).filter((k) => k % 2 === side) : [];
  return ks.length ? ks : all.slice(-1);
}

// この局面で、どの戦法でもよいので定跡に入っている手
export function anyJosekiMoves(pos) {
  return josekiMoves(pos, 'none');
}

// 読み込んだ棋譜の序盤を問題にするときのポイント（エンジンを使わない簡単な選び方）: side の手番の手数の一覧
// 飛車を横に動かす手、角を取る手、歩をぶつける手、駒を取る手（取り返しは除く）。少なければ自分の手を間を空けて足す
export function gamePoints(moves, side) {
  const pos = new Position();
  const cand = [];
  let prevTo = null;
  moves.forEach((u, k) => {
    const mv = usiToMove(u);
    const me = pos.turn;
    const pc = mv.drop ? null : pos.board[mv.from];
    const cap = mv.drop ? null : pos.board[mv.to];
    const recapture = prevTo != null && mv.to === prevTo && !!cap;
    let score = 0;
    if (pc && typeOf(pc) === 'R' && !cap && (mv.from % 9) !== (mv.to % 9) && Math.floor(mv.from / 9) === Math.floor(mv.to / 9)) score = 3;
    if (cap && !recapture && typeOf(cap) === 'B') score = 3;
    if (pc && typeOf(pc) === 'P' && !cap) {
      const t = pos.board[mv.to + (me === 0 ? -9 : 9)];
      if (t && colorOf(t) !== me) score = 3;
    }
    if (cap && !recapture && !score) score = 2;
    if (me === side && k >= 6 && !recapture) cand.push({ k, score });
    pos.applyMove(mv);
    prevTo = mv.to;
  });
  const want = Math.max(6, Math.ceil(cand.length / 3));
  const sel = cand.filter((c) => c.score > 0).map((c) => c.k);
  // 足りなければ、残りの自分の手からなるべく間を空けて足す
  const rest = cand.filter((c) => !sel.includes(c.k)).map((c) => c.k);
  const step = rest.length / Math.max(1, want - sel.length);
  for (let i = 0; sel.length < want && i < rest.length; i += Math.max(1, step)) sel.push(rest[Math.floor(i)]);
  return [...new Set(sel)].sort((a, b) => a - b);
}

// ---- 章立て（定跡書のように：基本図 → 成功例 → 最善を尽くして互角の変化） ----
// 定跡の手順が分かれる局面を「基本図」にし、そこから分かれる手順を、最後の局面の評価値（勉強する側から見た値）で分ける。
// +300以上：成功例（狙い筋が決まる。相手の悪手を示す）、-300以下：失敗例、そのあいだ：互角の変化。評価値は js/joseki_evals.js
export const CH_MIN_BASE = 8; // これより手前の分かれ目は章にしない
export const CH_SUCCESS = 300;
export const CH_BAD = 120; // 成功例で、相手の手がこれ以上損なら「悪手」として示す
function lineEvals(l) {
  const e = EVALS[lineKey(l.moves)];
  if (!e) return null;
  const t = e.split(' ');
  const final = t.pop();
  return { plies: t.map((x) => { if (x === '-') return null; const i = x.lastIndexOf(':'); return { best: x.slice(0, i), v: Number(x.slice(i + 1)) }; }), final: final === '-' ? null : Number(final) };
}
const shortTitle = (l) => (l.note ? l.note.replace(/（.*?）/g, '') : `${tagName(l.s)} 対 ${tagName(l.g)}`);

// 分かれ目 b からの1本の手順を、章の中の変化（成功例・互角・失敗例）にする
function chapterVar(rep, b, side) {
  const m = rep.moves.split(' ');
  if (m.length - b < 4) return null;
  const ev = lineEvals(rep);
  if (!ev || ev.final == null) return null;
  const n = m.length;
  const final = (n % 2 === side ? 1 : -1) * ev.final; // 勉強する側から見た最後の評価値
  // 相手のいちばん大きな損の手（成功例の「やらせ」の手）
  let bad = null;
  for (let k = b; k < n; k++) {
    if (k % 2 === side || !ev.plies[k]) continue;
    const after = k + 1 < n ? (ev.plies[k + 1] ? -ev.plies[k + 1].v : null) : -ev.final;
    if (after == null) continue;
    const loss = ev.plies[k].v - after;
    if (m[k] !== ev.plies[k].best && loss >= CH_BAD && (!bad || loss > bad.loss)) bad = { ply: k, best: ev.plies[k].best, loss: Math.round(loss) };
  }
  const kind = final >= CH_SUCCESS ? 'success' : final <= -CH_SUCCESS ? 'fail' : 'even';
  return { line: rep, kind, final: Math.round(final), bad: kind === 'success' ? bad : null, title: shortTitle(rep) };
}
const CH_ORDER = { success: 0, even: 1, fail: 2 };
function finishChapter(ch) {
  ch.vars.sort((x, y) => CH_ORDER[x.kind] - CH_ORDER[y.kind] || y.final - x.final);
  for (const k of ['success', 'even', 'fail']) ch[k] = ch.vars.filter((v) => v.kind === k).length;
  return ch;
}

export function josekiChapters(tag, side) {
  const lines = studyLines().filter((l) => lineTags(l, side).includes(tag));
  const kids = new Map(); // 基本図までの手順 → (次の手 → その手を通る手順)
  for (const l of lines) {
    const m = l.moves.split(' ');
    for (let b = CH_MIN_BASE; b < m.length; b++) {
      const key = m.slice(0, b).join(' ');
      if (!kids.has(key)) kids.set(key, new Map());
      const c = kids.get(key);
      if (!c.has(m[b])) c.set(m[b], []);
      c.get(m[b]).push(l);
    }
  }
  const varsAt = (key) => {
    const b = key.split(' ').length;
    const vars = [];
    for (const [, ls] of kids.get(key) || []) {
      const rep = ls.slice().sort((x, y) => y.moves.length - x.moves.length)[0];
      const v = chapterVar(rep, b, side);
      if (v) vars.push(v);
    }
    return vars;
  };
  const byKey = new Map();
  for (const [key, c] of kids) {
    if (c.size < 2) continue;
    const vars = varsAt(key);
    // 同じ定跡（題名が同じ手順）の中の分かれ目だけを章にする。別の記事の手順が手順前後で分かれて見えるだけのものは除く
    const tc = new Map();
    for (const v of vars) tc.set(v.title, (tc.get(v.title) || 0) + 1);
    const top = [...tc].sort((x, y) => y[1] - x[1])[0];
    if (!top || top[1] < 2) continue;
    byKey.set(key, { key, base: key.split(' ').length, side, title: top[0], vars: vars.filter((v) => v.title === top[0]) });
  }
  // 成功例専用の手順（相手の悪手で切った元の手順）を、定跡の手順と分かれるところの章に足す
  for (const sl of SUCCESS_LINES) {
    if (sl.side !== side || !lineTags(sl, side).includes(tag)) continue;
    const m = sl.moves.split(' ');
    let shared = 0;
    for (const l of lines) {
      const lm = l.moves.split(' ');
      let i = 0;
      while (i < lm.length && i < m.length && lm[i] === m[i]) i++;
      shared = Math.max(shared, i);
    }
    const top = Math.min(shared, sl.k);
    if (top < CH_MIN_BASE) continue;
    const v = chapterVar(sl, 0, side);
    if (!v || v.kind !== 'success') continue;
    const ev = lineEvals(sl);
    if (ev && ev.plies[sl.k]) v.bad = { ply: sl.k, best: ev.plies[sl.k].best, loss: sl.loss };
    v.extra = true;
    // いちばん深い既存の章 → 分かれ目 → 悪手の少し手前、の順に基本図を決める
    let b = top;
    while (b >= CH_MIN_BASE && !byKey.has(m.slice(0, b).join(' '))) b--;
    if (b < CH_MIN_BASE) {
      b = top;
      while (b >= CH_MIN_BASE && !((kids.get(m.slice(0, b).join(' ')) || new Map()).size >= 2)) b--;
      if (b < CH_MIN_BASE) b = Math.max(CH_MIN_BASE, sl.k - 4);
      const key = m.slice(0, b).join(' ');
      const others = varsAt(key).filter((x) => !sl.moves.startsWith(x.line.moves));
      byKey.set(key, { key, base: b, side, title: v.title, vars: others });
    }
    byKey.get(m.slice(0, b).join(' ')).vars.push(v);
  }
  const chapters = [...byKey.values()].map(finishChapter);
  // 成功例と互角の変化の両方がある章を先に、そのあとは成功例のある章、基本図の手数の順
  const rank = (c) => (c.success > 0 && c.even > 0 ? 0 : c.success > 0 ? 1 : 2);
  chapters.sort((x, y) => rank(x) - rank(y) || x.base - y.base);
  return chapters;
}
