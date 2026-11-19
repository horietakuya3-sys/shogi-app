// やねうら王「詰将棋500万問」（著作権放棄、自由利用可）から、手数ごとに一定数をランダムに取り出す
// 使い方: node tools/build_tsume.mjs <mateN.sfenがあるフォルダ> <出力ファイル> <手数ごとの問題数>
import fs from 'fs';
import readline from 'readline';
import { Position } from '../js/shogi.js';

const [,, dir, out, perArg] = process.argv;
const PER = Number(perArg || 1500);
let seed = 20261119;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const lines = [];
for (const n of [3, 5, 7, 9, 11]) {
  const pool = [];
  let seen = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(`${dir}/mate${n}.sfen`) });
  for await (const l of rl) {
    const s = l.trim();
    if (!s) continue;
    seen++;
    // 貯水池サンプリング
    if (pool.length < PER * 2) pool.push(s);
    else { const j = Math.floor(rnd() * seen); if (j < PER * 2) pool[j] = s; }
  }
  let kept = 0;
  for (const s of pool) {
    if (kept >= PER) break;
    try {
      const p = new Position(s);
      // 攻め方の手番で、攻め方は王手されておらず、王手をかける手があること
      if (p.inCheck(p.turn)) continue;
      const checks = p.legalMoves().some((m) => { const q = p.clone(); q.applyMove(m); return q.inCheck(q.turn); });
      if (!checks) continue;
      lines.push(`${n}\t${p.toSfen(false)}`);
      kept++;
    } catch { /* 読めない行は飛ばす */ }
  }
  console.error(`mate${n}: ${seen}問から${kept}問`);
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.error('written', lines.length, fs.statSync(out).size, 'bytes');
