// 対局AI: レベルに応じた手の選び方と、戦法ごとの駒組み
import { Position, SENTE, typeOf, colorOf, moveToUsi, usiToMove, sameMove } from './shogi.js';

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

// 先手から見た駒組みの手順（後手は盤を180度回して使う）
export const STRATEGIES = {
  auto: { name: 'おまかせ' },
  none: { name: 'エンジン任せ', plan: [] },
  ibisha: { name: '居飛車', plan: ['2g2f', '2f2e', '7g7f', '6i7h', '3i4h', '5i6h', '4i5h', '9g9f'] },
  bougin: { name: '棒銀', plan: ['2g2f', '2f2e', '7g7f', '6i7h', '3i3h', '3h2g', '2g2f', '2f1e'] },
  shiken: { name: '四間飛車', plan: ['7g7f', '6g6f', '2h6h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '1g1f', '4g4f'] },
  sangen: { name: '三間飛車', plan: ['7g7f', '6g6f', '2h7h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '1g1f', '4g4f'] },
  naka: { name: '中飛車', plan: ['5g5f', '2h5h', '5i4h', '4h3h', '3h2h', '3i3h', '7g7f', '4g4f', '5f5e'] },
  mukai: { name: '向かい飛車', plan: ['7g7f', '6g6f', '8h7g', '2h8h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h'] },
};
export const RANDOM_POOL = ['ibisha', 'bougin', 'shiken', 'sangen', 'naka', 'mukai', 'none'];

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
  constructor(engine, { level = 5, strategy = 'auto' } = {}) {
    this.engine = engine;
    this.level = level;
    this.cfg = LEVELS[level];
    this.strategyKey = strategy === 'auto' ? RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)] : strategy;
    this.plan = (STRATEGIES[this.strategyKey].plan || []).slice();
    this.planIdx = 0;
    this.planFails = 0;
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
      const fromOk = pc && colorOf(pc) === me;
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

  // pos.turn の側が使う考慮時間
  goCommand(clock, side) {
    if (this.cfg.nodes) return `go nodes ${this.cfg.nodes}`;
    // 最強: 1手5〜10秒を目安に、持ち時間に合わせて短くする
    let t = 8000;
    if (clock && clock.enabled) {
      const main = Math.max(0, clock.main[side]);
      const byo = clock.byoyomi;
      let safe;
      if (main > 0) safe = byo ? main + byo - 1500 : main / 25;
      else safe = byo - 1500;
      t = Math.min(t, Math.max(500, safe));
      if (main > 0 && !byo) t = Math.min(t, main / 25);
    }
    return `go movetime ${Math.round(Math.max(500, t))}`;
  }

  // 戻り値: { move, resign, info } / 中断されたら null
  async think(pos, clock) {
    const sfen = pos.toSfen();
    const openingTol = pos.ply <= 16 ? 40 : 0; // 序盤は少し散らして毎回同じ将棋にしない
    const mpv = Math.max(this.cfg.mpv, openingTol ? 4 : 1);
    const res = await this.engine.searchOnce({ sfen, multipv: mpv, go: this.goCommand(clock, pos.turn) });
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
