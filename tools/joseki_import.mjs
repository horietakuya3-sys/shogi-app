// 「先手の戦法|後手の戦法|▲７六歩△３四歩…」の行を読み、合法手か確かめてUSIの手順に直す
import fs from 'fs';
import { parseGameText } from '../js/kif.js';
import { Position, moveToUsi } from '../js/shogi.js';

const out = [];
let note = '';
for (const f of process.argv.slice(2)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) { note = line.slice(1).trim(); continue; }
    const [s, g, ki2] = line.split('|');
    let g2;
    try { g2 = parseGameText(ki2.replace(/打/g, '打')); } catch (e) { console.error('PARSE', note, e.message); continue; }
    const pos = new Position();
    const usis = [];
    for (const m of g2.moves) {
      const mv = pos.legalMoves().find((x) => moveToUsi(x) === moveToUsi(m.move));
      if (!mv) { console.error('ILLEGAL at', usis.length + 1, note); break; }
      usis.push(moveToUsi(mv));
      pos.applyMove(mv);
    }
    const n = (ki2.match(/[▲△]/g) || []).length;
    if (usis.length !== n) console.error('COUNT', note, usis.length, '/', n);
    out.push({ s, g, note, moves: usis.join(' ') });
  }
}
fs.writeFileSync('/home/claude/sn/lines.json', JSON.stringify(out, null, 1));
console.error('lines', out.length);
