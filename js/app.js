import {
  Position, STARTPOS, SENTE, GOTE, HAND_ORDER, PIECE_CHAR, colorOf, typeOf,
  moveToUsi, usiToMove, moveToJa, sameMove, fileOf, rankOf, KAN,
} from './shogi.js';
import { parseGameText, toKif, decodeBytes } from './kif.js';
import { Engine } from './engine.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'shogi-app:v1';

// ---- 状態 ----
const state = {
  game: { startSfen: STARTPOS, moves: [], header: {}, result: '' }, // 本譜
  branch: null, // { base: 本譜の何手目から分岐したか, moves: [] }
  cursor: 0, // 表示中の手数
  flipped: false,
  analyze: true,
  multipv: 3,
  selected: null, // { from } or { drop }
  candidates: [],
  engineReady: false,
};

const engine = new Engine();

// ---- 手順の扱い ----
function line() {
  const g = state.game;
  if (!state.branch) return g.moves;
  return g.moves.slice(0, state.branch.base).concat(state.branch.moves);
}
let posCache = { key: '', list: [] };
function positions() {
  const ln = line();
  const key = state.game.startSfen + '|' + ln.map((m) => moveToUsi(m.move)).join(' ');
  if (posCache.key === key) return posCache.list;
  const list = [new Position(state.game.startSfen)];
  for (const m of ln) {
    const p = list[list.length - 1].clone();
    p.applyMove(m.move);
    list.push(p);
  }
  posCache = { key, list };
  return list;
}
const curPos = () => positions()[state.cursor];
const prevMove = () => (state.cursor > 0 ? line()[state.cursor - 1].move : null);

function playMove(mv) {
  const ln = line();
  const next = ln[state.cursor];
  if (next && sameMove(next.move, mv)) { // 次の手と同じなら進むだけ
    state.cursor++;
  } else if (!state.branch && state.cursor === state.game.moves.length && !state.game.result) {
    // 本譜の最後で指したら本譜に追加
    state.game.moves.push({ move: mv, comment: '' });
    state.cursor++;
  } else if (state.branch && state.cursor >= state.branch.base) {
    const k = state.cursor - state.branch.base;
    state.branch.moves = state.branch.moves.slice(0, k).concat([{ move: mv, comment: '' }]);
    state.cursor++;
  } else {
    state.branch = { base: state.cursor, moves: [{ move: mv, comment: '' }] };
    state.cursor++;
  }
  state.selected = null;
  update();
}

function goTo(n) {
  const max = line().length;
  state.cursor = Math.max(0, Math.min(max, n));
  state.selected = null;
  update();
}

function backToMainline() {
  if (!state.branch) return;
  state.cursor = Math.min(state.branch.base, state.game.moves.length);
  state.branch = null;
  update();
}

function loadGame(g) {
  state.game = { startSfen: g.startSfen, moves: g.moves, header: g.header || {}, result: g.result || '' };
  state.branch = null;
  state.cursor = 0;
  state.selected = null;
  update();
  toast(`${g.moves.length}手の棋譜を読み込みました`);
}

// ---- 描画 ----
const boardEl = $('board');
const cells = [];
function buildBoard() {
  boardEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.addEventListener('click', () => onCellTap(displayToIdx(i)));
    boardEl.appendChild(d);
    cells.push(d);
  }
}
const displayToIdx = (i) => (state.flipped ? 80 - i : i);
const idxToDisplay = (i) => (state.flipped ? 80 - i : i);

function pieceEl(pc, color) {
  const t = typeOf(pc);
  const d = document.createElement('div');
  const flipVisual = state.flipped ? color === SENTE : color === GOTE;
  d.className = 'piece' + (flipVisual ? ' gote' : '') + (t.startsWith('+') ? ' promoted' : '');
  d.textContent = PIECE_CHAR[t];
  return d;
}

function renderLabels() {
  const files = [9, 8, 7, 6, 5, 4, 3, 2, 1];
  const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (state.flipped) { files.reverse(); ranks.reverse(); }
  $('filesLabel').innerHTML = files.map((f) => `<div>${f}</div>`).join('');
  $('ranksLabel').innerHTML = ranks.map((r) => `<div>${KAN[r]}</div>`).join('');
}

function legalTargets() {
  const sel = state.selected;
  if (!sel) return [];
  const ms = curPos().legalMoves();
  return ms.filter((m) => (sel.drop ? m.drop === sel.drop : m.from === sel.from)).map((m) => m.to);
}

function renderBoard() {
  const pos = curPos();
  const last = prevMove();
  const dests = new Set(legalTargets());
  for (let d = 0; d < 81; d++) {
    const idx = displayToIdx(d);
    const el = cells[d];
    el.innerHTML = '';
    let cls = 'cell';
    if (last && (last.to === idx || last.from === idx)) cls += ' last';
    if (state.selected && state.selected.from === idx) cls += ' sel';
    if (dests.has(idx)) cls += ' dest' + (pos.board[idx] ? ' occupied' : '');
    el.className = cls;
    const pc = pos.board[idx];
    if (pc) el.appendChild(pieceEl(pc, colorOf(pc)));
  }
  renderHand($('handBottom'), state.flipped ? GOTE : SENTE);
  renderHand($('handTop'), state.flipped ? SENTE : GOTE);
}

function renderHand(el, color) {
  const pos = curPos();
  el.innerHTML = '';
  const lab = document.createElement('span');
  lab.className = 'label';
  lab.textContent = (color === SENTE ? '☗' : '☖') + (pos.turn === color ? '手番' : '');
  el.appendChild(lab);
  for (const k of HAND_ORDER) {
    const n = pos.hands[color][k];
    if (!n) continue;
    const hp = document.createElement('div');
    hp.className = 'hp' + (state.selected && state.selected.drop === k && pos.turn === color ? ' sel' : '');
    const pe = pieceEl(k, color);
    pe.classList.remove('gote');
    hp.appendChild(pe);
    if (n > 1) {
      const c = document.createElement('span');
      c.className = 'cnt';
      c.textContent = n;
      hp.appendChild(c);
    }
    hp.addEventListener('click', () => onHandTap(color, k));
    el.appendChild(hp);
  }
}

function renderArrows() {
  const svg = $('arrows');
  const best = state.candidates[0];
  if (!state.analyze || !best || !best.pv || !best.pv[0]) { svg.innerHTML = ''; return; }
  const mv = usiToMove(best.pv[0]);
  const center = (idx) => {
    const d = idxToDisplay(idx);
    return [(d % 9) + 0.5, Math.floor(d / 9) + 0.5];
  };
  const [x2, y2] = center(mv.to);
  let body;
  if (mv.drop) {
    body = `<circle cx="${x2}" cy="${y2}" r="0.42" fill="none" stroke="rgba(30,110,220,0.8)" stroke-width="0.08"/>`;
  } else {
    const [x1, y1] = center(mv.from);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const ex = x2 - ux * 0.3, ey = y2 - uy * 0.3;
    const hx = x2 - ux * 0.05, hy = y2 - uy * 0.05;
    const px = -uy * 0.18, py = ux * 0.18;
    body = `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="rgba(30,110,220,0.75)" stroke-width="0.14" stroke-linecap="round"/>`
      + `<polygon points="${hx},${hy} ${ex + px},${ey + py} ${ex - px},${ey - py}" fill="rgba(30,110,220,0.85)"/>`;
  }
  svg.innerHTML = body;
}

function renderControls() {
  const ln = line();
  const n = state.cursor;
  let txt = n === 0 ? '開始局面' : `${n}手目`;
  if (n > 0) {
    const p = positions()[n - 1];
    const pm = n > 1 ? ln[n - 2].move.to : null;
    txt += ' ' + moveToJa(p, ln[n - 1].move, pm);
  }
  $('plyInfo').textContent = txt;
  $('branchBar').classList.toggle('hidden', !state.branch);
  const cm = n > 0 ? ln[n - 1].comment : '';
  $('comment').textContent = cm || '';
  $('comment').classList.toggle('hidden', !cm);
}

function renderMoveList() {
  const el = $('moveList');
  const ln = line();
  const ps = positions();
  el.innerHTML = '';
  ln.forEach((m, i) => {
    const s = document.createElement('span');
    const inBranch = state.branch && i >= state.branch.base;
    s.className = 'm' + (i + 1 === state.cursor ? ' cur' : '') + (inBranch ? ' branch' : '');
    s.textContent = `${i + 1} ${moveToJa(ps[i], m.move, i > 0 ? ln[i - 1].move.to : null)}`;
    s.addEventListener('click', () => goTo(i + 1));
    el.appendChild(s);
  });
  if (!state.branch && state.game.result) {
    const r = document.createElement('span');
    r.className = 'res';
    r.textContent = state.game.result;
    el.appendChild(r);
  }
  const cur = el.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

// 評価値（先手から見た値）
function senteScore(info, turn) {
  const sign = turn === SENTE ? 1 : -1;
  if (info.mate != null) return { mate: info.mate * sign };
  return { cp: (info.cp || 0) * sign };
}
function fmtScore(s) {
  if (s.mate != null) {
    const n = Math.abs(s.mate);
    const who = s.mate > 0 ? '▲' : '△';
    if (s.mate === 0) return '詰み';
    return `${who}詰${n >= 999 ? '' : n + '手'}`;
  }
  return (s.cp > 0 ? '+' : '') + s.cp;
}
function winRate(s) {
  if (s.mate != null) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-s.cp / 600));
}

function pvToJa(pos, pv, max = 8) {
  const p = pos.clone();
  let prevTo = prevMove() ? prevMove().to : null;
  const out = [];
  for (const u of pv.slice(0, max)) {
    let mv;
    try { mv = usiToMove(u); } catch { break; }
    if (!mv.drop && !p.board[mv.from]) break;
    out.push(moveToJa(p, mv, prevTo));
    p.applyMove(mv);
    prevTo = mv.to;
  }
  return out;
}

function renderCandidates(lines, status) {
  const el = $('candidates');
  const pos = curPos();
  if (status) {
    el.innerHTML = `<div class="cand-empty">${status}</div>`;
    $('evalValue').textContent = '—';
    $('evalSub').textContent = '';
    $('evalFill').style.width = '50%';
    return;
  }
  el.innerHTML = '';
  lines.forEach((ln, i) => {
    if (!ln || !ln.pv || !ln.pv.length) return;
    const ja = pvToJa(pos, ln.pv);
    if (!ja.length) return;
    const s = senteScore(ln, pos.turn);
    const row = document.createElement('div');
    row.className = 'cand' + (i === 0 ? ' first' : '');
    row.innerHTML = `<span class="no">${i + 1}</span><span class="mv"></span><span class="sc"></span><span class="pv"></span>`;
    row.querySelector('.mv').textContent = ja[0];
    row.querySelector('.sc').textContent = fmtScore(s);
    row.querySelector('.pv').textContent = ja.slice(1).join(' ');
    row.addEventListener('click', () => {
      const mv = usiToMove(ln.pv[0]);
      if (curPos().isLegal(mv)) playMove(mv);
    });
    el.appendChild(row);
  });
  const best = lines[0];
  if (best) {
    const s = senteScore(best, pos.turn);
    $('evalValue').textContent = fmtScore(s);
    const wr = winRate(s);
    $('evalSub').textContent = `先手勝率${Math.round(wr * 100)}% ・ 深さ${best.depth || '-'}`;
    $('evalFill').style.width = `${wr * 100}%`;
  }
}

// ---- 解析 ----
let throttle = 0;
function requestAnalysis() {
  if (!state.engineReady) return;
  if (!state.analyze) { engine.stop(); renderCandidates([], '解析はオフです'); return; }
  const pos = curPos();
  if (!pos.legalMoves().length) {
    engine.stop();
    state.candidates = [];
    renderArrows();
    renderCandidates([], pos.inCheck() ? '詰んでいます' : '指せる手がありません');
    return;
  }
  state.candidates = [];
  renderArrows();
  renderCandidates([], '考えています…');
  const sfen = pos.toSfen();
  engine.search({
    sfen,
    multipv: state.multipv,
    go: 'go infinite',
    onUpdate: (lines) => {
      if (curPos().toSfen() !== sfen) return;
      state.candidates = lines;
      const now = performance.now();
      if (now - throttle < 250) return;
      throttle = now;
      renderCandidates(lines);
      renderArrows();
    },
  });
}

// ---- 操作 ----
function onCellTap(idx) {
  const pos = curPos();
  const pc = pos.board[idx];
  const sel = state.selected;
  if (sel) {
    const ms = pos.legalMoves().filter((m) => m.to === idx && (sel.drop ? m.drop === sel.drop : m.from === sel.from));
    if (ms.length === 1) { playMove(ms[0]); return; }
    if (ms.length === 2) { askPromotion(ms); return; }
  }
  if (pc && colorOf(pc) === pos.turn && !(sel && sel.from === idx)) {
    state.selected = { from: idx };
  } else {
    state.selected = null;
  }
  renderBoard();
}

function onHandTap(color, k) {
  const pos = curPos();
  if (pos.turn !== color) return;
  state.selected = state.selected && state.selected.drop === k ? null : { drop: k };
  renderBoard();
}

function askPromotion(ms) {
  const yes = ms.find((m) => m.promote), no = ms.find((m) => !m.promote);
  const sheet = $('promoSheet');
  sheet.classList.remove('hidden');
  const done = (mv) => {
    sheet.classList.add('hidden');
    $('btnPromoYes').onclick = $('btnPromoNo').onclick = sheet.onclick = null;
    if (mv) playMove(mv); else { state.selected = null; renderBoard(); }
  };
  $('btnPromoYes').onclick = (e) => { e.stopPropagation(); done(yes); };
  $('btnPromoNo').onclick = (e) => { e.stopPropagation(); done(no); };
  sheet.onclick = (e) => { if (e.target === sheet) done(null); };
}

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function loadText(text) {
  try {
    loadGame(parseGameText(text));
  } catch (e) {
    toast('読み込めませんでした: ' + e.message, 4000);
  }
}

async function loadFile(file) {
  const buf = await file.arrayBuffer();
  loadText(decodeBytes(buf));
}

function kifText() {
  return toKif(state.game.startSfen, state.game.moves, state.game.header);
}

function saveKif() {
  const blob = new Blob([kifText()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = `shogi_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.kifu`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      startSfen: state.game.startSfen,
      moves: state.game.moves.map((m) => [moveToUsi(m.move), m.comment]),
      header: state.game.header,
      result: state.game.result,
      branch: state.branch && { base: state.branch.base, moves: state.branch.moves.map((m) => moveToUsi(m.move)) },
      cursor: state.cursor,
      flipped: state.flipped,
      multipv: state.multipv,
      analyze: state.analyze,
    }));
  } catch { /* 保存できなくても動作は続ける */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state.game = {
      startSfen: s.startSfen,
      moves: s.moves.map(([u, c]) => ({ move: usiToMove(u), comment: c || '' })),
      header: s.header || {},
      result: s.result || '',
    };
    state.branch = s.branch ? { base: s.branch.base, moves: s.branch.moves.map((u) => ({ move: usiToMove(u), comment: '' })) } : null;
    state.flipped = !!s.flipped;
    state.multipv = s.multipv || 3;
    state.analyze = s.analyze !== false;
    positions(); // 検証も兼ねる
    state.cursor = Math.min(s.cursor || 0, line().length);
  } catch {
    state.game = { startSfen: STARTPOS, moves: [], header: {}, result: '' };
    state.branch = null;
    state.cursor = 0;
  }
}

function update() {
  renderLabels();
  renderBoard();
  renderControls();
  renderMoveList();
  renderArrows();
  persist();
  requestAnalysis();
}

// 共有で受け取った棋譜
async function checkShared() {
  const p = new URLSearchParams(location.search);
  const kind = p.get('shared');
  if (!kind) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('share');
    const key = kind === 'file' ? 'shared-file' : 'shared-text';
    const res = await c.match(key);
    if (!res) return;
    await c.delete(key);
    if (kind === 'file') loadText(decodeBytes(await res.arrayBuffer()));
    else loadText(await res.text());
  } catch (e) {
    toast('共有された棋譜を読めませんでした');
  }
}

function bindUi() {
  $('btnFirst').onclick = () => goTo(0);
  $('btnPrev').onclick = () => goTo(state.cursor - 1);
  $('btnNext').onclick = () => goTo(state.cursor + 1);
  $('btnLast').onclick = () => goTo(line().length);
  $('btnMainline').onclick = backToMainline;
  $('btnEngine').onclick = () => {
    state.analyze = !state.analyze;
    $('btnEngine').classList.toggle('on', state.analyze);
    persist();
    requestAnalysis();
    renderArrows();
  };
  $('btnEngine').classList.toggle('on', state.analyze);
  const menu = $('menuSheet');
  $('btnMenu').onclick = () => menu.classList.remove('hidden');
  menu.addEventListener('click', async (e) => {
    if (e.target === menu) { menu.classList.add('hidden'); return; }
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.classList.add('hidden');
    if (act === 'openFile') $('fileInput').click();
    if (act === 'paste') { $('pasteSheet').classList.remove('hidden'); $('pasteText').focus(); }
    if (act === 'saveKif') saveKif();
    if (act === 'copyKif') {
      try { await navigator.clipboard.writeText(kifText()); toast('KIFをコピーしました'); } catch { toast('コピーできませんでした'); }
    }
    if (act === 'flip') { state.flipped = !state.flipped; update(); }
    if (act === 'newGame') loadGame({ startSfen: STARTPOS, moves: [], header: {}, result: '' });
  });
  $('selMultiPV').value = String(state.multipv);
  $('selMultiPV').onchange = (e) => { state.multipv = Number(e.target.value); persist(); requestAnalysis(); };
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) loadFile(f);
    e.target.value = '';
  };
  $('btnPasteLoad').onclick = () => {
    $('pasteSheet').classList.add('hidden');
    loadText($('pasteText').value);
    $('pasteText').value = '';
  };
  $('btnPasteCancel').onclick = () => $('pasteSheet').classList.add('hidden');
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') goTo(state.cursor - 1);
    if (e.key === 'ArrowRight') goTo(state.cursor + 1);
  });
}

async function main() {
  restore();
  buildBoard();
  bindUi();
  update();
  await checkShared();
  try {
    await engine.init();
    state.engineReady = true;
    requestAnalysis();
  } catch (e) {
    const msg = e.message === 'crossOriginIsolated'
      ? 'エンジンの準備中です。表示が変わらなければページを再読み込みしてください'
      : 'エンジンを起動できませんでした: ' + e.message;
    renderCandidates([], msg);
    console.error(e);
  }
}

main();
