// 定跡の勉強の「章立て」（基本図 → 成功例 → 互角の変化）に使う評価値を js/joseki_evals.js に書き出す
// 使い方: node tools/joseki_evals.mjs /home/claude/sn/pts.jsonl
// pts.jsonl は tests/jpts.py で作る（定跡の各局面と最後の局面を MultiPV3・20万ノードで読んだ結果）
// 1本の定跡ごとに、各局面の「最善手:評価値（手番側から見た値）」を空白区切りで並べ、最後に最後の局面の評価値を置く
import fs from 'fs';
import { Position, usiToMove } from '../js/shogi.js';
import { studyLines, lineKey } from '../js/joseki.js';
import { SUCCESS_LINES } from '../js/joseki_success.js';

const evals = new Map();
for (const x of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!x.trim()) continue;
  const r = JSON.parse(x);
  evals.set(r.sfen, r.c);
}
const clip = (v) => Math.max(-9999, Math.min(9999, Math.round(v)));
const out = {};
let miss = 0;
for (const l of [...studyLines(), ...SUCCESS_LINES]) {
  const pos = new Position();
  const parts = [];
  for (const u of l.moves.split(' ')) {
    const c = evals.get(pos.toSfen());
    if (c && c[0]) parts.push(`${c[0][0]}:${clip(c[0][1])}`); else { parts.push('-'); miss++; }
    pos.applyMove(usiToMove(u));
  }
  const f = evals.get(pos.toSfen());
  parts.push(f && f[0] ? String(clip(f[0][1])) : '-');
  if (!f) miss++;
  out[lineKey(l.moves)] = parts.join(' ');
}
const body = `// 定跡の各局面の最善手と評価値（手番側から見た値）。tools/joseki_evals.mjs で作る。章立て（基本図・成功例・互角の変化）に使う\nexport const EVALS = ${JSON.stringify(out).replace(/","/g, '",\n"')};\n`;
fs.writeFileSync(new URL('../js/joseki_evals.js', import.meta.url), body);
console.error('lines', Object.keys(out).length, 'missing', miss, 'bytes', body.length);
