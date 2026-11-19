// 局後解析: 全局面の評価を出し、勝率の落ち幅で悪手・疑問手を判定する
import { Position, SENTE, moveToUsi } from './shogi.js';

export const BAD = 0.20; // 悪手: 勝率がこれ以上下がった手
export const DUBIOUS = 0.10; // 疑問手
// 形勢がまだ決まっていない局面（±1500以内）では、評価値の損でも判定する
// （勝率だけだと、少し傾いた局面での損が小さく見えるため）
const CP_RANGE = 1500, CP_BAD = 400, CP_DUBIOUS = 200;

export const DEPTHS = {
  fast: { name: '速い', movetime: 300 },
  normal: { name: '標準', movetime: 1000 },
  deep: { name: '詳しく', movetime: 3000 },
};

// 先手から見た評価 {cp} or {mate}
function toSente(line, turn) {
  const sign = turn === SENTE ? 1 : -1;
  if (line.mate != null) return { mate: line.mate * sign };
  return { cp: (line.cp || 0) * sign };
}

export function senteWinRate(s) {
  if (!s) return 0.5;
  if (s.mate != null) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-s.cp / 600));
}

export function scoreForGraph(s) {
  if (!s) return 0;
  if (s.mate != null) return s.mate > 0 ? 3000 : -3000;
  return Math.max(-3000, Math.min(3000, s.cp));
}

// 戻り値: results[i] = { score, best, pv }（i = 0..手数、i手目を指した後の局面）
// getFocus(): 今見ている手数。そこから先を優先して解析し、飛ばした手前の局面は最後に埋める
export async function analyzeGame(engine, startSfen, moves, { movetime = 1000, onProgress, isCancelled, results = [], getFocus } = {}) {
  const positions = [new Position(startSfen)];
  for (const m of moves) { const p = positions[positions.length - 1].clone(); p.applyMove(m.move); positions.push(p); }
  const N = positions.length;
  const nextIndex = () => {
    const f = getFocus ? Math.max(0, Math.min(N - 1, getFocus() - 1)) : 0;
    // その手を指す前の局面から順に、最後まで → 残りを最初から
    for (let k = 0; k < N; k++) {
      const i = (f + k) % N;
      if (!results[i]) return i;
    }
    return -1;
  };
  for (;;) {
    if (isCancelled && isCancelled()) return null;
    const i = nextIndex();
    if (i < 0) break;
    const pos = positions[i];
    if (!pos.legalMoves().length) {
      // 詰み（指せる手がない）: 手番側の負け
      results[i] = { score: { mate: pos.turn === SENTE ? -1 : 1, terminal: true }, best: null, pv: [] };
    } else {
      // 2番目に良い手も調べる（次の一手の問題を作るため）
      const r = await engine.searchOnce({ sfen: pos.toSfen(), multipv: 2, go: `go movetime ${movetime}` });
      if (!r) return null;
      const val = (x) => (x.mate != null ? (x.mate > 0 ? 30000 - x.mate : -30000 - x.mate) : x.cp || 0);
      const ls = r.lines.filter((x) => x && x.pv && x.pv[0]).sort((a, b) => (b.depth - a.depth) || (val(b) - val(a)));
      const l = ls[0];
      const l2 = ls.find((x) => x !== l && x.pv[0] !== (l && l.pv[0]));
      results[i] = {
        score: l ? toSente(l, pos.turn) : { cp: 0 },
        best: r.bestmove && !['resign', 'win'].includes(r.bestmove) ? r.bestmove : null,
        pv: l ? l.pv.slice(0, 12) : [],
        score2: l2 ? toSente(l2, pos.turn) : null,
        second: l2 ? l2.pv[0] : null,
      };
    }
    if (onProgress) onProgress(i, results);
  }
  return results;
}

// marks[i]（i = 1..手数）: { drop, kind: '悪手'|'疑問手'|'', best, match }
export function judgeMoves(startSfen, moves, results) {
  const marks = [null];
  let pos = new Position(startSfen);
  for (let i = 1; i <= moves.length; i++) {
    const before = results[i - 1], after = results[i];
    if (!before || !after) { marks.push(null); pos = pos.clone(); pos.applyMove(moves[i - 1].move); continue; }
    const me = pos.turn;
    const wr = (s) => (me === SENTE ? senteWinRate(s) : 1 - senteWinRate(s));
    const u = moveToUsi(moves[i - 1].move);
    const match = before.best === u;
    let drop = wr(before.score) - wr(after.score);
    if (match || drop < 0) drop = Math.max(0, match ? 0 : drop);
    // 指した側から見た評価値
    const mine = (sc) => {
      const sign = me === SENTE ? 1 : -1;
      if (sc.mate != null) return { mate: sc.mate * sign };
      return { cp: sc.cp * sign };
    };
    const b = mine(before.score), a = mine(after.score);
    const missedMate = !match && b.mate != null && b.mate > 0 && !(a.mate != null && a.mate > 0);
    const blunderMate = !match && a.mate != null && a.mate < 0 && !(b.mate != null && b.mate < 0);
    let cpLoss = 0;
    if (!match && b.cp != null && a.cp != null && Math.abs(b.cp) <= CP_RANGE) cpLoss = Math.max(0, b.cp - a.cp);
    let kind = '';
    if (drop >= BAD || cpLoss >= CP_BAD || missedMate || blunderMate) kind = '悪手';
    else if (drop >= DUBIOUS || cpLoss >= CP_DUBIOUS) kind = '疑問手';
    const note = blunderMate ? '詰まされる手' : missedMate ? '詰みを逃した' : '';
    marks.push({ drop, cpLoss, kind, note, missedMate, blunderMate, best: before.best, match, side: me });
    pos = pos.clone();
    pos.applyMove(moves[i - 1].move);
  }
  return marks;
}

export function summarize(marks) {
  const s = [0, 1].map(() => ({ moves: 0, bad: 0, dubious: 0, match: 0, dropSum: 0 }));
  for (const m of marks) {
    if (!m) continue;
    const t = s[m.side];
    t.moves++;
    if (m.kind === '悪手') t.bad++;
    if (m.kind === '疑問手') t.dubious++;
    if (m.match) t.match++;
    t.dropSum += m.drop;
  }
  return s;
}
