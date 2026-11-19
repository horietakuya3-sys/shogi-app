// 新ペタショック定跡から、初形から辿れる序盤だけを取り出し、戦法の印をつけて小さな定跡ファイルにする
import fs from 'fs';
import readline from 'readline';
import { Position, STARTPOS, moveToUsi, usiToMove } from '../js/shogi.js';
import { detectStrategy } from '../js/records.js';
import { hashKey, shapeKey } from '../js/book.js';

const [,, src, out, maxPlyArg, windowArg, topArg, fullPlyArg, shapeOut] = process.argv;
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
  } else if (key && line && !line.startsWith('#') && buf.length < 40) {
    // 手は評価順に並んでいるので、上位だけ残してメモリを節約する
    const t = line.split(' ');
    buf.push(t[0] + ' ' + t[2]);
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
  const ms = v.split('\n').map((l) => { const t = l.split(' '); return { usi: t[0], ev: Number(t[1]) }; }).filter((m) => m.usi && m.usi !== 'none');
  if (!ms.length) return null;
  const best = Math.max(...ms.map((m) => m.ev));
  if (curPly < FULL_PLY) return ms.sort((a, b) => b.ev - a.ev);
  return ms.filter((m) => m.ev >= best - WINDOW).sort((a, b) => b.ev - a.ev).slice(0, TOP);
}

const nodes = new Map(); // key -> { moves: [{usi, ev, child}], tags: [Set, Set] }
const shapeSrc = []; // [shapeKey, turn, [{usi, ev, best, capture}], node]
let leaves = 0;
function dfs(pos, line) {
  const k = hashKey(pos.toSfen(false));
  if (nodes.has(k)) return nodes.get(k);
  const node = { moves: [], dist: [new Float32Array(TAGS.length), new Float32Array(TAGS.length)] };
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
  if (any && shapeOut) {
    const best = Math.max(...node.moves.map((m) => m.ev));
    const caps = node.moves.map((m) => { const mv = usiToMove(m.usi); return !!(mv.from != null && pos.board[mv.to]) || m.usi[1] === '*'; });
    shapeSrc.push([shapeKey(pos), pos.turn, node, best, caps]);
  }
  if (!any) {
    leaves++;
    for (const side of [0, 1]) { const i = TAGS.indexOf(detectStrategy(STARTPOS, line, side)); if (i >= 0) node.dist[side][i] = 1; }
  } else {
    // その先の葉で、それぞれの戦法になった割合（子の割合の平均）
    for (const m of node.moves) for (const side of [0, 1]) for (let i = 0; i < TAGS.length; i++) node.dist[side][i] += m.child.dist[side][i] / node.moves.length;
  }
  return node;
}
dfs(new Position(), []);
console.error('reachable positions', nodes.size, 'leaves', leaves);

// 戦法の印: その先の3割以上がその戦法になる手、または一番多い戦法（「その先で一度でも出てくる」では印がゆるすぎて、居飛車の手に振り飛車の印がついてしまう）
const SHARE = 0.3;
const mask = (d) => { const mx = Math.max(...d); return TAGS.reduce((a, t, i) => a | (d[i] > 0 && (d[i] >= SHARE || d[i] === mx) ? 1 << i : 0), 0); };
const header = { v: 1, tags: TAGS, maxPly: MAX_PLY, src: 'new_petabook_20250505c (MIT License, yaneurao)' };
const outLines = [JSON.stringify(header)];
const seen = new Set();
for (const [k, n] of nodes) {
  if (!n.moves.length) continue;
  const h = k;
  if (seen.has(h)) throw new Error('hash collision ' + k);
  seen.add(h);
  outLines.push(h + '\t' + n.moves.map((m) => `${m.usi}:${m.ev}:${mask(m.child.dist[0]).toString(36)}:${mask(m.child.dist[1]).toString(36)}`).join(' '));
}
fs.writeFileSync(out, outLines.join('\n') + '\n');
console.error('written', outLines.length - 1, 'positions', fs.statSync(out).size, 'bytes');
// 戦法ごとに、その戦法を指せる局面の数
for (const side of [0, 1]) {
  const c = {};
  for (const n of nodes.values()) { const m = mask(n.dist[side]); TAGS.forEach((t, i) => { if ((m >> i) & 1) c[t] = (c[t] || 0) + 1; }); }
  console.error(side === 0 ? '先手' : '後手', JSON.stringify(c));
}

// 形の定跡: 自分の駒の配置ごとに、定跡で指された駒組みの手（駒を取る手・打つ手は除く。最善から100以内）を集める
if (shapeOut) {
  const sh = new Map(); // key -> Map(usi(先手の向き) -> {n, ev, mask})
  for (const [k, turn, node, best, caps] of shapeSrc) {
    node.moves.forEach((m, i) => {
      if (caps[i] || m.ev < best - 100) return;
      const u = turn === 0 ? m.usi : rot(m.usi);
      if (!sh.has(k)) sh.set(k, new Map());
      const e = sh.get(k).get(u) || { n: 0, ev: 0, tn: new Array(TAGS.length).fill(0) };
      e.n++; e.ev += m.ev - best;
      const mk = mask(m.child.dist[turn]);
      TAGS.forEach((_, i) => { if ((mk >> i) & 1) e.tn[i]++; });
      sh.get(k).set(u, e);
    });
  }
  const lines = [JSON.stringify({ v: 1, tags: TAGS })];
  for (const [k, ms] of sh) {
    const arr = [...ms].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    // 同じ形で指された局面の半分以上でその戦法の印がつく手だけ、その戦法の手とする
    const mk = (e) => e.tn.reduce((a, c, i) => a | (c * 2 >= e.n ? 1 << i : 0), 0);
    lines.push(k + '\t' + arr.map(([u, e]) => `${u}:${e.n}:${Math.round(e.ev / e.n)}:${mk(e).toString(36)}`).join(' '));
  }
  fs.writeFileSync(shapeOut, lines.join('\n') + '\n');
  console.error('shape keys', sh.size, fs.statSync(shapeOut).size, 'bytes');
}
