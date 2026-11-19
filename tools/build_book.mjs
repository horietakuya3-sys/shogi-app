// 新ペタショック定跡から、初形から辿れる序盤だけを取り出し、戦法の印をつけて小さな定跡ファイルにする
import fs from 'fs';
import readline from 'readline';
import { Position, STARTPOS, moveToUsi, usiToMove } from '../js/shogi.js';
import { detectStrategy } from '../js/records.js';
import { hashKey } from '../js/book.js';

const [,, src, out, maxPlyArg, windowArg, topArg, fullPlyArg] = process.argv;
const FULL_PLY = Number(fullPlyArg || 0); // この手数までは、悪い手も含めて定跡の全部の手を辿る（相手がどう指しても定跡で受けられるように）
const MAX_PLY = Number(maxPlyArg || 30);
const WINDOW = Number(windowArg || 120); // 最善からこの評価値以内の手だけ残す
const TOP = Number(topArg || 4);
const TAGS = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'shiken', 'sangen', 'naka', 'mukai'];

const book = new Map();
const rl = readline.createInterface({ input: fs.createReadStream(src), crlfDelay: Infinity });
let key = null, buf = [];
for await (const line of rl) {
  if (line.startsWith('sfen ')) {
    if (key) book.set(key, buf.join('\n'));
    const parts = line.slice(5).split(' ');
    key = parts.slice(0, 3).join(' ');
    buf = [];
  } else if (key && line && !line.startsWith('#')) {
    buf.push(line);
  }
}
if (key) book.set(key, buf.join('\n'));
console.error('positions in book', book.size);

// 定跡ファイルは常に先手番の形で保存されている。後手番は盤を180度回して引き、指し手も回して戻す
function flipKey(pos) {
  const q = pos.clone();
  const b = new Array(81);
  for (let i = 0; i < 81; i++) {
    const pc = pos.board[80 - i];
    b[i] = pc ? (pc === pc.toUpperCase() ? pc.toLowerCase() : pc.toUpperCase()) : null;
  }
  q.board = b;
  q.hands = [{ ...pos.hands[1] }, { ...pos.hands[0] }];
  q.turn = 0;
  return q.toSfen(false);
}
const rot = (u) => {
  const f = (c) => String(10 - Number(c));
  const r = (c) => String.fromCharCode(97 + 105 - c.charCodeAt(0));
  if (u[1] === '*') return u.slice(0, 2) + f(u[2]) + r(u[3]);
  return f(u[0]) + r(u[1]) + f(u[2]) + r(u[3]) + (u[4] || '');
};
function movesFor(pos) {
  if (pos.turn === 0) return movesOf(pos.toSfen(false));
  const ms = movesOf(flipKey(pos));
  return ms && ms.map((m) => ({ ...m, usi: rot(m.usi) }));
}
let curPly = 0;
function movesOf(k) {
  const v = book.get(k);
  if (!v) return null;
  const ms = v.split('\n').map((l) => { const t = l.split(' '); return { usi: t[0], ev: Number(t[2]) }; }).filter((m) => m.usi && m.usi !== 'none');
  if (!ms.length) return null;
  const best = Math.max(...ms.map((m) => m.ev));
  if (curPly < FULL_PLY) return ms.sort((a, b) => b.ev - a.ev);
  return ms.filter((m) => m.ev >= best - WINDOW).sort((a, b) => b.ev - a.ev).slice(0, TOP);
}

const nodes = new Map(); // key -> { moves: [{usi, ev, child}], tags: [Set, Set] }
let leaves = 0;
function dfs(pos, line) {
  const k = pos.toSfen(false);
  if (nodes.has(k)) return nodes.get(k);
  const node = { moves: [], tags: [new Set(), new Set()] };
  nodes.set(k, node);
  curPly = line.length;
  const ms = line.length < MAX_PLY ? movesFor(pos) : null;
  const legal = ms ? pos.legalMoves() : [];
  let any = false;
  if (ms) for (const m of ms) {
    let mv;
    try { mv = usiToMove(m.usi); } catch { continue; }
    const lm = legal.find((x) => moveToUsi(x) === m.usi);
    if (!lm) continue;
    const p2 = pos.clone(); p2.applyMove(lm);
    line.push({ move: lm });
    const child = dfs(p2, line);
    line.pop();
    node.moves.push({ usi: m.usi, ev: m.ev, child });
    any = true;
  }
  if (!any) {
    leaves++;
    for (const side of [0, 1]) node.tags[side].add(detectStrategy(STARTPOS, line, side));
  } else {
    for (const m of node.moves) for (const side of [0, 1]) for (const t of m.child.tags[side]) node.tags[side].add(t);
  }
  return node;
}
dfs(new Position(), []);
console.error('reachable positions', nodes.size, 'leaves', leaves);

const mask = (set) => TAGS.reduce((a, t, i) => a | (set.has(t) ? 1 << i : 0), 0);
const header = { v: 1, tags: TAGS, maxPly: MAX_PLY, src: 'new_petabook_20250505c (MIT License, yaneurao)' };
const outLines = [JSON.stringify(header)];
const seen = new Set();
for (const [k, n] of nodes) {
  if (!n.moves.length) continue;
  const h = hashKey(k);
  if (seen.has(h)) throw new Error('hash collision ' + k);
  seen.add(h);
  outLines.push(h + '\t' + n.moves.map((m) => `${m.usi}:${m.ev}:${mask(m.child.tags[0]).toString(36)}:${mask(m.child.tags[1]).toString(36)}`).join(' '));
}
fs.writeFileSync(out, outLines.join('\n') + '\n');
console.error('written', outLines.length - 1, 'positions', fs.statSync(out).size, 'bytes');
// 戦法ごとに、その戦法を指せる局面の数
for (const side of [0, 1]) {
  const c = {};
  for (const n of nodes.values()) for (const t of n.tags[side]) c[t] = (c[t] || 0) + 1;
  console.error(side === 0 ? '先手' : '後手', JSON.stringify(c));
}
