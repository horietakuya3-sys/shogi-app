// 人の定跡（手で書いた本筋の手順）。AIの序盤はまずこれに沿って指す
// s: 先手の戦法、g: 後手の戦法（AIの戦法の指定と同じ名前）。moves は初形からのUSI
// 手順は tests でエンジンに通し、どの手も最善から大きく損していないことを確かめてある
import { Position, moveToUsi } from './shogi.js';
import { hashKey, shapeKey, rotSq } from './book.js';

export const LINES = [
  // 相矢倉（24手組）
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 5h6g 7c7d 6h7g 4b3c 8h7i 2b3a 3g3f 4c4d' },
  // 相矢倉の手順違い（▲７六歩△３四歩▲６八銀△８四歩）
  { s: 'yagura', g: 'yagura', moves: '7g7f 3c3d 7i6h 8c8d' },
  // 先手矢倉 対 後手雁木
  { s: 'yagura', g: 'gangi', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 6c6d 5g5f 7a6b 3i4h 6b6c 4i5h 4c4d 6i7h 3a4b 5h6g 4b4c 5i6i 6a5b 6h7g 4a3b' },
  // 先手雁木 対 後手居飛車
  { s: 'gangi', g: 'ibisha', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 2g2f 5c5d 6h6g 4a3b 3i4h 3a4b 4g4f 5a4a 4h4g 6a5b 6i7h 7c7d 5i6i 6c6d 4i5h' },
  // 角換わり腰掛け銀
  { s: 'kakugawari', g: 'kakugawari', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 3i3h 2b3c 4g4f 7a6b 3h4g 6c6d 3g3f 6b6c 2i3g 7c7d 4g5f 6c5d' },
  // 角換わり棒銀
  { s: 'bougin', g: 'kakugawari', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 2f2e 2b3c 3i3h 7a6b 3h2g 6a5b 2g2f' },
  // 相掛かり
  { s: 'aigakari', g: 'aigakari', moves: '2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d P*2c 2d2h 8e8f 8g8f 8b8f P*8g 8f8d' },
  // 横歩取り △３三角
  { s: 'yokofu', g: 'yokofu', moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f 8f8d 3f2f 3a2b P*8g' },
  // 先手四間飛車 対 後手居飛車
  { s: 'shiken', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 7c7d 6i5h 8d8e 8h7g' },
  // 先手三間飛車 対 後手居飛車
  { s: 'sangen', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 2h7h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 7c7d 6i5h' },
  // 先手中飛車 対 後手居飛車
  { s: 'naka', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 5g5f 8d8e 8h7g 7a6b 2h5h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 7c7d 3i3h' },
  // 先手向かい飛車 対 後手居飛車
  { s: 'mukai', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 8h7g 7a6b 2h8h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h' },
  // 先手居飛車 対 後手四間飛車
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手三間飛車
  { s: 'ibisha', g: 'sangen', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b3b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手中飛車
  { s: 'ibisha', g: 'naka', moves: '7g7f 3c3d 2g2f 5c5d 2f2e 8b5b 3i4h 5d5e 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 9g9f 7a7b' },
  // 先手居飛車 対 後手向かい飛車
  { s: 'ibisha', g: 'mukai', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b2b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 角換わり：後手が早く８五歩と突いたら▲７七角
  { s: 'kakugawari', g: 'kakugawari', moves: '7g7f 8c8d 2g2f 8d8e 8h7g 3c3d 7i8h 4a3b 6i7h 2b7g+ 8h7g 3a2b 3i3h 2b3c 4g4f 7a6b 3h4g 6c6d 3g3f 6b6c 2i3g 7c7d 4g5f 6c5d' },
  // 角換わり早繰り銀
  { s: 'kakugawari', g: 'kakugawari', moves: '7g7f 8c8d 2g2f 4a3b 6i7h 8d8e 8h7g 3c3d 7i8h 2b7g+ 8h7g 3a2b 3i3h 2b3c 3g3f 7a6b 3h3g 6c6d 3g4f 6b6c 3f3e' },
  // 相矢倉：後手が早く８五歩と突いたら▲７七銀
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 8d8e 6h7g 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 5h6g 7c7d 8h7i' },
  // 矢倉：▲７七銀を早く上がり、▲２六歩と突く形
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6h7g 7a6b 2g2f 3a4b 3i4h 5c5d 2f2e 4b3c 4i5h 4a3b 6i7h 5a4a 5i6i 6a5b 6g6f 7c7d 5h6g 2b3a 8h7i 4c4d' },
  // 先手居飛車穴熊 対 後手四間飛車
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 8h7g 7b8b 9i9h 7a7b 7h8h 6a5b 8h9i 9c9d 7i8h 1c1d 6i7i' },
  // 先手居飛車 対 後手四間飛車（初手▲２六歩）
  { s: 'ibisha', g: 'shiken', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手三間飛車（初手▲２六歩）
  { s: 'ibisha', g: 'sangen', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b3b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手居飛車 対 後手向かい飛車（初手▲２六歩）
  { s: 'ibisha', g: 'mukai', moves: '2g2f 3c3d 7g7f 4c4d 2f2e 2b3c 3i4h 8b2b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b' },
  // 先手石田流（三間飛車）
  { s: 'sangen', g: 'ibisha', moves: '7g7f 3c3d 7f7e 8c8d 2h7h 8d8e 5i4h 7a6b 4h3h 5a4b 3h2h 4b3b 3i3h 6a5b' },
  // 先手四間飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'shiken', g: 'ibisha', moves: '7g7f 3c3d 6g6f 8c8d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 6a5b 3i3h 8d8e 8h7g' },
  // 先手中飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'naka', g: 'ibisha', moves: '7g7f 3c3d 6g6f 8c8d 5g5f 8d8e 8h7g 7a6b 2h5h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h 7c7d 3i3h' },
  // 先手向かい飛車 対 後手居飛車（後手が△３四歩を先に突く）
  { s: 'mukai', g: 'ibisha', moves: '7g7f 3c3d 6g6f 8c8d 8h7g 7a6b 2h8h 5a4b 5i4h 4b3b 4h3h 6a5b 3h2h' },
  // 相矢倉：▲２六歩には△４二銀、▲２五歩に△３三銀と受ける
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 2g2f 3a4b 2f2e 4b3c 5g5f 5c5d 3i4h 4a3b 4i5h 5a4a 6i7h 6a5b 5i6i 7c7d 5h6g 2b3a 6h7g 4c4d 8h7i' },
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 2g2f 3a4b 3i4h 4a3b 2f2e 4b3c 4i5h 5a4a 6i7h 6a5b 5i6i 7c7d' },
  // 先手居飛車（舟囲い・▲５七銀左）対 後手四間飛車
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 8b4b 5i6h 5a6b 6h7h 6b7b 4i5h 7b8b 5g5f 7a7b 7i6h 6a5b 6h5g 9c9d 9g9f 1c1d 1g1f' },
  // 先手居飛車 対 後手雁木（△４四歩・△３三角から）
  { s: 'ibisha', g: 'gangi', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 3a4b 6i7h 4a3b 5i6i 7a6b 9g9f 6c6d 4g4f 6b6c 4h4g 4b4c 3g3f 5a4a 5g5f 6a5b' },
  // 先手四間飛車 対 後手居飛車穴熊
  { s: 'shiken', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 2h6h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 2b3c 3i3h 3b2b 1g1f 1a1b 6i5h 2b1a 9g9f 3a2b' },
  // 先手三間飛車 対 後手居飛車穴熊
  { s: 'sangen', g: 'ibisha', moves: '7g7f 8c8d 6g6f 3c3d 2h7h 7a6b 5i4h 5a4b 4h3h 4b3b 3h2h 2b3c 3i3h 3b2b 1g1f 1a1b 6i5h 2b1a 9g9f 3a2b' },
  // 手順違いで角換わり・相掛かりの本筋に合流する入り口
  { s: 'kakugawari', g: 'kakugawari', moves: '2g2f 8c8d 7g7f' },
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 2g2f 3a4b' },
  // 相矢倉24手組の続き（△６四角▲６八角△４三金右▲７九玉）
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 3i4h 3a4b 4i5h 4a3b 6i7h 5a4a 5i6i 7c7d 5h6g 6a5b 6h7g 4b3c 8h7i 2b3a 3g3f 4c4d 4h3g 3a6d 7i6h 5b4c 6i7i' },
  // 急戦矢倉（後手の端角・△８四飛）
  { s: 'yagura', g: 'yagura', moves: '7g7f 8c8d 7i6h 1c1d 1g1f 8d8e 6h7g 2b1c 3i4h 8b8d 6i7h 7a6b 5i6i 6a7a 4i5h 9c9d 9g9f 4a3b 8h7i' },
  // 先手右四間飛車 対 後手矢倉
  { s: 'ibisha', g: 'yagura', moves: '7g7f 8c8d 7i6h 3c3d 6g6f 7a6b 5g5f 5c5d 2h4h 3a4b 3i3h 4a3b 4g4f 5a4a 3h4g 6a5b 6i7h 4b3c 5i6i' },
  // 後手右四間飛車（エルモ囲い）対 先手石田流
  { s: 'sangen', g: 'ibisha', moves: '7g7f 3c3d 7f7e 6c6d 2h7h 8b6b 5i4h 5a4b 4h3h 4b3b 3h2h 3a4b 3i3h 4a3a 6i5h 6a5b 9g9f' },
  // 後手一手損角換わり
  { s: 'kakugawari', g: 'kakugawari', moves: '7g7f 3c3d 2g2f 2b8h+ 7i8h 3a2b 6i7h 2b3c 3i4h 7a6b 4g4f 6c6d 4h4g 6b6c 3g3f 4a3b 2i3g 5a4b' },
  // 対四間飛車の急戦：棒銀
  { s: 'bougin', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 3i3h 7a7b 3h2g 6a5b 2g2f 9c9d 9g9f' },
  // 対四間飛車の急戦：▲４六銀右
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 3i4h 7a7b 3g3f 6a5b 4h3g 9c9d 3g4f' },
  // 対四間飛車の急戦：▲４六銀左
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 7i6h 7a7b 6h5g 6a5b 5g4f 9c9d' },
  // 対四間飛車の急戦：▲４五歩早仕掛け
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 5g5f 7b8b 7i6h 7a7b 6h5g 6a5b 3g3f 9c9d 2i3g 1c1d 4g4f' },
  // 対四間飛車の急戦：エルモ囲い（玉７八・金７九・銀６八）
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 5i6h 8b4b 6h7h 5a6b 4i5h 6b7b 7i6h 7b8b 6i7i 7a7b 5g5f 6a5b 3i4h 9c9d' },
  // 先手居飛車穴熊 対 後手四間飛車（▲４八銀・▲５七銀から）
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 3i4h 8b4b 5i6h 5a6b 2f2e 2b3c 6h7h 7a7b 5g5f 3a3b 4i5h 6b7a 4h5g 6a5b 8h7g 9c9d 7h8h 6c6d 9i9h 7c7d 8h9i 8a7c' },
  // 先手ミレニアム 対 後手四間飛車（玉８九・桂７七・金７八・銀７九）
  { s: 'ibisha', g: 'shiken', moves: '7g7f 3c3d 2g2f 4c4d 3i4h 8b4b 5i6h 5a6b 2f2e 2b3c 6h7h 7a7b 5g5f 3a3b 4i5h 6b7a 4h5g 6a5b 7i6h 9c9d 7h7i 6c6d 8i7g 7c7d 7i8i 1c1d 6i7h 8a7c 6h7i' },
  // 先手角交換四間飛車 対 後手居飛車
  { s: 'shiken', g: 'ibisha', moves: '7g7f 8c8d 2h6h 8d8e 8h7g 7a6b 5i4h 3c3d 7g2b+ 3a2b 7i8h 5a4b 8h7g 4b3b 4h3h 6a5b 3h2h 6c6d 6g6f 6b6c' },
  // 後手ダイレクト向かい飛車 対 先手居飛車
  { s: 'ibisha', g: 'mukai', moves: '7g7f 3c3d 2g2f 2b8h+ 7i8h 8b2b' },
  // 先手筋違い角 対 後手居飛車
  { s: 'sujichigai', g: 'ibisha', moves: '7g7f 3c3d 8h2b+ 3a2b B*4e 7a6b 4e3d 4a3b 6g6f 2b3c 3d6g 6c6d 7i8h 6b6c 8h7g 6c5d 2h6h 4c4d 7f7e 4d4e 6i5h 3c3d 5i4h 2c2d 4h3h 3b4c 8g8f 2d2e 8f8e 8b2b' },
];

// 居飛車・定跡まかせを選んだときに使える戦法
const IBISHA_FAMILY = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'bougin'];
export function fitsStrategy(tag, strategy) {
  if (strategy === 'none' || strategy === 'auto') return true;
  if (strategy === 'ibisha') return IBISHA_FAMILY.includes(tag);
  if (strategy === 'bougin') return tag === 'bougin' || tag === 'kakugawari';
  return tag === strategy;
}

let tree = null; // 局面 → Map(usi → [先手の戦法の集合, 後手の戦法の集合])
let shapes = null; // 自分の駒の形 → Map(usi → 指す側の戦法の集合)

function build() {
  tree = new Map();
  shapes = new Map();
  for (const line of LINES) {
    const pos = new Position();
    for (const u of line.moves.split(' ')) {
      const mv = pos.legalMoves().find((m) => moveToUsi(m) === u);
      if (!mv) { console.warn('joseki: 指せない手', u, line.moves); break; }
      const k = hashKey(pos.toSfen(false));
      if (!tree.has(k)) tree.set(k, new Map());
      const e = tree.get(k).get(u) || [new Set(), new Set()];
      e[0].add(line.s); e[1].add(line.g);
      tree.get(k).set(u, e);
      // 形は、駒を取る手・打つ手を除く（相手の駒に関係なく指せる駒組みの手だけ）
      if (mv.from != null && !pos.board[mv.to]) {
        const sk = pos.turn + ":" + shapeKey(pos); // 先手と後手では同じ形でも指す手が違うので分ける
        if (!shapes.has(sk)) shapes.set(sk, new Map());
        const nu = pos.turn === 0 ? u : rotSq(u); // 形は手番側が先手の向きでそろえる
        const se = shapes.get(sk).get(nu) || new Set();
        se.add(pos.turn === 0 ? line.s : line.g);
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
