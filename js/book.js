// 定跡（新ペタショック定跡の序盤を取り出したもの）の読み込みと検索
// ファイル形式（book/book.txt）: 1行目はJSONのヘッダ。2行目以降は「局面のハッシュ\t手:評価値:先手の戦法印:後手の戦法印 …」
export const BOOK_URL = 'book/book.txt';

// 文字列の53ビットハッシュ（cyrb53）。局面のSFENを短いキーにする
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

let loading = null;
let data = null; // { header, map }

export function loadBook() {
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch(BOOK_URL);
    if (!res.ok) throw new Error('定跡を読み込めませんでした');
    const text = await res.text();
    const nl = text.indexOf('\n');
    const header = JSON.parse(text.slice(0, nl));
    const map = new Map();
    let i = nl + 1;
    while (i < text.length) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      const tab = text.indexOf('\t', i);
      if (tab > i && tab < j) map.set(text.slice(i, tab), text.slice(tab + 1, j));
      i = j + 1;
    }
    data = { header, map };
    return data;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

export const bookReady = () => !!data;

// 局面の定跡手: [{ usi, ev, tags: [先手の戦法の集合, 後手の戦法の集合] }]（評価値は手番側から見た値）
export function bookMoves(pos) {
  if (!data) return null;
  const v = data.map.get(hashKey(pos.toSfen(false)));
  if (!v) return null;
  const tags = data.header.tags;
  const decode = (m) => new Set(tags.filter((_, i) => (m >> i) & 1));
  return v.split(' ').map((s) => {
    const [usi, ev, a, b] = s.split(':');
    return { usi, ev: Number(ev), tags: [decode(parseInt(a, 36)), decode(parseInt(b, 36))] };
  });
}

export function bookMaxPly() { return data ? data.header.maxPly : 0; }

// ---- 形の定跡: 自分の駒の配置だけで引く（相手が定跡を外れても、自分の駒組みは定跡の形をなぞれるように） ----
export const SHAPE_URL = 'book/shape1.txt';
const rotSq = (u) => { // 盤を180度回したUSI
  const f = (c) => String(10 - Number(c));
  const r = (c) => String.fromCharCode(97 + 105 - c.charCodeAt(0));
  return f(u[0]) + r(u[1]) + f(u[2]) + r(u[3]) + (u[4] || '');
};
export { rotSq };
// 手番側の駒だけを、手番側が先手になる向きで並べたキー
export function shapeKey(pos) {
  const me = pos.turn;
  let s = '';
  for (let i = 0; i < 81; i++) {
    const idx = me === 0 ? i : 80 - i;
    const pc = pos.board[idx];
    if (!pc) continue;
    const isMine = (pc.replace('+', '') === pc.replace('+', '').toUpperCase()) === (me === 0);
    if (isMine) s += i.toString(36).padStart(2, '0') + pc.toUpperCase();
  }
  return hashKey(s);
}
let shapeLoading = null, shapeData = null;
export function loadShape() {
  if (shapeLoading) return shapeLoading;
  shapeLoading = (async () => {
    const res = await fetch(SHAPE_URL);
    if (!res.ok) throw new Error('形の定跡を読み込めませんでした');
    const text = await res.text();
    const nl = text.indexOf('\n');
    const header = JSON.parse(text.slice(0, nl));
    const map = new Map();
    let i = nl + 1;
    while (i < text.length) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      const tab = text.indexOf('\t', i);
      if (tab > i && tab < j) map.set(text.slice(i, tab), text.slice(tab + 1, j));
      i = j + 1;
    }
    shapeData = { header, map };
    return shapeData;
  })().catch((e) => { shapeLoading = null; throw e; });
  return shapeLoading;
}
export const shapeReady = () => !!shapeData;
// 形の定跡の手: [{ usi（実際の盤の向き）, n（出てきた数）, ev, tags（指す側の戦法の集合） }]
export function shapeMoves(pos) {
  if (!shapeData) return null;
  const v = shapeData.map.get(shapeKey(pos));
  if (!v) return null;
  const tags = shapeData.header.tags;
  return v.split(' ').map((s) => {
    const [u, n, ev, m] = s.split(':');
    const mask = parseInt(m, 36);
    return { usi: pos.turn === 0 ? u : rotSq(u), n: Number(n), ev: Number(ev), tags: new Set(tags.filter((_, i) => (mask >> i) & 1)) };
  });
}
