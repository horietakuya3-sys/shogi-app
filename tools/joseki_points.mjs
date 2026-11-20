// 定跡の勉強で問題にする手（ポイント）を選び、js/joseki_points.js に書き出す
// 使い方: node tools/joseki_points.mjs /home/claude/sn/pts.jsonl
// pts.jsonl は tests/jpts.py で作る（定跡の各局面を MultiPV3・20万ノードで読んだ結果）
import fs from 'fs';
import { Position, usiToMove, colorOf, typeOf } from '../js/shogi.js';
import { studyLines, lineKey } from '../js/joseki.js';

const evals = new Map();
for (const x of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!x.trim()) continue;
  const r = JSON.parse(x);
  evals.set(r.sfen, r.c);
}

const ONLY_GAP = 80; // 2番目の手との差がこれ以上なら「この手しかない」ポイント
const out = {};
let total = 0, asked = 0;
for (const l of studyLines()) {
  const moves = l.moves.split(' ');
  const pos = new Position();
  const info = []; // { k, score }
  let prevTo = null;
  moves.forEach((u, k) => {
    const mv = usiToMove(u);
    const c = evals.get(pos.toSfen()) || [];
    const me = pos.turn;
    const pc = mv.drop ? null : pos.board[mv.from];
    const cap = mv.drop ? null : pos.board[mv.to];
    const recapture = prevTo != null && mv.to === prevTo && !!cap;
    let score = 0, why = '';
    // エンジンで見て、この手が最善に近く、ほかの手だと大きく損する
    const best = c[0] ? c[0][1] : null;
    const mine = c.find((x) => x[0] === u);
    const others = c.filter((x) => x[0] !== u);
    const gap = mine && others.length ? mine[1] - Math.max(...others.map((x) => x[1])) : 0;
    if (mine && best - mine[1] <= 20 && gap >= ONLY_GAP) { score = 2; why = 'only'; }
    if (pc && typeOf(pc) === 'R' && !cap && k < 40 && (mv.from % 9) !== (mv.to % 9) && Math.floor(mv.from / 9) === Math.floor(mv.to / 9)) {
      score = Math.max(score, 3); why = why || 'rook'; // 飛車を振る・回る
    }
    if (cap && !recapture && typeOf(cap) === 'B') { score = Math.max(score, 3); why = why || 'kakukoukan'; } // 角交換
    if (pc && typeOf(pc) === 'P' && !cap) {
      const ahead = mv.to + (me === 0 ? -9 : 9);
      const t = pos.board[ahead];
      if (t && colorOf(t) !== me) { score = Math.max(score, 3); why = why || 'shikake'; } // 歩をぶつける仕掛け
    }
    if (cap && !recapture && typeOf(cap) === 'P' && k < 60) { score = Math.max(score, 1); why = why || 'take'; }
    if (recapture || (k < 4 && why !== 'rook')) score = 0;
    info.push({ k, score, gap, skip: recapture || (k < 4 && why !== 'rook') });
    pos.applyMove(mv);
    prevTo = mv.to;
  });
  const pts = [];
  for (const side of [0, 1]) {
    const mine = info.filter((x) => x.k % 2 === side && x.k >= 4);
    let sel = mine.filter((x) => x.score >= 2);
    const cap = Math.max(3, Math.ceil(mine.length * 0.4));
    if (sel.length > cap) sel = sel.sort((a, b) => b.score - a.score || b.gap - a.gap).slice(0, cap);
    // 少なすぎるときは、駒を取る手、2番目の手との差が大きい手の順に足す
    const rest = mine.filter((x) => !sel.includes(x) && !x.skip)
      .sort((a, b) => b.score - a.score || b.gap - a.gap);
    while (sel.length < Math.min(3, mine.length) && rest.length) sel.push(rest.shift());
    pts.push(...sel.map((x) => x.k));
    total += mine.length; asked += sel.length;
  }
  out[lineKey(l.moves)] = pts.sort((a, b) => a - b).join(',');
}
const body = `// 定跡の勉強で問題にする手（初手を0とした手数）。tools/joseki_points.mjs で作る\n// 飛車を振る手、角交換、歩をぶつける仕掛け、エンジンで見てほかの手だと${ONLY_GAP}以上損する手など\nexport const POINTS = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n"')};\n`;
fs.writeFileSync(new URL('../js/joseki_points.js', import.meta.url), body);
console.error('lines', Object.keys(out).length, 'moves', total, 'asked', asked);
