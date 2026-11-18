import {
  Position, STARTPOS, SENTE, GOTE, HAND_ORDER, PIECE_CHAR, colorOf, typeOf,
  moveToUsi, usiToMove, moveToJa, sameMove, KAN,
} from './shogi.js';
import { parseGameText, toKif, decodeBytes } from './kif.js';
import { Engine } from './engine.js';
import { AiPlayer, LEVELS, STRATEGIES } from './ai.js';
import { analyzeGame, judgeMoves, summarize, scoreForGraph, senteWinRate, DEPTHS } from './review.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'shogi-app:v1';
const REVIEW_KEY = 'shogi-app:review';
const PLAYCFG_KEY = 'shogi-app:playcfg';
const MAX_PLY = 400;

// ---- 状態 ----
const state = {
  game: { startSfen: STARTPOS, moves: [], header: {}, result: '', summary: '' }, // 本譜
  branch: null, // { base: 本譜の何手目から分岐したか, moves: [] }
  cursor: 0, // 表示中の手数
  flipped: false,
  analyze: true,
  multipv: 3,
  reviewDepth: 'normal',
  selected: null, // { from } or { drop }
  candidates: [],
  engineReady: false,
  mode: 'study', // study / play
  play: null,
  review: { key: '', results: [], marks: [], running: false, token: 0, done: 0 },
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
function mainPositions() {
  const list = [new Position(state.game.startSfen)];
  for (const m of state.game.moves) { const p = list[list.length - 1].clone(); p.applyMove(m.move); list.push(p); }
  return list;
}
const curPos = () => positions()[state.cursor];
const prevMove = () => (state.cursor > 0 ? line()[state.cursor - 1].move : null);
const gameKey = () => state.game.startSfen + '|' + state.game.moves.map((m) => moveToUsi(m.move)).join(' ');
const onMainline = () => !state.branch || state.cursor <= state.branch.base;

function playMove(mv) {
  if (state.mode === 'play') { playTurnMove(mv); return; }
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
  if (state.mode === 'play') return;
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

function loadGame(g, { silent = false } = {}) {
  state.game = { startSfen: g.startSfen, moves: g.moves, header: g.header || {}, result: g.result || '', summary: g.summary || '' };
  state.branch = null;
  state.cursor = 0;
  state.selected = null;
  loadReviewFor();
  update();
  if (!silent) toast(`${g.moves.length}手の棋譜を読み込みました`);
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

function playerName(color) {
  if (state.play) return state.play.players[color].label;
  const h = state.game.header || {};
  return (color === SENTE ? h['先手'] || h['下手'] : h['後手'] || h['上手']) || '';
}

function renderHand(el, color) {
  const pos = curPos();
  el.innerHTML = '';
  const lab = document.createElement('span');
  lab.className = 'label';
  lab.textContent = (color === SENTE ? '☗' : '☖') + (pos.turn === color && !state.play ? '手番' : '');
  el.appendChild(lab);
  const nm = playerName(color);
  if (nm) {
    const n = document.createElement('span');
    n.className = 'pname';
    n.textContent = nm;
    el.appendChild(n);
  }
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
  if (state.play && state.play.clock.enabled) {
    const c = document.createElement('span');
    c.className = 'clock';
    c.id = `clock${color}`;
    el.appendChild(c);
  }
}

function renderArrows() {
  const svg = $('arrows');
  const best = state.candidates[0];
  if (state.mode === 'play' || !state.analyze || !best || !best.pv || !best.pv[0]) { svg.innerHTML = ''; return; }
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

function markAt(n) {
  if (!onMainline() || state.review.key !== gameKey()) return null;
  return state.review.marks[n] || null;
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
  $('branchBar').classList.toggle('hidden', !state.branch || state.mode === 'play');
  const cm = n > 0 ? ln[n - 1].comment : '';
  $('comment').textContent = cm || '';
  $('comment').classList.toggle('hidden', !cm);
  const playing = state.mode === 'play';
  for (const id of ['btnFirst', 'btnPrev', 'btnNext', 'btnLast']) $(id).disabled = playing;
}

function renderMoveList() {
  const el = $('moveList');
  const ln = line();
  const ps = positions();
  el.innerHTML = '';
  ln.forEach((m, i) => {
    const s = document.createElement('span');
    const inBranch = state.branch && i >= state.branch.base;
    const mk = !inBranch && state.review.key === gameKey() ? state.review.marks[i + 1] : null;
    s.className = 'm' + (i + 1 === state.cursor ? ' cur' : '') + (inBranch ? ' branch' : '')
      + (mk && mk.kind === '悪手' ? ' bad' : mk && mk.kind === '疑問手' ? ' dub' : '');
    s.textContent = `${i + 1} ${moveToJa(ps[i], m.move, i > 0 ? ln[i - 1].move.to : null)}`;
    s.addEventListener('click', () => goTo(i + 1));
    el.appendChild(s);
  });
  if (!state.branch && state.game.result) {
    const r = document.createElement('span');
    r.className = 'res';
    r.textContent = state.game.summary || state.game.result;
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
  if (!s) return '—';
  if (s.mate != null) {
    const n = Math.abs(s.mate);
    const who = s.mate > 0 ? '▲' : '△';
    if (s.terminal) return `${who}勝ち`;
    return `${who}詰${n >= 999 ? '' : n + '手'}`;
  }
  return (s.cp > 0 ? '+' : '') + s.cp;
}

function pvToJa(pos, pv, prevTo, max = 8) {
  const p = pos.clone();
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

function setEval(s, depth) {
  if (!s) {
    $('evalValue').textContent = '—';
    $('evalSub').textContent = '';
    $('evalFill').style.width = '50%';
    return;
  }
  $('evalValue').textContent = fmtScore(s);
  const wr = senteWinRate(s);
  $('evalSub').textContent = `先手勝率${Math.round(wr * 100)}%` + (depth ? ` ・ 深さ${depth}` : '');
  $('evalFill').style.width = `${wr * 100}%`;
}

function renderCandidates(lines, status) {
  const el = $('candidates');
  const pos = curPos();
  if (status) {
    el.innerHTML = `<div class="cand-empty">${status}</div>`;
    setEval(null);
    return;
  }
  el.innerHTML = '';
  const prevTo = prevMove() ? prevMove().to : null;
  lines.forEach((ln, i) => {
    if (!ln || !ln.pv || !ln.pv.length) return;
    const ja = pvToJa(pos, ln.pv, prevTo);
    if (!ja.length) return;
    const s = senteScore(ln, pos.turn);
    const row = document.createElement('div');
    row.className = 'cand' + (i === 0 ? ' first' : '');
    row.innerHTML = '<span class="no"></span><span class="mv"></span><span class="sc"></span><span class="pv"></span>';
    row.querySelector('.no').textContent = i + 1;
    row.querySelector('.mv').textContent = ja[0];
    row.querySelector('.sc').textContent = fmtScore(s);
    row.querySelector('.pv').textContent = ja.slice(1).join(' ');
    row.addEventListener('click', () => {
      const mv = usiToMove(ln.pv[0]);
      if (curPos().isLegal(mv)) playMove(mv);
    });
    el.appendChild(row);
  });
  if (lines[0]) setEval(senteScore(lines[0], pos.turn), lines[0].depth);
}

// ---- 検討モードの解析 ----
let throttle = 0;
function requestAnalysis() {
  if (!state.engineReady) return;
  if (state.mode === 'play') return;
  if (state.review.running) { renderCandidates([], '局後解析中です…'); return; }
  if (!state.analyze) { engine.stop(); state.candidates = []; renderCandidates([], '解析はオフです'); return; }
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
      if (state.mode === 'play' || curPos().toSfen() !== sfen) return;
      state.candidates = lines;
      const now = performance.now();
      if (now - throttle < 250) return;
      throttle = now;
      renderCandidates(lines);
      renderArrows();
    },
  });
}

// ---- 対局 ----
function loadPlayCfg() {
  try { return JSON.parse(localStorage.getItem(PLAYCFG_KEY)) || null; } catch { return null; }
}

function setupPlaySheet() {
  const cfg = loadPlayCfg() || {
    players: [{ type: 'human', level: 5, strategy: 'auto' }, { type: 'ai', level: 5, strategy: 'auto' }],
    main: 600, byo: 30,
  };
  document.querySelectorAll('.side-cfg').forEach((row) => {
    const side = Number(row.dataset.side);
    const p = cfg.players[side];
    const lv = row.querySelector('.p-level');
    const st = row.querySelector('.p-strategy');
    const ty = row.querySelector('.p-type');
    lv.innerHTML = LEVELS.slice(1).map((l, i) => `<option value="${i + 1}">${l.name}</option>`).join('');
    st.innerHTML = Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    ty.value = p.type;
    lv.value = String(p.level);
    st.value = p.strategy;
    const sync = () => { const ai = ty.value === 'ai'; lv.disabled = !ai; st.disabled = !ai; };
    ty.onchange = sync;
    sync();
  });
  $('selMain').value = String(cfg.main);
  $('selByo').value = String(cfg.byo);
}

function readPlaySheet() {
  const players = [];
  document.querySelectorAll('.side-cfg').forEach((row) => {
    players[Number(row.dataset.side)] = {
      type: row.querySelector('.p-type').value,
      level: Number(row.querySelector('.p-level').value),
      strategy: row.querySelector('.p-strategy').value,
    };
  });
  const cfg = { players, main: Number($('selMain').value), byo: Number($('selByo').value) };
  try { localStorage.setItem(PLAYCFG_KEY, JSON.stringify(cfg)); } catch { /* 無視 */ }
  return cfg;
}

function startPlay(cfg, fromHere) {
  if (!state.engineReady && cfg.players.some((p) => p.type === 'ai')) {
    toast('エンジンの準備ができてから始めてください');
    return;
  }
  engine.stop();
  const startSfen = fromHere ? curPos().toSfen() : STARTPOS;
  const humans = cfg.players.filter((p) => p.type === 'human').length;
  const players = cfg.players.map((p, side) => {
    if (p.type === 'ai') {
      const ai = new AiPlayer(engine, { level: p.level, strategy: p.strategy });
      const stName = p.strategy === 'auto' ? 'おまかせ' : ai.strategyName;
      return { ...p, ai, label: `AI ${LEVELS[p.level].name.split(' ')[0]}`, detail: stName };
    }
    return { ...p, label: humans === 1 ? 'あなた' : (side === 0 ? '先手' : '後手') };
  });
  const enabled = cfg.main > 0 || cfg.byo > 0;
  state.play = {
    players,
    clock: { enabled, main: [cfg.main * 1000, cfg.main * 1000], byoyomi: cfg.byo * 1000, turnStart: performance.now() },
    thinkId: 0,
    over: false,
    prevAnalyze: state.analyze,
  };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  state.game = {
    startSfen,
    moves: [],
    header: {
      '開始日時': `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      '先手': players[0].label + (players[0].ai ? `（${players[0].detail}）` : ''),
      '後手': players[1].label + (players[1].ai ? `（${players[1].detail}）` : ''),
      '持ち時間': cfg.main ? `${cfg.main / 60}分` + (cfg.byo ? `+秒読み${cfg.byo}秒` : '') : (cfg.byo ? `秒読み${cfg.byo}秒` : 'なし'),
    },
    result: '',
    summary: '',
  };
  state.branch = null;
  state.cursor = 0;
  state.selected = null;
  state.mode = 'play';
  state.candidates = [];
  // 人が後手で相手がAIなら、盤を自分側から見る
  if (humans === 1) state.flipped = players[1].type === 'human';
  $('playBar').classList.remove('hidden');
  $('btnUndo').disabled = humans === 0;
  renderPlayInfo();
  renderCandidates([], '対局中です。解析は対局のあとにできます');
  update();
  startClockTimer();
  nextTurn();
}

function renderPlayInfo() {
  if (!state.play) return;
  const [a, b] = state.play.players;
  const desc = (p) => p.label + (p.ai && p.detail !== 'おまかせ' ? `・${p.detail}` : '');
  $('playInfo').textContent = `☗${desc(a)} 対 ☖${desc(b)}`;
}

function elapsedNow() {
  return performance.now() - state.play.clock.turnStart;
}

function clockText(side) {
  const c = state.play.clock;
  const moving = curPos().turn === side && !state.play.over;
  const el = moving ? elapsedNow() : 0;
  const main = c.main[side] - el;
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (main > 0 || !c.byoyomi) return { text: fmt(Math.max(0, main)), byo: false, moving };
  const left = c.byoyomi + main; // main は負
  return { text: `秒読み ${Math.max(0, Math.ceil(left / 1000))}`, byo: true, moving };
}

let clockTimer = null;
function startClockTimer() {
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 200);
  tickClock();
}
function tickClock() {
  const p = state.play;
  if (!p || p.over) { clearInterval(clockTimer); return; }
  const c = p.clock;
  if (!c.enabled) return;
  for (const side of [SENTE, GOTE]) {
    const el = $(`clock${side}`);
    if (!el) continue;
    const t = clockText(side);
    el.textContent = t.text;
    el.className = 'clock' + (t.moving ? ' active' : '') + (t.byo && t.moving ? ' byo' : '');
  }
  // 時間切れ
  const side = curPos().turn;
  const over = elapsedNow() - c.main[side];
  if (over > 0 && (!c.byoyomi || over > c.byoyomi + 300)) {
    endPlay('切れ負け', 1 - side);
  }
}

function canHumanMove() {
  if (state.mode !== 'play') return true;
  const p = state.play;
  return !p.over && p.players[curPos().turn].type === 'human';
}

function playTurnMove(mv) {
  const p = state.play;
  if (!p || p.over) return;
  const side = curPos().turn;
  const c = p.clock;
  if (c.enabled) c.main[side] = Math.max(0, c.main[side] - elapsedNow());
  c.turnStart = performance.now();
  state.game.moves.push({ move: mv, comment: '' });
  state.cursor = state.game.moves.length;
  state.selected = null;
  update();
  if (checkEnd()) return;
  nextTurn();
}

function checkEnd() {
  const ps = positions();
  const pos = ps[ps.length - 1];
  if (!pos.legalMoves().length) { endPlay('詰み', 1 - pos.turn); return true; }
  const key = pos.toSfen(false);
  const same = ps.filter((q) => q.toSfen(false) === key).length;
  if (same >= 4) { endPlay('千日手', null); return true; }
  if (state.game.moves.length >= MAX_PLY) { endPlay('持将棋', null); return true; }
  return false;
}

async function nextTurn() {
  const p = state.play;
  if (!p || p.over) return;
  const side = curPos().turn;
  const pl = p.players[side];
  if (pl.type !== 'ai') return;
  const id = ++p.thinkId;
  const t0 = performance.now();
  const pos = curPos().clone();
  const res = await pl.ai.think(pos, p.clock.enabled ? {
    enabled: true,
    main: [p.clock.main[0] - (side === 0 ? elapsedNow() : 0), p.clock.main[1] - (side === 1 ? elapsedNow() : 0)],
    byoyomi: p.clock.byoyomi,
  } : null);
  if (!res || state.play !== p || p.over || p.thinkId !== id) return;
  // 一瞬で指すと不自然なので少し待つ（AI同士は観戦しやすい間隔）
  const bothAi = p.players.every((x) => x.type === 'ai');
  const minWait = bothAi ? 700 : 400;
  const waited = performance.now() - t0;
  if (waited < minWait) await new Promise((r) => setTimeout(r, minWait - waited));
  if (state.play !== p || p.over || p.thinkId !== id) return;
  if (res.resign) { endPlay('投了', 1 - side); return; }
  if (res.win) { endPlay('入玉勝ち', side); return; }
  if (!curPos().isLegal(res.move)) { endPlay('中断', null); return; }
  playTurnMove(res.move);
}

function endPlay(word, winner) {
  const p = state.play;
  if (!p || p.over) return;
  p.over = true;
  p.thinkId++;
  engine.stop();
  clearInterval(clockTimer);
  const n = state.game.moves.length;
  state.game.result = word;
  state.game.summary = winner == null
    ? `まで${n}手で${word === '中断' ? '中断' : word}`
    : `まで${n}手で${winner === SENTE ? '先手' : '後手'}の勝ち`;
  state.mode = 'study';
  state.analyze = p.prevAnalyze;
  $('playBar').classList.add('hidden');
  $('btnEngine').classList.toggle('on', state.analyze);
  const humans = p.players.filter((x) => x.type === 'human');
  let head = state.game.summary;
  if (humans.length === 1 && winner != null) {
    const hs = p.players.findIndex((x) => x.type === 'human');
    head = (hs === winner ? 'あなたの勝ち' : 'あなたの負け') + `（${word}）`;
  }
  state.play = null;
  $('endText').textContent = head === state.game.summary ? head : `${head}\n${state.game.summary}`;
  $('endSheet').classList.remove('hidden');
  update();
}

function undoMove() {
  const p = state.play;
  if (!p || p.over) return;
  const humans = p.players.map((x, i) => (x.type === 'human' ? i : -1)).filter((i) => i >= 0);
  if (!humans.length || !state.game.moves.length) return;
  p.thinkId++;
  engine.stop();
  state.game.moves.pop();
  // 人対AIなら、人の手番に戻るまで戻す
  while (state.game.moves.length && p.players[positions()[state.game.moves.length].turn].type === 'ai') {
    state.game.moves.pop();
    posCache.key = '';
  }
  posCache.key = '';
  state.cursor = state.game.moves.length;
  p.clock.turnStart = performance.now();
  // 戻した分の駒組みをやり直せるように、AIの進み具合を最初から数え直す
  for (const pl of p.players) if (pl.ai) { pl.ai.planIdx = 0; pl.ai.planFails = 0; }
  update();
  nextTurn();
}

// ---- 局後解析 ----
function saveReview() {
  try {
    const r = state.review;
    localStorage.setItem(REVIEW_KEY, JSON.stringify({ key: r.key, results: r.results }));
  } catch { /* 無視 */ }
}
function loadReviewFor() {
  const r = state.review;
  r.token++;
  r.running = false;
  const key = gameKey();
  try {
    const s = JSON.parse(localStorage.getItem(REVIEW_KEY));
    if (s && s.key === key) {
      r.key = key;
      r.results = s.results;
      r.marks = judgeMoves(state.game.startSfen, state.game.moves, r.results);
      return;
    }
  } catch { /* 無視 */ }
  r.key = '';
  r.results = [];
  r.marks = [];
}

async function startReview() {
  if (!state.engineReady) { toast('エンジンの準備ができてから実行してください'); return; }
  if (state.mode === 'play') return;
  if (!state.game.moves.length) { toast('解析する指し手がありません'); return; }
  const r = state.review;
  const key = gameKey();
  if (r.key !== key) { r.key = key; r.results = []; r.marks = []; }
  const token = ++r.token;
  r.running = true;
  r.done = 0;
  engine.stop();
  state.candidates = [];
  renderArrows();
  renderCandidates([], '局後解析中です…');
  renderReview();
  const total = state.game.moves.length + 1;
  let last = 0;
  const res = await analyzeGame(engine, state.game.startSfen, state.game.moves, {
    movetime: DEPTHS[state.reviewDepth].movetime,
    results: r.results,
    isCancelled: () => r.token !== token,
    onProgress: (i, results) => {
      if (r.token !== token) return;
      r.done = i + 1;
      r.results = results;
      r.marks = judgeMoves(state.game.startSfen, state.game.moves, results);
      const now = performance.now();
      if (now - last > 400 || i + 1 === total) {
        last = now;
        renderReview();
        renderMoveList();
      }
    },
  });
  if (r.token !== token) return;
  r.running = false;
  if (res) {
    r.results = res;
    r.marks = judgeMoves(state.game.startSfen, state.game.moves, res);
    saveReview();
    const s = summarize(r.marks);
    toast(`解析が終わりました（悪手 ☗${s[0].bad} ☖${s[1].bad}）`);
  }
  update();
}

function stopReview() {
  const r = state.review;
  if (!r.running) return;
  r.token++;
  r.running = false;
  engine.stop();
  saveReview();
  update();
}

function renderReview() {
  const r = state.review;
  const panel = $('reviewPanel');
  const has = r.key === gameKey() && (r.results.length || r.running);
  panel.classList.toggle('hidden', !has || state.mode === 'play');
  if (!has) return;
  const total = state.game.moves.length + 1;
  $('reviewStatus').textContent = r.running ? `局後解析中 ${r.done}/${total}` : '局後解析';
  $('reviewProgress').classList.toggle('hidden', !r.running);
  $('reviewProgressFill').style.width = `${(r.done / total) * 100}%`;
  $('btnReviewStop').classList.toggle('hidden', !r.running);
  renderGraph();
  // 今の手の評価
  const n = state.cursor;
  const box = $('reviewMove');
  box.innerHTML = '';
  if (onMainline() && n > 0 && r.results[n]) {
    const mps = mainPositions();
    const mv = state.game.moves[n - 1].move;
    const prevTo = n > 1 ? state.game.moves[n - 2].move.to : null;
    const ja = moveToJa(mps[n - 1], mv, prevTo);
    const mk = r.marks[n];
    const head = document.createElement('div');
    head.append(`${n}手目 ${ja}`);
    if (mk && mk.kind) {
      const sp = document.createElement('span');
      sp.className = mk.kind === '悪手' ? 'bad' : 'dub';
      const why = mk.note || (mk.cpLoss >= 200 && mk.drop < 0.1 ? `評価値 -${mk.cpLoss}` : `勝率 -${Math.round(mk.drop * 100)}%`);
      sp.textContent = ` ${mk.kind}（${why}）`;
      head.append(sp);
    } else if (mk && mk.match) {
      head.append(' 最善手と一致');
    }
    head.append(` ・ 評価値 ${fmtScore(r.results[n].score)}`);
    box.appendChild(head);
    if (mk && mk.best && !mk.match) {
      const bestMv = usiToMove(mk.best);
      const bestRow = document.createElement('div');
      const pv = r.results[n - 1].pv || [];
      const pvJa = pvToJa(mps[n - 1], pv.length ? pv : [mk.best], prevTo, 6);
      bestRow.textContent = `最善は ${pvJa[0] || moveToJa(mps[n - 1], bestMv, prevTo)}` + (pvJa.length > 1 ? `（${pvJa.slice(1).join(' ')}）` : '');
      const btn = document.createElement('button');
      btn.textContent = '最善手を指してみる';
      btn.className = 'mini';
      btn.onclick = () => {
        state.branch = null;
        state.cursor = n - 1;
        playMove(bestMv);
      };
      bestRow.appendChild(btn);
      box.appendChild(bestRow);
    }
  } else if (n === 0 && r.results[0]) {
    box.textContent = `開始局面 ・ 評価値 ${fmtScore(r.results[0].score)}`;
  }
  // まとめ
  const s = summarize(r.marks);
  const line = (side, t) => `${side === 0 ? '☗先手' : '☖後手'}  悪手 ${t.bad}・疑問手 ${t.dubious}・最善手一致率 ${t.moves ? Math.round((t.match / t.moves) * 100) : 0}%`;
  $('reviewSum').innerHTML = '';
  for (const side of [0, 1]) {
    const d = document.createElement('div');
    d.textContent = line(side, s[side]);
    $('reviewSum').appendChild(d);
  }
}

function renderGraph() {
  const svg = $('graph');
  const r = state.review;
  const n = state.game.moves.length;
  const W = 1000, H = 100;
  const x = (i) => (n ? (i / n) * W : 0);
  const y = (sc) => H / 2 - (scoreForGraph(sc) / 3000) * (H / 2 - 4);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let pts = '';
  let area = `M0,${H / 2}`;
  for (let i = 0; i <= n; i++) {
    const res = r.results[i];
    if (!res) break;
    pts += `${x(i)},${y(res.score)} `;
    area += ` L${x(i)},${y(res.score)}`;
  }
  const lastI = Math.min(n, r.results.length - 1);
  area += ` L${x(Math.max(0, lastI))},${H / 2} Z`;
  let marks = '';
  r.marks.forEach((m, i) => {
    if (!m || !m.kind || !r.results[i]) return;
    marks += `<circle cx="${x(i)}" cy="${y(r.results[i].score)}" r="${m.kind === '悪手' ? 7 : 5}" fill="${m.kind === '悪手' ? '#e0675a' : '#e8c35a'}" />`;
  });
  const cx = onMainline() ? x(state.cursor) : x(state.branch.base);
  svg.innerHTML = `
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#5a4a36" stroke-width="1"/>
    <path d="${area}" fill="rgba(243,234,217,0.12)"/>
    <polyline points="${pts}" fill="none" stroke="#f3ead9" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${marks}
    <line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#e07b39" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function jumpMistake(dir) {
  const r = state.review;
  if (state.branch) backToMainline();
  const n = state.game.moves.length;
  for (let i = state.cursor + dir; i >= 1 && i <= n; i += dir) {
    const m = r.marks[i];
    if (m && m.kind) { goTo(i); return; }
  }
  toast(dir > 0 ? 'この先に悪手・疑問手はありません' : 'この前に悪手・疑問手はありません');
}

// ---- 操作 ----
function onCellTap(idx) {
  if (!canHumanMove()) return;
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
  if (state.play) tickClock();
}

function onHandTap(color, k) {
  if (!canHumanMove()) return;
  const pos = curPos();
  if (pos.turn !== color) return;
  state.selected = state.selected && state.selected.drop === k ? null : { drop: k };
  renderBoard();
  if (state.play) tickClock();
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
  if (state.mode === 'play') { toast('対局中は読み込めません'); return; }
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
  return toKif(state.game.startSfen, state.game.moves, state.game.header, state.game.result, state.game.summary);
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
      summary: state.game.summary,
      branch: state.branch && { base: state.branch.base, moves: state.branch.moves.map((m) => moveToUsi(m.move)) },
      cursor: state.cursor,
      flipped: state.flipped,
      multipv: state.multipv,
      analyze: state.mode === 'play' ? state.play.prevAnalyze : state.analyze,
      reviewDepth: state.reviewDepth,
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
      summary: s.summary || '',
    };
    state.branch = s.branch ? { base: s.branch.base, moves: s.branch.moves.map((u) => ({ move: usiToMove(u), comment: '' })) } : null;
    state.flipped = !!s.flipped;
    state.multipv = s.multipv || 3;
    state.analyze = s.analyze !== false;
    state.reviewDepth = s.reviewDepth || 'normal';
    positions(); // 検証も兼ねる
    state.cursor = Math.min(s.cursor || 0, line().length);
  } catch {
    state.game = { startSfen: STARTPOS, moves: [], header: {}, result: '', summary: '' };
    state.branch = null;
    state.cursor = 0;
  }
  loadReviewFor();
}

function update() {
  renderLabels();
  renderBoard();
  renderControls();
  renderMoveList();
  renderArrows();
  renderReview();
  if (state.play) tickClock();
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
    if (state.mode === 'play') { toast('対局中は解析できません'); return; }
    state.analyze = !state.analyze;
    $('btnEngine').classList.toggle('on', state.analyze);
    persist();
    requestAnalysis();
    renderArrows();
  };
  $('btnEngine').classList.toggle('on', state.analyze);
  const menu = $('menuSheet');
  $('btnMenu').onclick = () => {
    if (state.mode === 'play') { toast('対局中はメニューを使えません。終えるときは中断を押してください'); return; }
    menu.classList.remove('hidden');
  };
  menu.addEventListener('click', async (e) => {
    if (e.target === menu) { menu.classList.add('hidden'); return; }
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.classList.add('hidden');
    if (act === 'play') { setupPlaySheet(); $('playSheet').classList.remove('hidden'); }
    if (act === 'review') startReview();
    if (act === 'openFile') $('fileInput').click();
    if (act === 'paste') { $('pasteSheet').classList.remove('hidden'); $('pasteText').focus(); }
    if (act === 'saveKif') saveKif();
    if (act === 'copyKif') {
      try { await navigator.clipboard.writeText(kifText()); toast('KIFをコピーしました'); } catch { toast('コピーできませんでした'); }
    }
    if (act === 'flip') { state.flipped = !state.flipped; update(); }
    if (act === 'newGame') loadGame({ startSfen: STARTPOS, moves: [], header: {}, result: '' }, { silent: true });
  });
  $('selMultiPV').value = String(state.multipv);
  $('selMultiPV').onchange = (e) => { state.multipv = Number(e.target.value); persist(); requestAnalysis(); };
  $('selReviewDepth').value = state.reviewDepth;
  $('selReviewDepth').onchange = (e) => { state.reviewDepth = e.target.value; persist(); };
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

  // 対局
  $('btnPlayStart').onclick = () => {
    $('playSheet').classList.add('hidden');
    startPlay(readPlaySheet(), $('chkFromHere').checked);
  };
  $('btnPlayCancel').onclick = () => $('playSheet').classList.add('hidden');
  $('btnUndo').onclick = undoMove;
  $('btnResign').onclick = () => {
    const p = state.play;
    if (!p || p.over) return;
    const humans = p.players.map((x, i) => (x.type === 'human' ? i : -1)).filter((i) => i >= 0);
    if (!humans.length) return;
    const side = humans.length === 1 ? humans[0] : curPos().turn;
    if (!confirmSheetless('投了しますか？')) return;
    endPlay('投了', 1 - side);
  };
  $('btnAbort').onclick = () => { if (confirmSheetless('対局を中断しますか？')) endPlay('中断', null); };
  $('btnEndReview').onclick = () => { $('endSheet').classList.add('hidden'); state.cursor = 0; startReview(); };
  $('btnEndClose').onclick = () => $('endSheet').classList.add('hidden');
  $('endSheet').addEventListener('click', (e) => { if (e.target === $('endSheet')) $('endSheet').classList.add('hidden'); });
  for (const id of ['playSheet', 'pasteSheet']) {
    $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).classList.add('hidden'); });
  }

  // 局後解析
  $('btnReviewStop').onclick = stopReview;
  $('btnPrevBad').onclick = () => jumpMistake(-1);
  $('btnNextBad').onclick = () => jumpMistake(1);
  $('graph').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const n = state.game.moves.length;
    const i = Math.round(((e.clientX - rect.left) / rect.width) * n);
    if (state.branch) backToMainline();
    goTo(i);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') goTo(state.cursor - 1);
    if (e.key === 'ArrowRight') goTo(state.cursor + 1);
  });
}

// 確認（2回押しで確定する簡易版。ブラウザのダイアログは使わない）
const confirmState = { msg: '', at: 0 };
function confirmSheetless(msg) {
  const now = Date.now();
  if (confirmState.msg === msg && now - confirmState.at < 3000) { confirmState.msg = ''; return true; }
  confirmState.msg = msg;
  confirmState.at = now;
  toast(`${msg} もう一度押すと確定します`, 3000);
  return false;
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
