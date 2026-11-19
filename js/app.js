import {
  Position, STARTPOS, SENTE, GOTE, HAND_ORDER, PIECE_CHAR, colorOf, typeOf,
  moveToUsi, usiToMove, moveToJa, sameMove, KAN,
} from './shogi.js';
import { parseGameText, toKif, decodeBytes } from './kif.js';
import { Engine } from './engine.js';
import { AiPlayer, LEVELS, STRATEGIES, CASTLES, castleFits } from './ai.js';
import { loadBook, bookReady } from './book.js';
import { analyzeGame, judgeMoves, summarize, scoreForGraph, senteWinRate, DEPTHS } from './review.js';
import { playPieceSound, playBeep, unlockAudio } from './sound.js';
import { moveReading, speak, speechSupported } from './speech.js';
import {
  getAllGames, getGame, putGame, deleteGame, getAllProblems, putProblem, deleteProblem,
  buildRecord, buildProblems, aggregate, pct, STRATEGY_NAMES,
} from './records.js';
import { value as lineValue } from './ai.js';
import { computeRatings, rankOf, nextRank, isRated, timeClass, TIME_CLASSES, AI_RATING, PROVISIONAL_GAMES } from './rating.js';

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
  analyze: false, // 起動時は解析しない（解析ボタンで始める）
  multipv: 3,
  reviewDepth: 'normal',
  sound: true,
  clockSound: true,
  speech: false,
  speechStyle: 'kana',
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
// 復習の対象にする側（自分の指し手）。null なら両方
const mySide = () => (state.game.meta && state.game.meta.mySide != null ? state.game.meta.mySide : null);
const isMine = (side) => mySide() == null || side === mySide();
const AI_NAME = /(ぴよ|AI|Lv|レベル|ＣＰＵ|CPU|コンピュータ|やねうら|水匠|elmo|ponanza|bonanza|技巧|dlshogi)/i;
function guessMySide(h = {}) {
  const s = h['先手'] || h['下手'] || '', g = h['後手'] || h['上手'] || '';
  const me = /^(あなた|自分|わたし|私|you)$/i;
  if (me.test(s.trim())) return 0;
  if (me.test(g.trim())) return 1;
  if (AI_NAME.test(g) && !AI_NAME.test(s)) return 0;
  if (AI_NAME.test(s) && !AI_NAME.test(g)) return 1;
  return null;
}

function sound() { if (state.sound) { try { playPieceSound(); } catch { /* 無視 */ } } }
function beep(high) { try { playBeep(high); } catch { /* 無視 */ } }
// 指し手の読み上げ（pos は指す前の局面）。対局中だけ読む
function announce(pos, mv, prevTo) {
  if (!state.speech || state.mode !== 'play') return;
  try { speak(moveReading(pos, mv, prevTo, state.speechStyle)); } catch { /* 無視 */ }
}

function playMove(mv) {
  if (state.mode === 'play') { playTurnMove(mv); return; }
  if (state.mode === 'practice') { answerPractice(mv); return; }
  sound();

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
  if (state.mode === 'play' || state.mode === 'practice') return;
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
  state.game = {
    startSfen: g.startSfen, moves: g.moves, header: g.header || {}, result: g.result || '', summary: g.summary || '',
    meta: { mySide: guessMySide(g.header) },
  };
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
    if (last && last.to === idx) cls += ' last';
    else if (last && last.from === idx) cls += ' lastfrom';
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
  if (aiThinkingTurn() || !state.analyze || !best || !best.pv || !best.pv[0]) { svg.innerHTML = ''; return; }
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
  const playing = state.mode === 'play' || state.mode === 'practice';
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
    let mk = !inBranch && state.review.key === gameKey() ? state.review.marks[i + 1] : null;
    if (mk && !isMine(mk.side)) mk = null;
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
  // 棋譜の枠の中だけをスクロールする（画面全体は動かさない）
  const cur = el.querySelector('.cur');
  if (cur) {
    const top = cur.offsetTop;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + cur.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + cur.offsetHeight - el.clientHeight;
  }
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
// 対局中にAIが考えている手番か（そのあいだエンジンには触らない）
function aiThinkingTurn() {
  const p = state.play;
  return state.mode === 'play' && p && !p.over && p.players[curPos().turn].type === 'ai';
}

function requestAnalysis() {
  if (!state.engineReady) return;
  if (state.mode === 'practice') return; // 復習中は答えが見えないようにエンジンを止めておく
  if (aiThinkingTurn()) {
    state.candidates = [];
    renderArrows();
    renderCandidates([], state.analyze ? 'AIが考えています…' : '解析はオフです（解析ボタンでオン）');
    return;
  }
  if (state.review.running) { renderCandidates([], '局後解析中です…'); return; }
  if (!state.analyze) { engine.stop(); state.candidates = []; renderArrows(); renderCandidates([], '解析はオフです（解析ボタンでオン）'); return; }
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
      if (aiThinkingTurn() || curPos().toSfen() !== sfen) return;
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
    players: [{ type: 'human', level: 5, strategy: 'auto', castle: 'auto' }, { type: 'ai', level: 5, strategy: 'auto', castle: 'auto' }],
    main: 600, byo: 30,
  };
  document.querySelectorAll('.side-cfg').forEach((row) => {
    const side = Number(row.dataset.side);
    const p = cfg.players[side];
    const lv = row.querySelector('.p-level');
    const st = row.querySelector('.p-strategy');
    const ty = row.querySelector('.p-type');
    const ca = row.querySelector('.p-castle');
    lv.innerHTML = LEVELS.slice(1).map((l, i) => `<option value="${i + 1}">${l.name}（R${AI_RATING[i + 1]}）</option>`).join('');
    st.innerHTML = Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}">${v.name}${v.note ? '（相手次第）' : ''}</option>`).join('');
    ca.innerHTML = Object.entries(CASTLES).filter(([, v]) => !v.hidden)
      .map(([k, v]) => `<option value="${k}">${k === 'auto' ? '囲い: ' : ''}${v.name}${v.side ? (v.side === 'right' ? '（振り飛車）' : '（居飛車）') : ''}</option>`).join('');
    ty.value = p.type;
    lv.value = String(p.level);
    st.value = STRATEGIES[p.strategy] ? p.strategy : 'auto';
    ca.value = CASTLES[p.castle] ? p.castle : 'auto';
    const sync = () => {
      const ai = ty.value === 'ai';
      lv.disabled = !ai; st.disabled = !ai; ca.disabled = !ai;
      // 戦法に合わない囲いは選べないようにする
      for (const o of ca.options) o.disabled = o.value !== 'auto' && !castleFits(st.value, o.value);
      if (ca.selectedOptions[0] && ca.selectedOptions[0].disabled) ca.value = 'auto';
    };
    ty.onchange = sync;
    st.onchange = sync;
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
      castle: row.querySelector('.p-castle').value,
    };
  });
  const cfg = { players, main: Number($('selMain').value), byo: Number($('selByo').value) };
  try { localStorage.setItem(PLAYCFG_KEY, JSON.stringify(cfg)); } catch { /* 無視 */ }
  return cfg;
}

async function startPlay(cfg, fromHere) {
  if (cfg.players.some((p) => p.type === 'ai') && !bookReady()) {
    toast('定跡を読み込んでいます…', 10000);
    try { await Promise.race([loadBook(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]); toast('定跡を読み込みました', 1500); }
    catch { toast('定跡を読み込めなかったので、定跡なしで始めます', 3000); }
  }
  if (!state.engineReady && cfg.players.some((p) => p.type === 'ai')) {
    toast('エンジンの準備ができてから始めてください');
    return;
  }
  engine.stop();
  const startSfen = fromHere ? curPos().toSfen() : STARTPOS;
  const humans = cfg.players.filter((p) => p.type === 'human').length;
  const players = cfg.players.map((p, side) => {
    if (p.type === 'ai') {
      const ai = new AiPlayer(engine, { level: p.level, strategy: p.strategy, castle: p.castle || 'auto' });
      const real = ai.strategyName + (ai.castleName && !CASTLES[ai.castleKey].hidden ? `・${ai.castleName}` : '');
      const stName = p.strategy === 'auto' ? 'ランダム' : real;
      return { ...p, ai, label: `AI ${LEVELS[p.level].name.split(' ')[0]}`, detail: stName, real };
    }
    return { ...p, label: humans === 1 ? 'あなた' : (side === 0 ? '先手' : '後手') };
  });
  const enabled = cfg.main > 0 || cfg.byo > 0;
  state.play = {
    players,
    clock: { enabled, main: [cfg.main * 1000, cfg.main * 1000], byoyomi: cfg.byo * 1000, turnStart: performance.now() },
    timeControl: { main: cfg.main, byo: cfg.byo },
    undoCount: 0,
    thinkId: 0,
    over: false,
    beep: { lastMin: [null, null], marks: new Set(), side: null },
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
    meta: { mySide: humans === 1 ? players.findIndex((x) => x.type === 'human') : null },
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
  // 時間の音（人の手番だけ）。持ち時間は1分ごと、秒読みは残り30秒で1回、10秒からは毎秒
  const side = curPos().turn;
  if (p.players[side].type === 'human' && state.clockSound) {
    const b = p.beep;
    if (b.side !== side) { b.side = side; b.marks = new Set(); }
    const mainLeft = c.main[side] - elapsedNow();
    if (mainLeft > 0) {
      const m = Math.ceil(mainLeft / 60000);
      // 残りが10分を切ってから、1分ごとに鳴らす
      if (b.lastMin[side] != null && m < b.lastMin[side] && m <= 10) beep(false);
      b.lastMin[side] = m;
    } else if (c.byoyomi) {
      const left = Math.ceil((c.byoyomi + mainLeft) / 1000);
      if (left <= 30 && left > 10 && !b.marks.has(30)) { b.marks.add(30); beep(false); }
      if (left <= 10 && left >= 1 && !b.marks.has(left)) { b.marks.add(left); beep(left <= 3); }
    }
  }
  // 時間切れ
  const over = elapsedNow() - c.main[side];
  if (over > 0 && (!c.byoyomi || over > c.byoyomi + 300)) {
    endPlay('切れ負け', 1 - side);
  }
}

function canHumanMove() {
  if (state.mode === 'practice') return state.practice && state.practice.phase === 'ask';
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
  sound();
  announce(curPos(), mv, prevMove() ? prevMove().to : null);
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
  const clk = p.clock.enabled ? {
    enabled: true,
    main: [p.clock.main[0] - (side === 0 ? elapsedNow() : 0), p.clock.main[1] - (side === 1 ? elapsedNow() : 0)],
    byoyomi: p.clock.byoyomi,
  } : null;
  const pace = pl.ai.paceMs(clk, side, pos.ply);
  const res = await pl.ai.think(pos, clk);
  if (!res || state.play !== p || p.over || p.thinkId !== id) return;
  // 一瞬で指すと不自然なので少し待つ（AI同士は観戦しやすい間隔）
  const bothAi = p.players.every((x) => x.type === 'ai');
  const minWait = Math.max(bothAi ? 700 : 400, pace);
  const waited = performance.now() - t0;
  if (waited < minWait) await new Promise((r) => setTimeout(r, minWait - waited));
  if (state.play !== p || p.over || p.thinkId !== id) return;
  if (res.resign) { endPlay('投了', 1 - side); return; }
  if (res.win) { endPlay('入玉勝ち', side); return; }
  if (!curPos().isLegal(res.move)) { endPlay('中断', null); return; }
  playTurnMove(res.move);
}

function endPlay(word, winner, { record = true } = {}) {
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
  $('playBar').classList.add('hidden');
  $('btnEngine').classList.toggle('on', state.analyze);
  const humans = p.players.filter((x) => x.type === 'human');
  let head = state.game.summary;
  if (humans.length === 1 && winner != null) {
    const hs = p.players.findIndex((x) => x.type === 'human');
    head = (hs === winner ? 'あなたの勝ち' : 'あなたの負け') + `（${word}）`;
  }
  // 対局の記録を残す（局後解析をすると内容が追加される）
  const aiP = p.players.find((x) => x.type === 'ai');
  const ratedGame = record && humans.length === 1 && aiP;
  const saving = record ? saveRecord('play', humans.length === 1 && aiP ? aiP.level : null, { timeControl: p.timeControl, undo: p.undoCount }) : null;
  if (ratedGame && saving) saving.then((key) => showRatingChange(key, p.undoCount));
  // ランダムにしていたAIの戦法を明かす
  const reveal = p.players.map((x, i) => (x.ai ? `${i === 0 ? '☗' : '☖'}${x.label}の戦法: ${x.real}` : '')).filter(Boolean).join('\n');
  state.play = null;
  setTimeout(askPendingUpdate, 1500);
  $('endRating').textContent = '';
  if (state.speech) setTimeout(() => speak(`${word === '詰み' ? 'つみ' : word}。${state.game.summary}`), 900);
  $('endText').textContent = (head === state.game.summary ? head : `${head}\n${state.game.summary}`)
    + (reveal ? `\n${reveal}` : '') + (record ? '' : '\n（戦績には記録していません）');
  $('endSheet').classList.remove('hidden');
  update();
}

function undoMove() {
  const p = state.play;
  if (!p || p.over) return;
  const humans = p.players.map((x, i) => (x.type === 'human' ? i : -1)).filter((i) => i >= 0);
  if (!humans.length || !state.game.moves.length) return;
  p.thinkId++;
  p.undoCount++;
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
  r.done = r.results.filter(Boolean).length;
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
    // 見ている手を優先する（本譜上の位置。変化を検討中なら分岐点）
    getFocus: () => (state.branch ? state.branch.base : state.cursor),
    onProgress: (i, results) => {
      if (r.token !== token) return;
      r.done = results.filter(Boolean).length;
      r.results = results;
      r.marks = judgeMoves(state.game.startSfen, state.game.moves, results);
      const now = performance.now();
      if (now - last > 400 || r.done === total || i === state.cursor || i === state.cursor - 1) {
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
    saveRecord(null, null);
    const s = summarize(r.marks);
    const ms = mySide();
    toast(ms == null ? `解析が終わりました（悪手 ☗${s[0].bad} ☖${s[1].bad}）` : `解析が終わりました（あなたの悪手 ${s[ms].bad}・疑問手 ${s[ms].dubious}）`);
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
  $('selReviewSide').value = mySide() == null ? 'both' : String(mySide());
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
    const mk0 = r.marks[n];
    const mk = mk0 && isMine(mk0.side) ? mk0 : (mk0 ? { ...mk0, kind: '', note: '' } : mk0);
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
    if (!isMine(side)) continue;
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
  // 解析済みの区間ごとに線を引く（途中を飛ばして解析することがあるため）
  let lines = '', areas = '';
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      lines += `<polyline points="${seg.map(([a, b]) => `${a},${b}`).join(' ')}" fill="none" stroke="#f3ead9" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      areas += `<path d="M${seg[0][0]},${H / 2} ${seg.map(([a, b]) => `L${a},${b}`).join(' ')} L${seg[seg.length - 1][0]},${H / 2} Z" fill="rgba(243,234,217,0.12)"/>`;
    } else if (seg.length === 1) {
      lines += `<circle cx="${seg[0][0]}" cy="${seg[0][1]}" r="2" fill="#f3ead9"/>`;
    }
    seg = [];
  };
  for (let i = 0; i <= n; i++) {
    const res = r.results[i];
    if (!res) { flush(); continue; }
    seg.push([x(i), y(res.score)]);
  }
  flush();
  let marks = '';
  r.marks.forEach((m, i) => {
    if (!m || !m.kind || !r.results[i] || !isMine(m.side)) return;
    marks += `<circle cx="${x(i)}" cy="${y(r.results[i].score)}" r="${m.kind === '悪手' ? 7 : 5}" fill="${m.kind === '悪手' ? '#e0675a' : '#e8c35a'}" />`;
  });
  const cx = onMainline() ? x(state.cursor) : x(state.branch.base);
  svg.innerHTML = `
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#5a4a36" stroke-width="1"/>
    ${areas}
    ${lines}
    ${marks}
    <line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#e07b39" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function jumpMistake(dir) {
  const r = state.review;
  if (state.branch) backToMainline();
  const n = state.game.moves.length;
  for (let i = state.cursor + dir; i >= 1 && i <= n; i += dir) {
    const m = r.marks[i];
    if (m && m.kind && isMine(m.side)) { goTo(i); return; }
  }
  const who = mySide() == null ? '' : (mySide() === 0 ? '先手の' : '後手の');
  toast(dir > 0 ? `この先に${who}悪手・疑問手はありません` : `この前に${who}悪手・疑問手はありません`);
}

// ---- 対局の記録 ----
async function saveRecord(source, aiLevel, extra = {}) {
  if (!state.game.moves.length) return null;
  try {
    const r = state.review;
    const hasReview = r.key === gameKey() && r.results.length && r.results.every(Boolean) && r.results.length === state.game.moves.length + 1;
    const rec = buildRecord(state.game, hasReview ? r : null, { source: source || undefined, aiLevel, ...extra });
    const old = await getGame(rec.key);
    if (old) {
      rec.source = source || old.source;
      rec.aiLevel = aiLevel || old.aiLevel;
      rec.date = old.date || rec.date;
      rec.savedAt = old.savedAt;
      if (!rec.stats && old.stats) rec.stats = old.stats;
      if (!rec.timeControl && old.timeControl) rec.timeControl = old.timeControl;
      if (!extra.undo && old.undo) rec.undo = old.undo;
      if (!hasReview && old.results) rec.results = old.results;
    }
    // 問題づくり（次の一手と詰み筋は、どちらの側の手番からも作る）
    if (hasReview) {
      const have = new Set((await getAllProblems()).map((x) => x.id));
      for (const pb of buildProblems(state.game, r, rec.mySide)) if (!have.has(pb.id)) await putProblem(pb);
    }
    if (!old && !source && rec.mySide == null) return; // 取り込んだ棋譜で自分の側が不明なものは戦績に記録しない
    if (hasReview) rec.results = r.results.map((x) => ({ score: x.score, best: x.best, pv: (x.pv || []).slice(0, 12) }));
    rec.problemsV = 2;
    await putGame(rec);
    return rec.key;
  } catch (e) { console.error('記録の保存に失敗', e); }
  return null;
}

// 終局画面に、レーティングの変化と段級位を出す
async function showRatingChange(key, undo) {
  const el = $('endRating');
  el.textContent = '';
  if (undo) { el.textContent = '待ったをした対局なので、レーティングには入れていません'; return; }
  try {
    const { overall, byTime, perGame } = computeRatings(await getAllGames());
    const g = perGame.get(key);
    if (!g) return;
    const d = Math.round(g.after - g.before);
    const lines = [];
    const prov = overall.n < PROVISIONAL_GAMES ? '（仮）' : '';
    lines.push(`レーティング ${Math.round(g.after)}${prov}（${d >= 0 ? '+' : ''}${d}）　${rankOf(g.after)}`);
    const rb = rankOf(g.before), ra = rankOf(g.after);
    // 仮のうちは段級位が大きく動くので、昇段・昇級の知らせは確定してから
    if (rb !== ra && overall.n >= PROVISIONAL_GAMES) lines.push(g.after > g.before ? `${ra}に昇段・昇級しました！` : `${ra}になりました`);
    if (g.timeKey && g.tAfter != null) {
      const t = byTime[g.timeKey];
      const td = Math.round(g.tAfter - g.tBefore);
      lines.push(`${TIME_CLASSES[g.timeKey]}: ${Math.round(g.tAfter)}（${td >= 0 ? '+' : ''}${td}）　${rankOf(g.tAfter)}` + (t.n < PROVISIONAL_GAMES ? '（仮）' : ''));
    }
    el.textContent = lines.join('\n');
  } catch { /* 表示できなくても対局は終わっている */ }
}

// ---- プロフィール ----
const OUT_JA = { win: '勝ち', lose: '負け', draw: '引き分け', none: '中断' };
async function openProfile() {
  const sheet = $('profileSheet');
  sheet.classList.remove('hidden');
  const body = $('profileBody');
  body.textContent = '集計しています…';
  let games = [], probs = [];
  try { [games, probs] = await Promise.all([getAllGames(), getAllProblems()]); } catch { body.textContent = '記録を読み込めませんでした'; return; }
  const a = aggregate(games);
  const todo = probs.filter((x) => x.box < 5).length;
  $('btnProfilePractice').textContent = `問題を解く（残り${todo}問）`;
  const el = (tag, cls, text) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };
  body.innerHTML = '';
  if (!a.total.games) {
    body.appendChild(el('div', 'pf-empty', 'まだ記録がありません。AIと対局するか、自分の対局の棋譜を読み込んで局後解析すると、ここに集計されます。'));
    return;
  }
  const sec = (title) => { const s = el('section', 'pf-sec'); s.appendChild(el('h3', null, title)); body.appendChild(s); return s; };
  // レーティングと段級位
  const rt = computeRatings(games);
  const s0 = sec('レーティング・段級位');
  if (!rt.overall.n) {
    s0.appendChild(el('div', 'pf-sub', 'AIと対局すると計算されます（人1人対AI、待ったなし、勝敗がついた対局）'));
  } else {
    const R = rt.overall.r;
    const row = el('div', 'pf-rating');
    row.appendChild(el('span', 'r', String(Math.round(R))));
    row.appendChild(el('span', 'rank', rankOf(R)));
    if (rt.overall.n < PROVISIONAL_GAMES) row.appendChild(el('span', 'pf-sub', `仮（あと${PROVISIONAL_GAMES - rt.overall.n}局で確定）`));
    s0.appendChild(row);
    const nx = nextRank(R);
    if (nx) s0.appendChild(el('div', 'pf-sub', `${nx.name}まであと${nx.need}点・対局数 ${rt.overall.n}局`));
    if (rt.overall.hist.length >= 2) {
      const h = [1000, ...rt.overall.hist];
      const lo = Math.min(...h) - 50, hi = Math.max(...h) + 50;
      const W = 300, H = 60;
      const pts = h.map((v, i) => `${(i / (h.length - 1)) * W},${H - ((v - lo) / (hi - lo)) * H}`).join(' ');
      const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
      sv.setAttribute('preserveAspectRatio', 'none');
      sv.classList.add('pf-spark');
      sv.innerHTML = `<polyline points="${pts}" fill="none" stroke="#ffc98f" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      s0.appendChild(sv);
    }
    const keys = Object.keys(TIME_CLASSES).filter((k) => rt.byTime[k]);
    if (keys.length) {
      const tb = el('table', 'pf-table');
      tb.innerHTML = '<tr><th>持ち時間</th><th>R</th><th>段級位</th><th>局</th></tr>';
      for (const k of keys) {
        const t = rt.byTime[k];
        const tr = document.createElement('tr');
        for (const v of [TIME_CLASSES[k], Math.round(t.r) + (t.n < PROVISIONAL_GAMES ? '（仮）' : ''), rankOf(t.r), t.n]) tr.appendChild(el('td', null, String(v)));
        tb.appendChild(tr);
      }
      s0.appendChild(tb);
    }
  }
  s0.appendChild(el('div', 'pf-sub', `このアプリ独自の目安で、公式の段級位とは関係ありません。AIの強さの目安: ${AI_RATING.slice(1).map((r, i) => `Lv${i + 1}=${r}`).join('・')}`));
  // 戦績
  const t = a.total;
  const s1 = sec('戦績');
  const wl = t.win + t.lose;
  s1.appendChild(el('div', 'pf-big', `${t.win}勝 ${t.lose}敗` + (t.draw ? ` ${t.draw}分` : '') + (wl ? `　勝率 ${pct(t.win / wl)}` : '')));
  s1.appendChild(el('div', 'pf-sub', `記録した対局 ${t.games}局`));
  // 指し手の質
  const s2 = sec('指し手の質');
  if (a.q) {
    const grid = el('div', 'pf-grid');
    const cell = (k, v) => { const c = el('div', 'pf-cell'); c.appendChild(el('div', 'pf-v', v)); c.appendChild(el('div', 'pf-k', k)); grid.appendChild(c); };
    cell('悪手率', pct(a.q.badRate));
    cell('疑問手率', pct(a.q.dubRate));
    cell('最善手一致率', pct(a.q.matchRate));
    cell('詰みの見逃し', `${a.q.missedMate}回`);
    cell('頓死', `${a.q.blunderMate}回`);
    cell('解析した対局', `${a.q.games}局`);
    s2.appendChild(grid);
  } else {
    s2.appendChild(el('div', 'pf-sub', '局後解析した対局がまだありません'));
  }
  // 得意・苦手
  const s3 = sec('得意と苦手');
  if (a.fav) s3.appendChild(el('div', 'pf-good', `得意戦法: ${STRATEGY_NAMES[a.fav.key]}（${a.fav.win}勝${a.fav.lose}敗、勝率 ${pct(a.fav.rate)}）`));
  if (a.weak.length) a.weak.forEach((w) => s3.appendChild(el('div', 'pf-weak', w.text)));
  else s3.appendChild(el('div', 'pf-sub', '目立った苦手はまだ見つかっていません（対局が増えると見えてきます）'));
  // 戦法別
  const table = (title, rows, nameFn) => {
    if (!rows.length) return;
    const s = sec(title);
    const tb = el('table', 'pf-table');
    tb.innerHTML = '<tr><th></th><th>局</th><th>勝</th><th>敗</th><th>勝率</th></tr>';
    for (const o of rows) {
      const tr = document.createElement('tr');
      for (const v of [nameFn(o.key), o.games, o.win, o.lose, o.win + o.lose ? pct(o.rate) : '-']) tr.appendChild(el('td', null, String(v)));
      tb.appendChild(tr);
    }
    s.appendChild(tb);
  };
  table('自分の戦法別', a.byMy, (k) => STRATEGY_NAMES[k] || k);
  table('相手の戦法別', a.byOpp, (k) => STRATEGY_NAMES[k] || k);
  table('AIのレベル別', a.byLevel, (k) => k);
  // 戦歴
  const s6 = sec('戦歴（新しい順）');
  const list = games.filter((g) => g.mySide != null).sort((x, y) => y.savedAt - x.savedAt).slice(0, 50);
  for (const g of list) {
    const row = el('div', 'pf-game');
    const left = el('div', 'pf-gl');
    left.appendChild(el('div', 'pf-gt', `${(g.date || '').slice(0, 16)}　${g.mySide === 0 ? '☗' : '☖'} 対 ${g.opponent || '相手'}`));
    const info = [`${g.moves.length}手`, STRATEGY_NAMES[g.myStrategy] || '', `相手 ${STRATEGY_NAMES[g.oppStrategy] || ''}`];
    if (g.stats) info.push(`悪手${g.stats.bad}・疑問手${g.stats.dubious}`);
    else info.push('未解析');
    left.appendChild(el('div', 'pf-gs', info.join('・')));
    row.appendChild(left);
    row.appendChild(el('div', 'pf-res ' + (g.outcome || ''), OUT_JA[g.outcome] || '-'));
    row.onclick = () => openRecord(g);
    s6.appendChild(row);
  }
}

function openRecord(g) {
  $('profileSheet').classList.add('hidden');
  const moves = g.moves.map((u) => ({ move: usiToMove(u), comment: '' }));
  loadGame({ startSfen: g.startSfen, moves, header: g.header, result: g.result, summary: g.summary }, { silent: true });
  state.game.meta = { mySide: g.mySide };
  if (g.results && g.results.length === moves.length + 1) {
    const r = state.review;
    r.key = gameKey();
    r.results = g.results;
    r.marks = judgeMoves(state.game.startSfen, state.game.moves, r.results);
    saveReview();
  }
  state.flipped = g.mySide === GOTE;
  update();
  toast(g.results ? '解析結果つきで開きました' : '開きました。メニューから局後解析できます');
}

async function exportData() {
  try {
    const data = { app: 'shogi-app', version: 1, exportedAt: new Date().toISOString(), games: await getAllGames(), problems: await getAllProblems() };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shogi-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch { toast('書き出せませんでした'); }
}

async function importData(text) {
  try {
    const d = JSON.parse(text);
    if (d.app !== 'shogi-app') throw new Error('形式が違います');
    for (const g of d.games || []) await putGame(g);
    for (const p of d.problems || []) await putProblem(p);
    toast(`読み込みました（対局${(d.games || []).length}局、問題${(d.problems || []).length}問）`);
    openProfile();
  } catch (e) { toast('読み込めませんでした: ' + e.message); }
}

// ---- 復習（悪手を指した局面のやり直し） ----
const MASTERED = 5;
const PTYPE = { mistake: '悪手のやり直し', next: '次の一手', mate: '詰み筋', tsume: '詰将棋' };
const isMateType = (x) => ptype(x) === 'mate' || ptype(x) === 'tsume';

// 詰将棋集（やねうら王「詰将棋500万問」から抜き出したもの）
let tsumeCache = null;
async function loadTsume() {
  if (tsumeCache) return tsumeCache;
  const res = await fetch('tsume/tsume.txt');
  if (!res.ok) throw new Error('詰将棋集を読み込めませんでした');
  const out = { 3: [], 5: [], 7: [], 9: [], 11: [] };
  for (const line of (await res.text()).split('\n')) {
    const [n, sfen] = line.split('\t');
    if (sfen && out[n]) out[n].push(sfen);
  }
  tsumeCache = out;
  return out;
}

async function startTsume(n) {
  if (!state.engineReady) { toast('エンジンの準備ができてから始めてください'); return; }
  let book;
  try { book = await loadTsume(); } catch (e) { toast(e.message); return; }
  let done = [];
  try { done = (await getAllProblems()).filter((x) => x.type === 'tsume' && x.mateIn === n); } catch { /* 無視 */ }
  const byId = new Map(done.map((x) => [x.id, x]));
  // 間違えた問題を最大3問、残りはまだ解いていない問題からランダムに
  const retry = done.filter((x) => x.box === 0 && x.tries > 0).sort(() => Math.random() - 0.5).slice(0, 3);
  const fresh = book[n].filter((sf) => !byId.has('tsume:' + sf)).sort(() => Math.random() - 0.5).slice(0, 10 - retry.length);
  const queue = [...retry, ...fresh.map((sf) => ({
    id: 'tsume:' + sf, type: 'tsume', sfen: sf + ' 1', mateIn: n, prevTo: null, box: 0, tries: 0, correct: 0, lastAt: 0,
  }))];
  if (!queue.length) { toast('この手数の問題は全部解きました'); return; }
  beginPractice(queue, 'tsume');
}
const ptype = (x) => x.type || 'mistake';

// 前に記録した対局の解析結果から、詰み筋の問題を作り直す（この機能より前の記録のため）
async function backfillProblems() {
  try {
    const games = await getAllGames();
    const have = new Set((await getAllProblems()).map((x) => x.id));
    for (const g of games) {
      if (g.problemsV >= 2 || !g.results || g.results.length !== g.moves.length + 1) continue;
      const game = { startSfen: g.startSfen, moves: g.moves.map((u) => ({ move: usiToMove(u) })), header: g.header || {} };
      for (const pb of buildProblems(game, { results: g.results }, null)) if (pb.type === 'mate' && !have.has(pb.id)) await putProblem(pb);
      g.problemsV = 2;
      await putGame(g);
    }
  } catch (e) { console.error(e); }
}

// 問題の種類を選ぶ画面
async function openPracticeMenu() {
  await backfillProblems();
  let probs = [];
  try { probs = await getAllProblems(); } catch { /* 無視 */ }
  probs = probs.filter((x) => ptype(x) !== 'tsume');
  const cnt = (t) => probs.filter((x) => (t === 'all' || ptype(x) === t) && x.box < MASTERED).length;
  // 詰将棋集の進み具合
  let solved = {};
  try { for (const x of (await getAllProblems()).filter((y) => y.type === 'tsume' && y.correct > 0)) solved[x.mateIn] = (solved[x.mateIn] || 0) + 1; } catch { /* 無視 */ }
  for (const n of [3, 5, 7, 9, 11]) $(`btnTs${n}`).textContent = `${n}手詰め（正解 ${solved[n] || 0}/1500）`;
  $('btnPmMistake').textContent = `自分の悪手のやり直し（${cnt('mistake')}問）`;
  $('btnPmNext').textContent = `次の一手（${cnt('next')}問）`;
  $('btnPmMate').textContent = `詰み筋（${cnt('mate')}問）`;
  $('btnPmAll').textContent = `全部まぜて（${cnt('all')}問）`;
  $('practiceMenu').classList.remove('hidden');
}

async function startPractice(type = 'all') {
  if (!state.engineReady) { toast('エンジンの準備ができてから始めてください'); return; }
  if (state.mode === 'play') return;
  let probs = [];
  try { probs = await getAllProblems(); } catch { /* 無視 */ }
  probs = probs.filter((x) => ptype(x) !== 'tsume');
  if (type !== 'all') probs = probs.filter((x) => ptype(x) === type);
  let pool = probs.filter((x) => x.box < MASTERED);
  if (!pool.length) pool = probs;
  if (!pool.length) { toast('この種類の問題はまだありません。対局のあとに局後解析すると、棋譜から問題が作られます', 4000); return; }
  // 間違えた回数が多い（箱が小さい）ものほど先に。同じ箱の中はばらばらに
  pool.sort((a, b) => (a.box - b.box) || (Math.random() - 0.5));
  beginPractice(pool.slice(0, 10), type);
}

function beginPractice(queue, type) {
  stopReview();
  engine.stop();
  if (state.mode !== 'practice') state.saved = { game: state.game, branch: state.branch, cursor: state.cursor, flipped: state.flipped, review: { ...state.review } };
  state.mode = 'practice';
  state.practice = { queue, idx: -1, phase: 'ask', item: null, judge: null, right: 0, type };
  $('practiceBar').classList.remove('hidden');
  nextPractice();
}

// 同じ問題をもう一度（出題の頻度は、最初の解答で決めたまま変えない）
function retryPractice() {
  const pr = state.practice;
  if (!pr || pr.phase !== 'done') return;
  pr.idx--;
  pr.retry = true;
  nextPractice();
}

function nextPractice() {
  const pr = state.practice;
  if (!pr) return;
  const retry = !!pr.retry;
  pr.retry = false;
  pr.retrying = retry;
  pr.idx++;
  if (pr.idx >= pr.queue.length) {
    toast(`おわり（${pr.queue.length}問中 ${pr.right}問正解）`, 3500);
    endPractice();
    return;
  }
  const it = pr.queue[pr.idx];
  pr.item = it;
  pr.phase = 'ask';
  pr.lines = null;
  state.game = { startSfen: it.sfen, moves: [], header: {}, result: '', summary: '', meta: { mySide: null } };
  state.branch = null;
  state.cursor = 0;
  state.selected = null;
  const pos = new Position(it.sfen);
  state.flipped = pos.turn === GOTE;
  const no = `${PTYPE[ptype(it)]} ${pr.idx + 1}/${pr.queue.length}`;
  const turnJa = pos.turn === SENTE ? '☗先手' : '☖後手';
  pr.mateLeft = it.mateIn || 0;
  if (isMateType(it)) {
    pr.judge = null;
    if (ptype(it) === 'tsume') {
      // 正解手順を表示するために、裏で解いておく
      if (!it.solution) {
        pr.judge = engine.searchOnce({ sfen: it.sfen, multipv: 1, go: 'go movetime 1500' });
        pr.judge.then((r) => { if (r && r.lines[0]) it.solution = r.lines[0].pv.slice(0, it.mateIn); });
      }
      $('practiceInfo').textContent = `${no}　${it.mateIn}手詰め（${turnJa}の番）。王手の連続で詰ませてください`;
    } else {
      $('practiceInfo').textContent = `${no}　${turnJa}の番。${it.mateIn}手で詰ませてください`;
    }
  } else {
    // 判定用の解析を先に始めておく
    pr.judge = engine.searchOnce({ sfen: it.sfen, multipv: 5, go: 'go movetime 2000' });
    if (ptype(it) === 'next') {
      $('practiceInfo').textContent = `${no}　${turnJa}の番。この局面の一手を探してください（2番目の手より大きく良い手があります）`;
    } else {
      const playedJa = moveToJa(pos, usiToMove(it.played), it.prevTo);
      $('practiceInfo').textContent = `${no}　実戦では ${playedJa}（${it.note || it.kind}）。もっと良い手を指してください`;
    }
  }
  $('btnPracticeShow').classList.remove('hidden');
  $('btnPracticeNext').classList.add('hidden');
  $('btnPracticeRetry').classList.add('hidden');
  renderCandidates([], `${pos.turn === SENTE ? '☗先手' : '☖後手'}の番です。盤上で指してください` + (retry ? '（やり直し）' : ''));
  update();
}

async function answerPractice(mv) {
  const pr = state.practice;
  if (!pr || pr.phase !== 'ask') return;
  if (isMateType(pr.item)) { answerMate(mv); return; }
  sound();
  pr.phase = 'judging';
  const it = pr.item;
  const pos = new Position(it.sfen);
  state.game.moves = [{ move: mv, comment: '' }];
  state.cursor = 1;
  state.selected = null;
  update();
  renderCandidates([], '判定しています…');
  const u = moveToUsi(mv);
  const res = await pr.judge;
  if (state.practice !== pr) return;
  let lines = res ? res.lines.filter((l) => l && l.pv && l.pv[0]) : [];
  const bestV = lines.length ? Math.max(...lines.map(lineValue)) : 0;
  let myV = null;
  const hit = lines.find((l) => l.pv[0] === u);
  if (hit) myV = lineValue(hit);
  else if (u === it.best) myV = bestV;
  else {
    const p2 = pos.clone();
    p2.applyMove(mv);
    if (!p2.legalMoves().length) myV = 99999; // 詰ませた
    else {
      const r2 = await engine.searchOnce({ sfen: p2.toSfen(), multipv: 1, go: 'go movetime 1000' });
      if (state.practice !== pr) return;
      if (r2 && r2.lines[0]) myV = -lineValue(r2.lines[0]);
    }
  }
  const loss = myV == null ? 9999 : Math.max(0, bestV - myV);
  // 実戦と同じ手は「もっと良い手」ではないので不正解にする
  const ok = u !== it.played && (u === it.best || loss <= 80);
  pr.lines = lines;
  pr.phase = 'done';
  if (ok && !pr.retrying) pr.right++;
  // 出題の頻度を更新（やり直しのときは変えない）
  if (!pr.retrying) {
    const upd = { ...it, tries: it.tries + 1, correct: it.correct + (ok ? 1 : 0), box: ok ? Math.min(MASTERED, it.box + 1) : 0, lastAt: Date.now() };
    try { await putProblem(upd); pr.queue[pr.idx] = upd; } catch { /* 無視 */ }
  }
  const myJa = moveToJa(pos, mv, it.prevTo);
  // 最善手は、いま深く読んだ結果を優先して示す
  const bestU = lines[0] ? lines[0].pv[0] : it.best;
  const bestJa = moveToJa(pos, usiToMove(bestU), it.prevTo);
  const head = ok
    ? (u === bestU ? `正解！ ${myJa}は最善手です` : `正解！ ${myJa}も好手です（最善は${bestJa}）`)
    : `${u === it.played ? '実戦と同じ手です' : '惜しい'}。${myJa}は最善より${loss >= 9999 ? '大きく' : loss}損。最善は${bestJa}`;
  $('practiceInfo').textContent = `復習 ${pr.idx + 1}/${pr.queue.length}　${head}`;
  $('btnPracticeShow').classList.add('hidden');
  $('btnPracticeNext').classList.remove('hidden');
  $('btnPracticeRetry').classList.remove('hidden');
  revealCandidates(pos, lines);
}

function revealCandidates(pos, lines) {
  // 出題局面での候補手を見せる（盤は指した後の局面なので、表示だけ問題の局面で作る）
  const el = $('candidates');
  el.innerHTML = '';
  lines.forEach((ln, i) => {
    const s = senteScore(ln, pos.turn);
    const row = document.createElement('div');
    row.className = 'cand' + (i === 0 ? ' first' : '');
    row.innerHTML = '<span class="no"></span><span class="mv"></span><span class="sc"></span><span class="pv"></span>';
    const ja = pvToJa(pos, ln.pv, state.practice ? state.practice.item.prevTo : null);
    row.querySelector('.no').textContent = i + 1;
    row.querySelector('.mv').textContent = ja[0] || '';
    row.querySelector('.sc').textContent = fmtScore(s);
    row.querySelector('.pv').textContent = ja.slice(1).join(' ');
    el.appendChild(row);
  });
  if (lines[0]) setEval(senteScore(lines[0], pos.turn), lines[0].depth);
}

// 詰み筋: 攻める側の手を1手ずつ判定し、受ける側はエンジンが最善で応じる
async function answerMate(mv) {
  const pr = state.practice;
  const it = pr.item;
  sound();
  pr.phase = 'judging';
  state.game.moves.push({ move: mv, comment: '' });
  state.cursor = state.game.moves.length;
  state.selected = null;
  update();
  const ps = positions();
  const after = ps[ps.length - 1];
  const no = `${PTYPE[ptype(it)]} ${pr.idx + 1}/${pr.queue.length}`;
  if (!after.legalMoves().length && after.inCheck()) { finishMate(true, '詰みました！'); return; }
  if (ptype(it) === 'tsume' && !after.inCheck()) {
    if (pr.judge) await pr.judge;
    finishMate(false, '詰将棋では、攻める側は毎回王手をかけます');
    return;
  }
  if (pr.judge) { await pr.judge; pr.judge = null; } // 裏の計算が終わるのを待ってからエンジンを使う
  renderCandidates([], '判定しています…');
  const res = await engine.searchOnce({ sfen: after.toSfen(), multipv: 1, go: 'go movetime 1000' });
  if (state.practice !== pr) return;
  const l = res && res.lines[0];
  const used = state.game.moves.length; // ここまでの手数（攻め方の手を含む）
  // 受ける側から見て負けの詰みがあり、残りの手数に収まっていれば正しい手
  const ok = l && l.mate != null && l.mate < 0 && used + Math.abs(l.mate) <= it.mateIn;
  if (!ok) {
    finishMate(false, l && l.mate != null && l.mate < 0 ? 'まだ詰みますが、手数が長くなりました' : '詰みがなくなりました');
    return;
  }
  // 受け方の応手
  await new Promise((r) => setTimeout(r, 400));
  if (state.practice !== pr) return;
  const reply = usiToMove(res.bestmove);
  if (!after.isLegal(reply)) { finishMate(false, '判定できませんでした'); return; }
  sound();
  state.game.moves.push({ move: reply, comment: '' });
  state.cursor = state.game.moves.length;
  pr.phase = 'ask';
  update();
  const left = it.mateIn - state.game.moves.length;
  $('practiceInfo').textContent = `${no}　正しい手です。続けて詰ませてください（残り${left}手）`;
  renderCandidates([], '続けて指してください');
}

async function finishMate(ok, msg) {
  const pr = state.practice;
  const it = pr.item;
  pr.phase = 'done';
  if (ok && !pr.retrying) pr.right++;
  if (!pr.retrying) {
    const upd = { ...it, tries: it.tries + 1, correct: it.correct + (ok ? 1 : 0), box: ok ? Math.min(MASTERED, it.box + 1) : 0, lastAt: Date.now() };
    try { await putProblem(upd); pr.queue[pr.idx] = upd; } catch { /* 無視 */ }
  }
  const sol = pvToJa(new Position(it.sfen), it.solution || [], it.prevTo, 20).join(' ');
  $('practiceInfo').textContent = `${PTYPE[ptype(it)]} ${pr.idx + 1}/${pr.queue.length}　${ok ? '正解！ ' : ''}${msg}` + (ok || !sol ? '' : `。正解手順: ${sol}`);
  $('btnPracticeShow').classList.add('hidden');
  $('btnPracticeNext').classList.remove('hidden');
  $('btnPracticeRetry').classList.remove('hidden');
  renderCandidates([], ok ? `正解手順の一例: ${sol}` : '「もう一度」で同じ問題をやり直せます');
}

async function revealPractice() {
  const pr = state.practice;
  if (!pr || pr.phase !== 'ask') return;
  if (isMateType(pr.item)) {
    pr.phase = 'judging';
    if (pr.judge) await pr.judge; // 正解手順の計算を待つ
    finishMate(false, '答えを表示しました');
    return;
  }
  pr.phase = 'judging';
  renderCandidates([], '解析しています…');
  const res = await pr.judge;
  if (state.practice !== pr) return;
  const it = pr.item;
  const pos = new Position(it.sfen);
  const lines = res ? res.lines.filter((l) => l && l.pv && l.pv[0]) : [];
  pr.phase = 'done';
  if (!pr.retrying) {
    const upd = { ...it, tries: it.tries + 1, box: 0, lastAt: Date.now() };
    try { await putProblem(upd); pr.queue[pr.idx] = upd; } catch { /* 無視 */ }
  }
  const bestU = lines[0] ? lines[0].pv[0] : it.best;
  $('practiceInfo').textContent = `復習 ${pr.idx + 1}/${pr.queue.length}　答え: ${moveToJa(pos, usiToMove(bestU), it.prevTo)}`;
  $('btnPracticeShow').classList.add('hidden');
  $('btnPracticeNext').classList.remove('hidden');
  $('btnPracticeRetry').classList.remove('hidden');
  revealCandidates(pos, lines);
}

function endPractice() {
  if (state.mode !== 'practice') return;
  setTimeout(askPendingUpdate, 500);
  state.practice = null;
  state.mode = 'study';
  engine.stop();
  $('practiceBar').classList.add('hidden');
  const sv = state.saved;
  if (sv) {
    state.game = sv.game; state.branch = sv.branch; state.cursor = sv.cursor; state.flipped = sv.flipped;
    loadReviewFor();
  }
  state.saved = null;
  update();
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
      meta: state.game.meta || {},
      branch: state.branch && { base: state.branch.base, moves: state.branch.moves.map((m) => moveToUsi(m.move)) },
      cursor: state.cursor,
      flipped: state.flipped,
      multipv: state.multipv,
      reviewDepth: state.reviewDepth,
      sound: state.sound,
      clockSound: state.clockSound,
      speech: state.speech,
      speechStyle: state.speechStyle,
    }));
  } catch { /* 保存できなくても動作は続ける */ }
}

// 設定だけを読み戻す。盤は毎回、平手の初形から始める
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      state.multipv = s.multipv || 3;
      state.reviewDepth = s.reviewDepth || 'normal';
      state.sound = s.sound !== false;
      state.clockSound = s.clockSound !== false;
      state.speech = !!s.speech;
      state.speechStyle = s.speechStyle === 'kanji' ? 'kanji' : 'kana';
    }
  } catch { /* 無視 */ }
  state.game = { startSfen: STARTPOS, moves: [], header: {}, result: '', summary: '', meta: { mySide: null } };
  state.branch = null;
  state.cursor = 0;
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
    if (state.mode === 'practice') { toast('復習中です。終えるときは終了を押してください'); return; }
    menu.classList.remove('hidden');
  };
  menu.addEventListener('click', async (e) => {
    if (e.target === menu) { menu.classList.add('hidden'); return; }
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.classList.add('hidden');
    if (act === 'play') { setupPlaySheet(); $('playSheet').classList.remove('hidden'); }
    if (act === 'review') startReview();
    if (act === 'profile') openProfile();
    if (act === 'practice') openPracticeMenu();
    if (act === 'openFile') $('fileInput').click();
    if (act === 'paste') { $('pasteSheet').classList.remove('hidden'); $('pasteText').focus(); }
    if (act === 'saveKif') saveKif();
    if (act === 'copyKif') {
      try { await navigator.clipboard.writeText(kifText()); toast('KIFをコピーしました'); } catch { toast('コピーできませんでした'); }
    }
    if (act === 'flip') { state.flipped = !state.flipped; update(); }
    if (act === 'terms') { location.href = 'terms.html'; return; }
    if (act === 'newGame') loadGame({ startSfen: STARTPOS, moves: [], header: {}, result: '' }, { silent: true });
  });
  $('selMultiPV').value = String(state.multipv);
  $('selMultiPV').onchange = (e) => { state.multipv = Number(e.target.value); persist(); requestAnalysis(); };
  $('chkSpeech').checked = state.speech;
  $('chkSpeech').disabled = !speechSupported();
  $('chkSpeech').onchange = (e) => { state.speech = e.target.checked; persist(); if (state.speech) speak('読み上げをオンにしました'); };
  $('selSpeechStyle').value = state.speechStyle;
  $('selSpeechStyle').onchange = (e) => {
    state.speechStyle = e.target.value;
    persist();
    // 聞き比べられるように例を読む
    const p = new Position();
    speak(moveReading(p, usiToMove('6i7h'), null, state.speechStyle));
  };
  $('chkClockSound').checked = state.clockSound;
  $('chkClockSound').onchange = (e) => { state.clockSound = e.target.checked; persist(); if (state.clockSound) beep(false); };
  $('chkSound').checked = state.sound;
  $('chkSound').onchange = (e) => { state.sound = e.target.checked; persist(); if (state.sound) sound(); };
  // シートを開いている間は後ろの画面をスクロールさせない
  const lock = () => document.body.classList.toggle('noscroll', !!document.querySelector('.sheet:not(.hidden)'));
  const mo = new MutationObserver(lock);
  document.querySelectorAll('.sheet').forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
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
    confirmSheet('投了しますか？', '投了する', true).then((r) => { if (r.ok && state.play === p) endPlay('投了', 1 - side, { record: r.checked }); });
  };
  $('btnAbort').onclick = () => {
    const p = state.play;
    confirmSheet('対局を中断しますか？', '中断する', false).then((r) => { if (r.ok && state.play === p) endPlay('中断', null, { record: r.checked }); });
  };
  $('btnEndReview').onclick = () => { $('endSheet').classList.add('hidden'); state.cursor = 0; startReview(); };
  $('btnEndClose').onclick = () => $('endSheet').classList.add('hidden');
  $('endSheet').addEventListener('click', (e) => { if (e.target === $('endSheet')) $('endSheet').classList.add('hidden'); });
  for (const id of ['playSheet', 'pasteSheet']) {
    $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).classList.add('hidden'); });
  }

  // プロフィール・復習
  $('btnProfileClose').onclick = () => $('profileSheet').classList.add('hidden');
  $('btnProfilePractice').onclick = () => { $('profileSheet').classList.add('hidden'); openPracticeMenu(); };
  const pm = (t) => () => { $('practiceMenu').classList.add('hidden'); startPractice(t); };
  $('btnPmMistake').onclick = pm('mistake');
  $('btnPmNext').onclick = pm('next');
  $('btnPmMate').onclick = pm('mate');
  $('btnPmAll').onclick = pm('all');
  $('btnPmClose').onclick = () => $('practiceMenu').classList.add('hidden');
  for (const n of [3, 5, 7, 9, 11]) $(`btnTs${n}`).onclick = () => { $('practiceMenu').classList.add('hidden'); startTsume(n); };
  $('btnExport').onclick = exportData;
  $('btnImport').onclick = () => $('importInput').click();
  $('importInput').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importData(await f.text()); };
  $('btnPracticeShow').onclick = () => revealPractice();
  $('btnPracticeNext').onclick = () => nextPractice();
  $('btnPracticeRetry').onclick = () => retryPractice();
  $('btnPracticeEnd').onclick = () => endPractice();

  // 局後解析
  $('btnReviewStop').onclick = stopReview;
  $('selReviewSide').onchange = (e) => {
    const v = e.target.value;
    state.game.meta = { ...(state.game.meta || {}), mySide: v === 'both' ? null : Number(v) };
    update();
  };
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

// 確認用の小さな画面（ブラウザのダイアログは使わない）
// recordDefault を渡すと「戦績に記録する」のチェックを出す。戻り値 { ok, checked }
function confirmSheet(msg, okLabel = 'はい', recordDefault = null) {
  return new Promise((resolve) => {
    const sh = $('confirmSheet');
    $('confirmText').textContent = msg;
    $('btnConfirmOk').textContent = okLabel;
    const row = $('confirmRecordRow');
    row.classList.toggle('hidden', recordDefault == null);
    $('chkConfirmRecord').checked = !!recordDefault;
    sh.classList.remove('hidden');
    const done = (v) => {
      sh.classList.add('hidden');
      $('btnConfirmOk').onclick = $('btnConfirmCancel').onclick = sh.onclick = null;
      resolve({ ok: v, checked: $('chkConfirmRecord').checked });
    };
    $('btnConfirmOk').onclick = (e) => { e.stopPropagation(); done(true); };
    $('btnConfirmCancel').onclick = (e) => { e.stopPropagation(); done(false); };
    sh.onclick = (e) => { if (e.target === sh) done(false); };
  });
}

// ---- 更新の確認 ----
// 新しい版が届いたら、すぐには切り替えず「更新しますか？」と聞く。対局中は終わってから聞く
let pendingWorker = null;
let updateAsked = false;
async function setupUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const check = () => { if (reg.waiting && navigator.serviceWorker.controller) askUpdate(reg.waiting); };
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
  });
  check();
  const poll = () => reg.update().catch(() => { /* つながらないときは次の機会に */ });
  poll();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  setInterval(poll, 60 * 60 * 1000);
  // 今の版を表示する
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'VERSION') $('appVersion').textContent = `版 ${ev.data.version}`;
  });
  if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('GET_VERSION');
}

async function askUpdate(worker) {
  pendingWorker = worker;
  if (updateAsked) return;
  if (state.mode === 'play' || state.mode === 'practice') return; // 対局や問題の途中では聞かない
  updateAsked = true;
  let info = null;
  try { info = await (await fetch('version.json', { cache: 'no-store' })).json(); } catch { /* 変更点なしで聞く */ }
  const list = $('updateNotes');
  list.innerHTML = '';
  for (const n of (info && info.notes) || []) {
    const li = document.createElement('li');
    li.textContent = n;
    list.appendChild(li);
  }
  $('updateTitle').textContent = `新しい版${info && info.version ? `（${info.version}）` : ''}があります。更新しますか？`;
  $('updateSheet').classList.remove('hidden');
  $('btnUpdateNow').onclick = () => {
    $('btnUpdateNow').disabled = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    worker.postMessage('SKIP_WAITING');
  };
  $('btnUpdateLater').onclick = () => {
    $('updateSheet').classList.add('hidden');
    toast('次にアプリを開いたときに、もう一度お知らせします');
  };
}
// 対局や問題が終わったあとに、保留していた更新を聞く
function askPendingUpdate() {
  if (pendingWorker && !updateAsked && pendingWorker.state === 'installed') askUpdate(pendingWorker);
}

// 初めて開いたときに、利用規約の確認を出す
const TERMS_KEY = 'shogi-app:terms';
const TERMS_VERSION = '1';
function checkTerms() {
  let agreed = false;
  try { agreed = localStorage.getItem(TERMS_KEY) === TERMS_VERSION; } catch { /* 無視 */ }
  if (agreed) return;
  $('termsSheet').classList.remove('hidden');
  $('btnTermsAgree').onclick = () => {
    try { localStorage.setItem(TERMS_KEY, TERMS_VERSION); } catch { /* 無視 */ }
    $('termsSheet').classList.add('hidden');
  };
}

// Googleサイトなどに埋め込まれていたら、単独で開くための案内を出す
function checkEmbedded() {
  let embedded = false;
  try { embedded = self !== self.top; } catch { embedded = true; }
  if (!embedded) return;
  const bar = document.createElement('a');
  bar.className = 'embed-bar';
  bar.href = location.href.split('?')[0];
  bar.target = '_blank';
  bar.rel = 'noopener';
  bar.textContent = '埋め込み表示ではAIが動きません。ここを押して新しいタブで開いてください';
  document.body.prepend(bar);
}

async function main() {
  if (new URLSearchParams(location.search).has('debug')) self.__shogiState = state; // 動作確認用
  checkEmbedded();
  unlockAudio();
  restore();
  buildBoard();
  bindUi();
  update();
  checkTerms();
  setupUpdates().catch(() => { /* 更新の確認ができなくても動作は続ける */ });
  await checkShared();
  try {
    await engine.init();
    state.engineReady = true;
    requestAnalysis();
    loadBook().catch(() => { /* 対局を始めるときにもう一度読む */ });
  } catch (e) {
    let msg = e.message === 'crossOriginIsolated'
      ? 'エンジンの準備中です。表示が変わらなければページを再読み込みしてください'
      : 'エンジンを起動できませんでした: ' + e.message;
    // 埋め込み表示（Googleサイトなど）や、対応していないブラウザ
    let reloaded = false;
    try { reloaded = !!sessionStorage.getItem('coiReloaded'); } catch { /* 無視 */ }
    if (self !== self.top) msg = '埋め込み表示ではAIが動きません。上のオレンジの帯を押して、新しいタブで開いてください';
    else if (e.message === 'crossOriginIsolated' && reloaded) msg = 'このブラウザではAIが動きません。Chrome、Edge、Firefox、Safari（16.4以降）などの新しいブラウザで開いてください。盤と棋譜の読み込みは使えます';
    renderCandidates([], msg);
    console.error(e);
  }
}

main();
