// 将棋のルール（盤面・合法手・SFEN・表記）
// 盤のマス番号: idx = row*9 + col  row 0..8 = 一..九段, col 0..8 = ９..１筋
// 駒はSFEN表記の文字列: 'P','+P' (先手) / 'p','+p' (後手)

export const SENTE = 0, GOTE = 1;
export const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
export const STARTPOS = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

const ZEN = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
const KAN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const PIECE_NAME = {
  P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉',
  '+P': 'と', '+L': '成香', '+N': '成桂', '+S': '成銀', '+B': '馬', '+R': '龍',
};
// 盤上表示用の1文字表記
export const PIECE_CHAR = {
  P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉',
  '+P': 'と', '+L': '杏', '+N': '圭', '+S': '全', '+B': '馬', '+R': '龍',
};

export const fileOf = (idx) => 9 - (idx % 9);
export const rankOf = (idx) => Math.floor(idx / 9) + 1;
export const sq = (file, rank) => (rank - 1) * 9 + (9 - file);

export function colorOf(pc) {
  const t = pc[pc.length - 1];
  return t === t.toUpperCase() ? SENTE : GOTE;
}
export function typeOf(pc) { // 'P' / '+P' 形式（大文字）
  return pc.toUpperCase();
}
export function baseType(pc) { // 成りを外した種類
  return pc.replace('+', '').toUpperCase();
}
function make(type, color) { // type: 'P' or '+P'
  return color === SENTE ? type : type.toLowerCase();
}

const GOLD = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
const STEP = {
  P: [[-1, 0]],
  N: [[-2, -1], [-2, 1]],
  S: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]],
  G: GOLD, '+P': GOLD, '+L': GOLD, '+N': GOLD, '+S': GOLD,
  K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  '+B': [[-1, 0], [0, -1], [0, 1], [1, 0]],
  '+R': [[-1, -1], [-1, 1], [1, -1], [1, 1]],
};
const SLIDE = {
  L: [[-1, 0]],
  B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  R: [[-1, 0], [0, -1], [0, 1], [1, 0]],
  '+B': [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  '+R': [[-1, 0], [0, -1], [0, 1], [1, 0]],
};
const PROMOTABLE = new Set(['P', 'L', 'N', 'S', 'B', 'R']);

function inZone(row, color) {
  return color === SENTE ? row <= 2 : row >= 6;
}
// その段に行き所のない駒か（強制成り・打てない判定）
function deadEnd(type, row, color) {
  const r = color === SENTE ? row : 8 - row; // 先手から見た段 (0=一段目)
  if (type === 'P' || type === 'L') return r === 0;
  if (type === 'N') return r <= 1;
  return false;
}

export class Position {
  constructor(sfen = STARTPOS) {
    this.setSfen(sfen);
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.board = this.board.slice();
    p.hands = [{ ...this.hands[0] }, { ...this.hands[1] }];
    p.turn = this.turn;
    p.ply = this.ply;
    return p;
  }

  setSfen(sfen) {
    const parts = sfen.trim().split(/\s+/);
    const [b, t, h, n] = parts;
    this.board = new Array(81).fill(null);
    let row = 0, col = 0, promo = false;
    for (const ch of b) {
      if (ch === '/') { row++; col = 0; continue; }
      if (ch === '+') { promo = true; continue; }
      if (/[1-9]/.test(ch)) { col += Number(ch); continue; }
      if (row > 8 || col > 8) throw new Error('SFENの盤面が不正です');
      this.board[row * 9 + col] = (promo ? '+' : '') + ch;
      promo = false;
      col++;
    }
    this.turn = t === 'w' ? GOTE : SENTE;
    this.hands = [{}, {}];
    for (const c of [0, 1]) for (const k of HAND_ORDER) this.hands[c][k] = 0;
    if (h && h !== '-') {
      let num = '';
      for (const ch of h) {
        if (/[0-9]/.test(ch)) { num += ch; continue; }
        const c = ch === ch.toUpperCase() ? SENTE : GOTE;
        this.hands[c][ch.toUpperCase()] += num ? Number(num) : 1;
        num = '';
      }
    }
    this.ply = n ? Number(n) : 1;
  }

  toSfen(withPly = true) {
    let s = '';
    for (let row = 0; row < 9; row++) {
      let empty = 0;
      for (let col = 0; col < 9; col++) {
        const pc = this.board[row * 9 + col];
        if (!pc) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += pc;
      }
      if (empty) s += empty;
      if (row < 8) s += '/';
    }
    let h = '';
    for (const c of [SENTE, GOTE]) {
      for (const k of HAND_ORDER) {
        const n = this.hands[c][k];
        if (!n) continue;
        if (n > 1) h += n;
        h += c === SENTE ? k : k.toLowerCase();
      }
    }
    return `${s} ${this.turn === SENTE ? 'b' : 'w'} ${h || '-'}` + (withPly ? ` ${this.ply}` : '');
  }

  kingSq(color) {
    const k = color === SENTE ? 'K' : 'k';
    return this.board.indexOf(k);
  }

  // マスtoが color 側の駒に利かされているか
  attacked(to, color) {
    const tr = Math.floor(to / 9), tc = to % 9;
    const dir = color === SENTE ? 1 : -1; // 攻め方の前方向の符号反転用
    // 攻め方の駒から見て (dr,dc) の位置に to があるか → to から逆方向を見る
    for (let i = 0; i < 81; i++) {
      const pc = this.board[i];
      if (!pc || colorOf(pc) !== color) continue;
      const t = typeOf(pc);
      const r = Math.floor(i / 9), c = i % 9;
      const dr = (tr - r) * dir, dc = tc - c; // 先手視点の差分
      const steps = STEP[t];
      if (steps) for (const [a, b] of steps) if (a === dr && b === dc) return true;
      const slides = SLIDE[t];
      if (slides) {
        for (const [a, b] of slides) {
          // dr,dc が (a,b) の正の倍数か
          let k = 0;
          if (a !== 0) { if (dr % a !== 0) continue; k = dr / a; }
          else if (dr !== 0) continue;
          if (b !== 0) {
            if (dc % b !== 0) continue;
            const k2 = dc / b;
            if (a !== 0 && k2 !== k) continue;
            k = k2;
          } else if (dc !== 0) continue;
          if (k <= 0) continue;
          let blocked = false;
          for (let s = 1; s < k; s++) {
            const rr = r + a * s * dir, cc = c + b * s;
            if (this.board[rr * 9 + cc]) { blocked = true; break; }
          }
          if (!blocked) return true;
        }
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    const k = this.kingSq(color);
    return k >= 0 && this.attacked(k, 1 - color);
  }

  // 自玉の安全を考えない指し手
  pseudoMoves() {
    const moves = [];
    const me = this.turn, dir = me === SENTE ? 1 : -1;
    for (let i = 0; i < 81; i++) {
      const pc = this.board[i];
      if (!pc || colorOf(pc) !== me) continue;
      const t = typeOf(pc);
      const r = Math.floor(i / 9), c = i % 9;
      const add = (to) => {
        const tr = Math.floor(to / 9);
        const canPromo = PROMOTABLE.has(t) && (inZone(r, me) || inZone(tr, me));
        if (canPromo) moves.push({ from: i, to, promote: true });
        if (!deadEnd(t, tr, me)) moves.push({ from: i, to, promote: false });
      };
      const steps = STEP[t];
      if (steps) for (const [a, b] of steps) {
        const rr = r + a * dir, cc = c + b;
        if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
        const q = this.board[rr * 9 + cc];
        if (q && colorOf(q) === me) continue;
        add(rr * 9 + cc);
      }
      const slides = SLIDE[t];
      if (slides) for (const [a, b] of slides) {
        let rr = r + a * dir, cc = c + b;
        while (rr >= 0 && rr <= 8 && cc >= 0 && cc <= 8) {
          const q = this.board[rr * 9 + cc];
          if (q && colorOf(q) === me) break;
          add(rr * 9 + cc);
          if (q) break;
          rr += a * dir; cc += b;
        }
      }
    }
    // 打つ手
    const hand = this.hands[me];
    const pawnFiles = new Set();
    for (let i = 0; i < 81; i++) {
      if (this.board[i] === (me === SENTE ? 'P' : 'p')) pawnFiles.add(i % 9);
    }
    for (const k of HAND_ORDER) {
      if (!hand[k]) continue;
      for (let to = 0; to < 81; to++) {
        if (this.board[to]) continue;
        const row = Math.floor(to / 9);
        if (deadEnd(k, row, me)) continue;
        if (k === 'P' && pawnFiles.has(to % 9)) continue; // 二歩
        moves.push({ from: null, to, drop: k });
      }
    }
    return moves;
  }

  legalMoves() {
    const res = [];
    for (const m of this.pseudoMoves()) {
      const p = this.clone();
      p.applyMove(m);
      if (p.inCheck(this.turn)) continue;
      if (m.drop === 'P' && p.inCheck(p.turn) && p.isMate()) continue; // 打ち歩詰め
      res.push(m);
    }
    return res;
  }

  isMate() {
    for (const m of this.pseudoMoves()) {
      const p = this.clone();
      p.applyMove(m);
      if (!p.inCheck(this.turn)) return false;
    }
    return true;
  }

  // 合法性チェックなしで指す
  applyMove(m) {
    const me = this.turn;
    let captured = null;
    if (m.drop) {
      this.hands[me][m.drop]--;
      this.board[m.to] = make(m.drop, me);
    } else {
      const pc = this.board[m.from];
      captured = this.board[m.to];
      if (captured) this.hands[me][baseType(captured)]++;
      this.board[m.from] = null;
      this.board[m.to] = m.promote ? make('+' + baseType(pc), me) : pc;
    }
    this.turn = 1 - me;
    this.ply++;
    return captured;
  }

  isLegal(m) {
    return this.legalMoves().some((x) => sameMove(x, m));
  }
}

export function sameMove(a, b) {
  if (!a || !b) return false;
  if (a.drop || b.drop) return a.drop === b.drop && a.to === b.to;
  return a.from === b.from && a.to === b.to && !!a.promote === !!b.promote;
}

// USI形式 <-> 指し手
const RANK_CH = 'abcdefghi';
export function sqToUsi(idx) { return `${fileOf(idx)}${RANK_CH[rankOf(idx) - 1]}`; }
export function usiToSq(s) { return sq(Number(s[0]), RANK_CH.indexOf(s[1]) + 1); }
export function moveToUsi(m) {
  if (m.drop) return `${m.drop}*${sqToUsi(m.to)}`;
  return sqToUsi(m.from) + sqToUsi(m.to) + (m.promote ? '+' : '');
}
export function usiToMove(s) {
  if (s[1] === '*') return { from: null, to: usiToSq(s.slice(2, 4)), drop: s[0].toUpperCase() };
  return { from: usiToSq(s.slice(0, 2)), to: usiToSq(s.slice(2, 4)), promote: s[4] === '+' };
}

// 日本語表記（例: ▲７六歩、△同　角成、▲５五角打）
// prevTo: 直前の指し手の移動先（同 の判定用）
export function moveToJa(pos, m, prevTo = null, { mark = true, kifFrom = false } = {}) {
  const me = pos.turn;
  let s = mark ? (me === SENTE ? '▲' : '△') : '';
  s += (prevTo === m.to) ? '同　' : ZEN[fileOf(m.to)] + KAN[rankOf(m.to)];
  if (m.drop) {
    s += PIECE_NAME[m.drop];
    // 盤上の同じ駒も移動できる場合のみ「打」が必須だが、分かりやすさ優先で常に付ける
    s += '打';
    return s;
  }
  const pc = pos.board[m.from];
  const t = typeOf(pc);
  s += PIECE_NAME[t];
  const tr = Math.floor(m.to / 9), fr = Math.floor(m.from / 9);
  const canPromo = PROMOTABLE.has(t) && (inZone(fr, me) || inZone(tr, me));
  if (m.promote) s += '成';
  else if (canPromo && !deadEnd(t, tr, me)) s += '不成';
  if (kifFrom) {
    s += `(${fileOf(m.from)}${rankOf(m.from)})`;
  } else {
    s += relativeSuffix(pos, m);
  }
  return s;
}

// 同じ種類の駒が同じマスへ動ける場合の区別（右・左・上・引・寄・直）
function relativeSuffix(pos, m) {
  const pc = pos.board[m.from];
  const others = pos.legalMoves().filter((x) => !x.drop && x.to === m.to && x.from !== m.from
    && pos.board[x.from] === pc && !!x.promote === !!m.promote);
  if (!others.length) return '';
  const me = pos.turn;
  // 先手視点に揃えた座標: 列は右ほど大きく（＝筋が小さい）, 行は前ほど小さく
  const view = (idx) => {
    let r = Math.floor(idx / 9), c = idx % 9;
    if (me === GOTE) { r = 8 - r; c = 8 - c; }
    return [r, c];
  };
  const [tr, tc] = view(m.to);
  const [fr, fc] = view(m.from);
  const oth = others.map((x) => view(x.from));
  const vert = (r) => (r > tr ? '上' : r < tr ? '引' : '寄');
  const myV = vert(fr);
  const t = typeOf(pc);
  // 金銀など: 真っすぐ上がる手は「直」
  if (!['B', 'R', '+B', '+R'].includes(t) && fc === tc && fr === tr + 1) return '直';
  const sameMotion = oth.filter(([r]) => vert(r) === myV);
  if (!sameMotion.length) return myV;
  const lrOf = (set) => (set.every(([, c]) => c < fc) ? '右' : set.every(([, c]) => c > fc) ? '左' : '');
  const lrAll = lrOf(oth);
  if (lrAll) return lrAll;
  const lrSame = lrOf(sameMotion);
  if (lrSame) return lrSame + myV;
  return myV;
}

export function sqToKif(idx) { return `${fileOf(idx)}${rankOf(idx)}`; }
export { ZEN, KAN };
