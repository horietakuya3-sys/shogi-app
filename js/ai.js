// 対局AI: レベルに応じた手の選び方と、戦法ごとの駒組み
import { Position, SENTE, typeOf, colorOf, moveToUsi, usiToMove, sameMove } from './shogi.js';
import { bookMoves, bookReady } from './book.js';

// レベルごとの設定
// nodes: 探索量 / mpv: 比べる候補の数 / tol: 許す評価値の損（これ以内の手からランダムに選ぶ）
export const LEVELS = [
  null,
  { name: 'Lv1 入門', nodes: 1500, mpv: 10, tol: 900 },
  { name: 'Lv2', nodes: 3000, mpv: 10, tol: 650 },
  { name: 'Lv3', nodes: 6000, mpv: 8, tol: 480 },
  { name: 'Lv4', nodes: 12000, mpv: 8, tol: 350 },
  { name: 'Lv5', nodes: 25000, mpv: 7, tol: 250 },
  { name: 'Lv6', nodes: 50000, mpv: 6, tol: 170 },
  { name: 'Lv7', nodes: 100000, mpv: 5, tol: 110 },
  { name: 'Lv8', nodes: 300000, mpv: 4, tol: 60 },
  { name: 'Lv9', nodes: 1000000, mpv: 3, tol: 25 },
  { name: 'Lv10 最強', nodes: 0, mpv: 1, tol: 0 },
];

// 戦法: 飛車まわりの指し方（attack）と、標準の囲い（castle）。手順は先手から見たUSIで、後手は盤を180度回して使う
// ranged: 振り飛車か（囲いは玉を右側に寄せる）
export const STRATEGIES = {
  auto: { name: 'ランダム（毎局変わる）' },
  none: { name: '定跡まかせ（戦法を決めない）' },
  ibisha: { name: '居飛車', attack: ['2g2f', '2f2e', '7g7f'], castle: 'simple' },
  yagura: { name: '矢倉', attack: ['7g7f', '6g6f', '2g2f'], castle: 'yagura' },
  gangi: { name: '雁木', attack: ['7g7f', '6g6f', '2g2f'], castle: 'gangi' },
  kakugawari: { name: '角換わり', note: true, attack: ['2g2f', '7g7f', '6i7h', '2f2e', '8h2b+', '7i8h', '8h7g'], castle: 'kaku' },
  aigakari: { name: '相掛かり', note: true, attack: ['2g2f', '2f2e', '6i7h', '2e2d', '2h2d', '2d2f'], castle: 'naka' },
  yokofu: { name: '横歩取り', note: true, attack: ['7g7f', '2g2f', '2f2e', '6i7h', '2e2d', '2h2d', '2d3d', '3d3f'], castle: 'naka' },
  bougin: { name: '棒銀', attack: ['2g2f', '2f2e', '7g7f', '6i7h', '3i3h', '3h2g', '2g2f', '2f1e'], castle: 'simple' },
  shiken: { name: '四間飛車', ranged: true, attack: ['7g7f', '6g6f', '2h6h'], castle: 'mino' },
  sangen: { name: '三間飛車', ranged: true, attack: ['7g7f', '6g6f', '2h7h'], castle: 'mino' },
  naka: { name: '中飛車', ranged: true, attack: ['5g5f', '2h5h', '7g7f'], castle: 'mino' },
  mukai: { name: '向かい飛車', ranged: true, attack: ['7g7f', '6g6f', '8h7g', '2h8h'], castle: 'mino' },
};
export const RANDOM_POOL = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'bougin', 'shiken', 'sangen', 'naka', 'mukai', 'none'];

// 囲い。side: 'right' は振り飛車用（玉を右へ）、'left' は居飛車用（玉を左へ）。hidden は選択肢に出さない内部用
export const CASTLES = {
  auto: { name: '戦法に合わせる' },
  mino: { name: '美濃囲い', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '1g1f', '4g4f'] },
  gincan: { name: '銀冠', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '2g2f', '3h2g', '4i3h', '1g1f'] },
  fanaguma: { name: '振り飛車穴熊', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '1i1h', '2h1i', '3i2h', '4i3i', '6i5h'] },
  ianaguma: { name: '居飛車穴熊', side: 'left', drop: ['6i7h'], moves: ['7g7f', '8h7g', '9i9h', '5i6h', '6h7h', '7h8h', '8h9i', '7i8h', '6i7i', '4i5h'] },
  yagura: { name: '矢倉囲い', side: 'left', moves: ['7i6h', '6g6f', '5g5f', '3i4h', '4i5h', '6i7h', '5i6i', '5h6g', '6h7g', '8h7i', '7i4f', '6i7i', '7i8h'] },
  gangi: { name: '雁木囲い', side: 'left', moves: ['6g6f', '7i6h', '5g5f', '3i4h', '6h6g', '4h5g', '6i7h', '4i5h', '5i6i'] },
  simple: { name: '居飛車の簡易な囲い', side: 'left', hidden: true, moves: ['6i7h', '3i4h', '5i6h', '4i5h', '9g9f'] },
  kaku: { name: '角換わりの囲い', side: 'left', hidden: true, moves: ['3i3h', '4g4f', '3h4g', '5i6h', '6h7h'] },
  naka: { name: '中住まい', side: 'left', hidden: true, moves: ['3i3h', '7g7f', '5i5h'] },
};
export const castleFits = (strategyKey, castleKey) => {
  const st = STRATEGIES[strategyKey], c = CASTLES[castleKey];
  if (!c || !c.side || !st || !st.attack) return true;
  return (c.side === 'right') === !!st.ranged;
};

// 定跡の戦法の印として使える戦法（book.txt の tags と同じ名前）
const BOOK_TAGS = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'shiken', 'sangen', 'naka', 'mukai'];

const PLAN_MAX_PLY = 40; // これより後は駒組みを続けない
const PLAN_TOL = 150; // 駒組みの手を指すときに許す損

function mirrorUsi(u) {
  const f = (c) => String(10 - Number(c));
  const r = (c) => String.fromCharCode('a'.charCodeAt(0) + 'i'.charCodeAt(0) - c.charCodeAt(0));
  return f(u[0]) + r(u[1]) + f(u[2]) + r(u[3]) + (u[4] || '');
}

// 手番側から見た評価を数値に（詰みは大きな値）
export function value(l) {
  if (!l) return -99999;
  if (l.mate != null) return l.mate > 0 ? 30000 - l.mate : -30000 - l.mate;
  return l.cp || 0;
}

export class AiPlayer {
  constructor(engine, { level = 5, strategy = 'auto', castle = 'auto' } = {}) {
    this.engine = engine;
    this.level = level;
    this.cfg = LEVELS[level];
    let pool = RANDOM_POOL;
    if (castle !== 'auto') pool = pool.filter((k) => castleFits(k, castle));
    this.strategyKey = strategy === 'auto' ? pool[Math.floor(Math.random() * pool.length)] : strategy;
    const st = STRATEGIES[this.strategyKey];
    this.castleKey = castle !== 'auto' && castleFits(this.strategyKey, castle) ? castle : (st.castle || null);
    this.castleChosen = castle !== 'auto';
    // 駒組み手順 = 飛車まわり + 囲い（同じ手は1回だけ）
    const cs = this.castleKey ? CASTLES[this.castleKey] : null;
    const plan = (st.attack || []).filter((u) => !(cs && cs.drop && cs.drop.includes(u)));
    for (const u of (cs ? cs.moves : [])) if (!plan.includes(u)) plan.push(u);
    // 戦法を決めない場合でも、囲いを選んでいれば囲いだけ組む
    this.plan = this.strategyKey === 'none' && !this.castleChosen ? [] : plan;
    // 手順ごとに「どの駒を動かす手か」を、初形から手順だけを並べて求めておく（違う駒を動かさないため）
    const sim = new Position();
    this.planPiece = this.plan.map((u) => {
      const mv = usiToMove(u);
      const pc = sim.board[mv.from];
      if (pc && colorOf(pc) === SENTE) {
        sim.board[mv.to] = mv.promote ? '+' + pc : pc;
        sim.board[mv.from] = null;
        return typeOf(pc);
      }
      return null;
    });
    this.planIdx = 0;
    this.planFails = 0;
  }

  get castleName() { return this.castleKey ? CASTLES[this.castleKey].name : ''; }

  // 定跡から選ぶ手（なければ null）
  bookMove(pos) {
    if (!bookReady()) return null;
    // 弱いレベルは序盤の早いうちだけ定跡を使う。囲いを指定したときは囲いを優先して、定跡は12手目まで
    const maxPly = this.castleChosen ? 12 : this.level <= 3 ? 10 : 99;
    if (pos.ply > maxPly) return null;
    const ms = bookMoves(pos);
    if (!ms || !ms.length) return null;
    const me = pos.turn;
    const best = Math.max(...ms.map((m) => m.ev));
    const width = this.level >= 10 ? 30 : this.level >= 8 ? 60 : 100;
    let cands = ms.filter((m) => m.ev >= best - width);
    if (this.strategyKey !== 'none') {
      if (!BOOK_TAGS.includes(this.strategyKey)) return null; // 棒銀など定跡で区別できない戦法は駒組み手順で指す
      cands = cands.filter((m) => m.tags[me].has(this.strategyKey));
    }
    if (!cands.length) return null;
    const legal = pos.legalMoves();
    const ok = cands.map((m) => ({ m, mv: legal.find((x) => moveToUsi(x) === m.usi) })).filter((x) => x.mv);
    if (!ok.length) return null;
    const w = ok.map((x) => Math.exp((x.m.ev - best) / 30));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ok.length; i++) { r -= w[i]; if (r <= 0) return ok[i].mv; }
    return ok[0].mv;
  }

  get strategyName() { return STRATEGIES[this.strategyKey].name; }

  // 次に指したい駒組みの手（指せなければ null）
  nextPlanMove(pos) {
    if (pos.ply > PLAN_MAX_PLY || this.planFails >= 4) return null;
    const me = pos.turn;
    const legal = pos.legalMoves();
    while (this.planIdx < this.plan.length) {
      const u0 = this.plan[this.planIdx];
      const u = me === SENTE ? u0 : mirrorUsi(u0);
      const mv = usiToMove(u);
      const pc = pos.board[mv.from];
      const want = this.planPiece[this.planIdx];
      const fromOk = pc && colorOf(pc) === me && (!want || typeOf(pc) === want);
      const toPc = pos.board[mv.to];
      // すでに駒が目的地にある、または元の駒がいない → この手順は飛ばす
      if (!fromOk) { this.planIdx++; continue; }
      if (toPc && colorOf(toPc) === me) { this.planIdx++; continue; }
      const lm = legal.find((m) => sameMove(m, mv));
      if (!lm) { this.planIdx++; continue; }
      return lm;
    }
    return null;
  }

  // 最強レベルの考慮時間: 最大5秒。持ち時間の残りと局面の進み具合で短くする
  goCommand(clock, side, ply = 1) {
    if (this.cfg.nodes) return `go nodes ${this.cfg.nodes}`;
    const MAX = 5000, MIN = 500;
    let t = MAX;
    if (clock && clock.enabled) {
      const main = Math.max(0, clock.main[side]);
      const byo = clock.byoyomi;
      if (main > 0) {
        // 残り時間を、あと40手ほどで使い切る配分にする。秒読みがあればその一部も使う
        t = main / 40 + (byo ? byo * 0.3 : 0);
        if (byo) t = Math.min(t, main + byo - 1500);
      } else {
        t = byo - 1500; // 秒読みだけ
      }
    }
    if (ply <= 20) t *= 0.6; // 序盤は軽めに
    return `go movetime ${Math.round(Math.max(MIN, Math.min(MAX, t)))}`;
  }

  // 人間らしく見せるための考慮時間（ミリ秒）。Lv1〜9は探索がすぐ終わるので、この時間まで待ってから指す
  paceMs(clock, side, ply) {
    if (!this.cfg.nodes) return 0;
    const base = [0, 1000, 1200, 1500, 2000, 2500, 3000, 3500, 4000, 4500][this.level];
    let t = base;
    if (clock && clock.enabled) {
      const main = Math.max(0, clock.main[side]);
      const byo = clock.byoyomi;
      if (main > 0) t = Math.min(t, main / 40 + (byo ? byo * 0.2 : 0));
      else t = Math.min(t, byo * 0.4);
    }
    if (ply <= 12) t *= 0.6; // 序盤はテンポよく
    t *= 0.7 + Math.random() * 0.6; // 毎手同じ間にならないように
    return Math.max(300, t);
  }

  // 戻り値: { move, resign, info } / 中断されたら null
  async think(pos, clock) {
    // まず定跡
    const bm = this.bookMove(pos);
    if (bm) return { move: bm, book: true };
    const sfen = pos.toSfen();
    const openingTol = pos.ply <= 16 ? 40 : 0; // 序盤は少し散らして毎回同じ将棋にしない
    const mpv = Math.max(this.cfg.mpv, openingTol ? 4 : 1);
    const res = await this.engine.searchOnce({ sfen, multipv: mpv, go: this.goCommand(clock, pos.turn, pos.ply) });
    if (!res) return null;
    if (res.bestmove === 'resign') return { resign: true };
    if (res.bestmove === 'win') return { win: true };
    const lines = res.lines.filter((l) => l && l.pv && l.pv[0]);
    if (!lines.length) return { move: usiToMove(res.bestmove) };
    const bestV = Math.max(...lines.map(value));

    // 戦法の駒組み
    const planMv = this.nextPlanMove(pos);
    if (planMv) {
      const u = moveToUsi(planMv);
      let pv = null;
      const hit = lines.find((l) => l.pv[0] === u);
      if (hit) pv = value(hit);
      else {
        const p = pos.clone();
        p.applyMove(planMv);
        const r2 = await this.engine.searchOnce({ sfen: p.toSfen(), multipv: 1, go: `go nodes ${Math.max(20000, this.cfg.nodes || 200000)}` });
        if (!r2) return null;
        const l2 = r2.lines[0];
        if (l2) pv = -value(l2);
      }
      if (pv != null && bestV - pv <= Math.max(PLAN_TOL, this.cfg.tol)) {
        this.planIdx++;
        this.planFails = 0;
        return { move: planMv, plan: true };
      }
      this.planFails++;
    }

    // レベルに応じて、損が許容範囲の手から選ぶ（良い手ほど選ばれやすい）
    const tol = Math.max(this.cfg.tol, openingTol);
    const ok = lines.filter((l) => bestV - value(l) <= tol);
    // 自分が詰ませられる局面や、詰まされる手は許容しない
    const safe = ok.filter((l) => !(l.mate != null && l.mate < 0) || value(l) === bestV);
    const pool = safe.length ? safe : [lines.find((l) => value(l) === bestV)];
    const scale = tol * 0.4 + 1;
    const w = pool.map((l) => Math.exp(-(bestV - value(l)) / scale));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    let pick = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
    return { move: usiToMove(pick.pv[0]) };
  }
}
