// 対局の記録（IndexedDB）と集計
import { Position, SENTE, GOTE, typeOf, colorOf, moveToUsi, usiToMove } from './shogi.js';

const DB_NAME = 'shogi-app';
const DB_VER = 1;
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('problems')) d.createObjectStore('problems', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAllGames = () => tx('games', 'readonly', (st) => reqP(st.getAll()));
export const getGame = (key) => tx('games', 'readonly', (st) => reqP(st.get(key)));
export const putGame = (g) => tx('games', 'readwrite', (st) => reqP(st.put(g)));
export const deleteGame = (key) => tx('games', 'readwrite', (st) => reqP(st.delete(key)));
export const getAllProblems = () => tx('problems', 'readonly', (st) => reqP(st.getAll()));
export const putProblem = (p) => tx('problems', 'readwrite', (st) => reqP(st.put(p)));
export const deleteProblem = (id) => tx('problems', 'readwrite', (st) => reqP(st.delete(id)));

// ---- 戦法の判定（序盤30手で飛車がどこへ行ったか、角交換があったか） ----
export const STRATEGY_NAMES = {
  ibisha: '居飛車（その他）', yagura: '矢倉', gangi: '雁木', kakugawari: '角換わり', aigakari: '相掛かり', yokofu: '横歩取り',
  shiken: '四間飛車', sangen: '三間飛車', naka: '中飛車', mukai: '向かい飛車', unknown: '不明',
};

export function detectStrategy(startSfen, moves, side) {
  const pos = new Position(startSfen);
  // 平手の初期配置からでなければ判定しない
  const rookHome = side === SENTE ? 7 * 9 + 7 : 1 * 9 + 1; // ２八 / ８二
  const rook = side === SENTE ? 'R' : 'r';
  if (pos.board[rookHome] !== rook) return 'unknown';
  // 先手から見た筋・段のマス番号（後手は盤を回して見る）
  const view = (file, rank) => {
    const f = side === SENTE ? file : 10 - file, r = side === SENTE ? rank : 10 - rank;
    return (r - 1) * 9 + (9 - f);
  };
  const mine = (pc, t) => pc && colorOf(pc) === side && typeOf(pc) === t;
  let rookSq = rookHome;
  let bishopTraded = false, yokofu = false;
  let aigakari = false; // 序盤10手のうちに、互いに角道を開けないまま飛車先の歩を５段目まで伸ばした
  let ranged = null;
  let snap = null; // 30手目あたりの局面（囲いの判定用）
  const limit = Math.min(moves.length, 50); // 囲いは50手目あたりの形で見る
  for (let i = 0; i < limit; i++) {
    const m = moves[i].move;
    const pc = m.drop ? null : pos.board[m.from];
    const cap = m.drop ? null : pos.board[m.to];
    if (cap && typeOf(cap).replace('+', '') === 'B' && i < 30) bishopTraded = true;
    if (m.to === rookSq && pc && colorOf(pc) !== side) rookSq = -1; // 飛車を取られた
    if (!m.drop && m.from === rookSq && pc === rook) {
      const row = Math.floor(m.to / 9);
      const homeRow = side === SENTE ? 7 : 1;
      // 振り飛車: 飛車が自陣の段で横に動いた筋
      if (row === homeRow && !ranged) {
        const file = 9 - (m.to % 9);
        const f = side === SENTE ? file : 10 - file;
        const map = { 6: 'shiken', 7: 'sangen', 5: 'naka', 8: 'mukai' };
        if (map[f]) ranged = map[f];
      }
      // 横歩取り: 飛車で３四（後手なら７六）の歩を取る
      if (m.to === view(3, 4) && cap && typeOf(cap) === 'P') yokofu = true;
      rookSq = m.to;
    } else if (!m.drop && m.from === rookSq) {
      rookSq = -1;
    }
    pos.applyMove(m);
    // 飛車先の歩が５段目まで伸びたか（相掛かりの判定用）
    const myP = side === SENTE ? 'P' : 'p', opP = side === SENTE ? 'p' : 'P';
    if (i < 10 && pos.board[view(2, 5)] === myP && pos.board[view(8, 5)] === opP
      && pos.board[view(7, 7)] === myP && pos.board[view(3, 3)] === opP) aigakari = true;
    if (i === Math.min(limit, 30) - 1) snap = pos.clone();
  }
  if (ranged) return ranged;
  if (yokofu) return 'yokofu';
  if (bishopTraded) return 'kakugawari';
  // 囲いは30手目と50手目あたりの形の両方で見る
  const boards = [snap, pos].filter(Boolean).map((x) => x.board);
  // 矢倉: ７七銀と６七金（または７八金と８八玉）
  if (boards.some((b) => mine(b[view(7, 7)], 'S') && (mine(b[view(6, 7)], 'G') || mine(b[view(8, 8)], 'K')))) return 'yagura';
  // 雁木: ６七銀と５七銀（または４七銀）
  if (boards.some((b) => mine(b[view(6, 7)], 'S') && (mine(b[view(5, 7)], 'S') || mine(b[view(4, 7)], 'S')))) return 'gangi';
  if (aigakari) return 'aigakari';
  return 'ibisha';
}

// ---- 1局分の記録を作る ----
// game: { startSfen, moves, header, result, summary, meta }  review: { results, marks } or null
export function buildRecord(game, review, extra = {}) {
  const key = game.startSfen + '|' + game.moves.map((m) => moveToUsi(m.move)).join(' ');
  const me = game.meta && game.meta.mySide != null ? game.meta.mySide : null;
  const winner = resultWinner(game);
  const rec = {
    key,
    date: extra.date || game.header['開始日時'] || new Date().toISOString(),
    savedAt: Date.now(),
    source: extra.source || 'import',
    startSfen: game.startSfen,
    moves: game.moves.map((m) => moveToUsi(m.move)),
    header: game.header,
    result: game.result,
    summary: game.summary,
    mySide: me,
    winner, // 0 / 1 / null(引き分け・中断・不明)
    outcome: me == null ? null : winner == null ? (game.result === '千日手' || game.result === '持将棋' ? 'draw' : 'none') : (winner === me ? 'win' : 'lose'),
    myStrategy: me == null ? null : detectStrategy(game.startSfen, game.moves, me),
    oppStrategy: me == null ? null : detectStrategy(game.startSfen, game.moves, 1 - me),
    opponent: me == null ? '' : (me === SENTE ? game.header['後手'] : game.header['先手']) || '',
    aiLevel: extra.aiLevel || null,
    timeControl: extra.timeControl || null, // { main: 秒, byo: 秒 }（アプリ内の対局だけ）
    undo: extra.undo || 0, // 待ったの回数（待ったをした対局はレーティングに入れない）
    stats: null,
  };
  if (review && review.marks && me != null) {
    const s = { moves: 0, bad: 0, dubious: 0, match: 0, missedMate: 0, blunderMate: 0 };
    review.marks.forEach((m) => {
      if (!m || m.side !== me) return;
      s.moves++;
      if (m.kind === '悪手') s.bad++;
      if (m.kind === '疑問手') s.dubious++;
      if (m.match) s.match++;
      if (m.missedMate) s.missedMate++;
      if (m.blunderMate) s.blunderMate++;
    });
    rec.stats = s;
  }
  return rec;
}

function resultWinner(game) {
  const m = (game.summary || '').match(/(先手|後手|下手|上手)の勝ち/);
  if (m) return m[1] === '先手' || m[1] === '下手' ? SENTE : GOTE;
  // 「投了」などで勝敗の行がない棋譜: 投了したのは最後に指す番だった側
  if (['投了', '詰み', '切れ負け', '時間切れ'].includes(game.result)) {
    return game.moves.length % 2 === 0 ? (startTurn(game) === SENTE ? GOTE : SENTE) : startTurn(game);
  }
  return null;
}
function startTurn(game) { return new Position(game.startSfen).turn; }

// 局後解析の結果から問題を作る
//  mistake: 自分の悪手・疑問手（その局面でもっと良い手を探す）
//  next:    次の一手。最善手が2番目の手よりはっきり良い局面（どちらの側の手番でも。AIの手番も題材にする）
//  mate:    詰み筋。手番側に詰みがある局面（N手で詰ませる）
const NEXT_WR_GAP = 0.2, NEXT_CP_GAP = 400;
const wrOf = (s) => (s.mate != null ? (s.mate > 0 ? 1 : 0) : 1 / (1 + Math.exp(-s.cp / 600)));
// 先手から見た評価を、手番側から見た値に
const forSide = (s, side) => (side === 0 ? s : (s.mate != null ? { mate: -s.mate } : { cp: -s.cp }));

export function buildProblems(game, review, mySide) {
  if (!review || !review.results) return [];
  const out = [];
  const pos = [new Position(game.startSfen)];
  for (const m of game.moves) { const p = pos[pos.length - 1].clone(); p.applyMove(m.move); pos.push(p); }
  const gameKey = game.startSfen + '|' + game.moves.map((x) => moveToUsi(x.move)).join(' ');
  const base = (i, extra) => ({
    sfen: pos[i].toSfen(),
    prevTo: i > 0 ? game.moves[i - 1].move.to : null,
    ply: i,
    gameKey,
    date: game.header['開始日時'] || '',
    box: 0, tries: 0, correct: 0, lastAt: 0,
    ...extra,
  });
  // 自分の悪手
  if (review.marks && mySide != null) {
    review.marks.forEach((m, i) => {
      if (!m || !m.kind || m.side !== mySide || !m.best) return;
      const b = base(i - 1, { type: 'mistake', best: m.best, played: moveToUsi(game.moves[i - 1].move), kind: m.kind, note: m.note || '' });
      b.id = b.sfen + '|' + m.best;
      out.push(b);
    });
  }
  let nextCount = 0;
  const res = review.results;
  for (let i = 0; i < pos.length; i++) {
    const r = res[i];
    if (!r || !r.best) continue;
    const side = pos[i].turn;
    const me = forSide(r.score, side);
    // 詰み筋: 手番側に N手の詰みがある（同じ詰みの続きの局面は、最初の1つだけ）
    if (me.mate != null && me.mate > 0 && me.mate <= 11 && !r.score.terminal) {
      const prevSame = i >= 2 && res[i - 2] && (() => { const pm = forSide(res[i - 2].score, side); return pm.mate != null && pm.mate > 0; })();
      if (!prevSame && r.pv && r.pv.length >= me.mate) {
        const b = base(i, { type: 'mate', best: r.best, mateIn: me.mate, solution: r.pv.slice(0, me.mate) });
        b.id = b.sfen + '|mate';
        out.push(b);
      }
      continue;
    }
    // 次の一手: 2番目の手との差がはっきりしていて、形勢がまだ決まっていない局面
    if (!r.score2 || me.mate != null || nextCount >= 6) continue;
    const s2 = forSide(r.score2, side);
    if (s2.mate != null && s2.mate > 0) continue;
    if (Math.abs(me.cp) > 3000) continue;
    const wrGap = wrOf(me) - wrOf(s2);
    const cpGap = s2.mate != null ? 3000 : me.cp - s2.cp;
    // 形勢が傾いた局面（±1500超）では勝率の差が出にくいので、評価値の差だけで「決め手」を探す
    if (Math.abs(me.cp) > 1500 ? cpGap < 600 : (wrGap < NEXT_WR_GAP && cpGap < NEXT_CP_GAP)) continue;
    // 取られた駒を取り返すだけの手は問題にしない
    const bm = usiToMove(r.best);
    if (i > 0 && !bm.drop && bm.to === game.moves[i - 1].move.to) continue;
    const b = base(i, { type: 'next', best: r.best, pv: (r.pv || []).slice(0, 6), gap: Math.round(cpGap) });
    b.id = b.sfen + '|' + r.best;
    out.push(b);
    nextCount++;
  }
  return out;
}

// ---- 集計 ----
export function aggregate(games) {
  const mine = games.filter((g) => g.mySide != null);
  const decided = mine.filter((g) => g.outcome === 'win' || g.outcome === 'lose' || g.outcome === 'draw');
  const cnt = (arr, f) => arr.filter(f).length;
  const total = {
    games: mine.length,
    win: cnt(decided, (g) => g.outcome === 'win'),
    lose: cnt(decided, (g) => g.outcome === 'lose'),
    draw: cnt(decided, (g) => g.outcome === 'draw'),
  };
  const reviewed = mine.filter((g) => g.stats && g.stats.moves);
  const sum = (arr, k) => arr.reduce((a, g) => a + g.stats[k], 0);
  const q = reviewed.length ? {
    games: reviewed.length,
    moves: sum(reviewed, 'moves'),
    badRate: sum(reviewed, 'bad') / sum(reviewed, 'moves'),
    dubRate: sum(reviewed, 'dubious') / sum(reviewed, 'moves'),
    matchRate: sum(reviewed, 'match') / sum(reviewed, 'moves'),
    missedMate: sum(reviewed, 'missedMate'),
    blunderMate: sum(reviewed, 'blunderMate'),
  } : null;
  const group = (keyFn) => {
    const m = new Map();
    for (const g of decided) {
      const k = keyFn(g);
      if (!k) continue;
      const o = m.get(k) || { key: k, games: 0, win: 0, lose: 0, draw: 0 };
      o.games++; o[g.outcome]++;
      m.set(k, o);
    }
    return [...m.values()].map((o) => ({ ...o, rate: o.win / Math.max(1, o.win + o.lose) })).sort((a, b) => b.games - a.games);
  };
  const byMy = group((g) => g.myStrategy);
  const byOpp = group((g) => g.oppStrategy);
  const byLevel = group((g) => (g.aiLevel ? `Lv${g.aiLevel}` : null));
  // 得意戦法: 3局以上指した中で勝率が最も高いもの
  const fav = byMy.filter((o) => o.games >= 3 && o.win > 0).sort((a, b) => b.rate - a.rate)[0] || byMy.filter((o) => o.win > 0).sort((a, b) => b.win - a.win)[0] || null;

  // 苦手（数字つきの指摘）
  const weak = [];
  const worstOpp = byOpp.filter((o) => o.games >= 3).sort((a, b) => a.rate - b.rate)[0];
  if (worstOpp && worstOpp.rate < 0.5) weak.push({ score: 1 - worstOpp.rate, text: `対${STRATEGY_NAMES[worstOpp.key]}の勝率が${pct(worstOpp.rate)}（${worstOpp.games}局）` });
  const worstMy = byMy.filter((o) => o.games >= 3).sort((a, b) => a.rate - b.rate)[0];
  if (worstMy && worstMy.rate < 0.5 && (!fav || worstMy.key !== fav.key)) weak.push({ score: 0.9 - worstMy.rate, text: `自分の${STRATEGY_NAMES[worstMy.key]}の勝率が${pct(worstMy.rate)}（${worstMy.games}局）` });
  const recent = reviewed.slice().sort((a, b) => b.savedAt - a.savedAt).slice(0, 10);
  const rm = recent.reduce((a, g) => a + g.stats.missedMate, 0);
  if (rm) weak.push({ score: 0.6 + rm * 0.1, text: `直近${recent.length}局で詰みの見逃しが${rm}回` });
  const rb = recent.reduce((a, g) => a + g.stats.blunderMate, 0);
  if (rb) weak.push({ score: 0.6 + rb * 0.1, text: `直近${recent.length}局で詰まされる手（頓死）が${rb}回` });
  // 悪手率の推移
  if (reviewed.length >= 6) {
    const sorted = reviewed.slice().sort((a, b) => a.savedAt - b.savedAt);
    const half = Math.floor(sorted.length / 2);
    const rate = (arr) => arr.reduce((a, g) => a + g.stats.bad, 0) / Math.max(1, arr.reduce((a, g) => a + g.stats.moves, 0));
    const r1 = rate(sorted.slice(0, half)), r2 = rate(sorted.slice(half));
    if (r2 > r1 * 1.2) weak.push({ score: 0.5, text: `最近の悪手率が${pct(r2)}で、前半の${pct(r1)}より増えている` });
  }
  weak.sort((a, b) => b.score - a.score);
  return { total, q, byMy, byOpp, byLevel, fav, weak: weak.slice(0, 3) };
}

export const pct = (x) => `${Math.round(x * 100)}%`;
