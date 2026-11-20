// 対局AI: レベルに応じた手の選び方と、戦法ごとの駒組み
import { Position, SENTE, typeOf, colorOf, moveToUsi, usiToMove, sameMove } from './shogi.js';
import { bookMoves, bookReady } from './book.js';
import { josekiMoves, josekiShapeMoves, SUB_RULES } from './joseki.js';

// レベルごとの設定
// nodes: 探索量 / mpv: 比べる候補の数 / tol: 許す評価値の損（これ以内の手からランダムに選ぶ）
// 弱さは主に読みの浅さで出す。許す損が大きいと、持久戦で意味のない手を続けて評価値を下げすぎるので小さめにしている（v23）
export const LEVELS = [
  null,
  { name: 'Lv1 入門', nodes: 2000, mpv: 10, tol: 300 },
  { name: 'Lv2', nodes: 4000, mpv: 10, tol: 220 },
  { name: 'Lv3', nodes: 8000, mpv: 8, tol: 160 },
  { name: 'Lv4', nodes: 20000, mpv: 8, tol: 120 },
  { name: 'Lv5', nodes: 50000, mpv: 7, tol: 90 },
  { name: 'Lv6', nodes: 100000, mpv: 6, tol: 70 },
  { name: 'Lv7', nodes: 200000, mpv: 5, tol: 50 },
  { name: 'Lv8', nodes: 400000, mpv: 4, tol: 35 },
  { name: 'Lv9', nodes: 1000000, mpv: 3, tol: 20 },
  { name: 'Lv10 最強', nodes: 0, mpv: 1, tol: 0 },
];

// 戦法: 飛車まわりの指し方（attack）と、標準の囲い（castle）。手順は先手から見たUSIで、後手は盤を180度回して使う
// ranged: 振り飛車か（囲いは玉を右側に寄せる）
export const STRATEGIES = {
  auto: { name: 'ランダム（毎局変わる）' },
  nojoseki: { name: '定跡を使わない（読みだけで指す）' },
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
  migishiken: { name: '右四間飛車', attack: ['7g7f', '4g4f', '2h4h', '3i3h', '3h4g'], castle: 'elmo' },
  elmo: { name: 'エルモ急戦（対振り飛車）', attack: ['7g7f', '2g2f', '2f2e', '3i4h'], castle: 'elmo' },
  millennium: { name: 'ミレニアム（対振り飛車）', attack: ['7g7f', '2g2f', '2f2e', '3i4h', '4h5g'], castle: 'millennium' },
  kishu: { name: '奇襲（鬼殺し・嬉野流・パックマンなど）', attack: ['7g7f', '2g2f'], castle: 'simple' },
  fujii: { name: '藤井システム', ranged: true, attack: ['7g7f', '6g6f', '2h6h', '1g1f', '8h7g'], castle: 'mino' },
};
// 細かい戦法（joseki.js の SUB_RULES）。定跡は名前で見分けた手順を使い、外れたら大きな戦法の定跡に戻る。駒組みは大きな戦法と同じ
const SUB_CASTLE = { chosoku: 'simple', taigokigen: 'simple', ibianaguma: 'ianaguma', furiana: 'fanaguma', migigyoku: 'kaku', koshikake: 'kaku', ichitezon: 'kaku' };
{
  const ordered = {};
  for (const [k, v] of Object.entries(STRATEGIES)) {
    ordered[k] = v;
    for (const r of SUB_RULES) {
      const b = Array.isArray(r.base) ? r.base[0] : r.base;
      if (b !== k) continue;
      ordered[r.key] = { ...v, name: r.name, base: b, castle: SUB_CASTLE[r.key] || v.castle };
    }
  }
  for (const k of Object.keys(STRATEGIES)) delete STRATEGIES[k];
  Object.assign(STRATEGIES, ordered);
}
export const RANDOM_POOL = ['ibisha', 'yagura', 'gangi', 'kakugawari', 'aigakari', 'yokofu', 'bougin', 'migishiken', 'elmo', 'millennium', 'shiken', 'fujii', 'sangen', 'naka', 'mukai', 'gokigen', 'ishida', 'ibianaguma', 'furiana', 'kakushiken', 'koshikake'];

// 囲い。side: 'right' は振り飛車用（玉を右へ）、'left' は居飛車用（玉を左へ）。hidden は選択肢に出さない内部用
export const CASTLES = {
  auto: { name: '戦法に合わせる' },
  mino: { name: '美濃囲い', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '1g1f', '4g4f'] },
  gincan: { name: '銀冠', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '2g2f', '3h2g', '4i3h', '1g1f'] },
  fanaguma: { name: '振り飛車穴熊', side: 'right', moves: ['5i4h', '4h3h', '3h2h', '1i1h', '2h1i', '3i2h', '4i3i', '6i5h'] },
  ianaguma: { name: '居飛車穴熊', side: 'left', drop: ['6i7h'], moves: ['7g7f', '8h7g', '9i9h', '5i6h', '6h7h', '7h8h', '8h9i', '7i8h', '6i7i', '4i5h'] },
  yagura: { name: '矢倉囲い', side: 'left', moves: ['7i6h', '6g6f', '5g5f', '3i4h', '4i5h', '6i7h', '5i6i', '5h6g', '6h7g', '8h7i', '7i4f', '6i7i', '7i8h'] },
  gangi: { name: '雁木囲い', side: 'left', moves: ['6g6f', '7i6h', '5g5f', '3i4h', '6h6g', '4h5g', '6i7h', '4i5h', '5i6i'] },
  elmo: { name: 'エルモ囲い', side: 'left', moves: ['5i6h', '6h7h', '7i6h', '6i7i', '4i5h'] },
  millennium: { name: 'ミレニアム', side: 'left', moves: ['5i6h', '6h7h', '7i6h', '7h7i', '8i7g', '7i8i', '6i7h', '6h7i', '4i5h'] },
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
const PLAN_TOL = 30; // 駒組みの手・コンピュータの定跡の手を指すときに許す損（レベルによらず小さく）
const SHAPE_TOL = 60; // 人の定跡の形の手に許す損（エンジンは人の定跡の手を少し低く見るため、駒組みより少し広く）
const PLAN_TOL_ATTACK = 150; // 飛車を振る手に許す損（エンジンは振り飛車を低く見るため）
const OPEN_END = 24; // ここまでは序盤として、全レベルで深く読み、損の小さい手だけを指す
const MID_END = 40; // ここにかけてレベル本来の読みの量と許す損に戻す
const OPEN_NODES = 150000; // 序盤の読みの量
const DEEP_NODES = 300000; // 選んだ手が大きく損していないか確かめるときの読みの量
const GUARD_EXTRA = 60; // 確かめたときに、許す損をこれ以上超えていたら選び直す
const OPEN_TOL = 25; // 序盤に許す損（大きいと７七桂のような筋の悪い手が混じる）

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
    if (!STRATEGIES[strategy]) strategy = 'auto'; // 前の版で保存した「定跡まかせ」など
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
    this.plan = this.strategyKey === 'nojoseki' && !this.castleChosen ? [] : plan;
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
    // 飛車まわりの手（戦法を決める手）は、囲いの手より少し大きな損まで許す
    this.planAttack = this.plan.map((u, i) => (st.attack || []).includes(u) && this.planPiece[i] === 'R');
    this.planIdx = 0;
    this.planFails = 0; // 飛ばした手順の数
    this.stepFails = 0; // 今の手順を見送った回数
  }

  get noJoseki() { return this.strategyKey === 'nojoseki'; }

  get castleName() { return this.castleKey ? CASTLES[this.castleKey].name : ''; }

  // 飛車を初めの位置から動かしたか
  rookSwung(pos) {
    const me = pos.turn;
    const pc = pos.board[me === SENTE ? 7 * 9 + 7 : 1 * 9 + 1]; // ２八 / ８二
    return !(pc && colorOf(pc) === me && typeOf(pc) === 'R');
  }

  // 定跡から選ぶ手（なければ null）
  bookMove(pos) {
    if (!bookReady() || this.noJoseki) return null;
    // 弱いレベルは序盤の早いうちだけ定跡を使う。囲いを指定したときは囲いを優先して、定跡は12手目まで
    const maxPly = this.castleChosen ? 12 : this.level <= 3 ? 10 : 99;
    if (pos.ply > maxPly) return null;
    const ms = bookMoves(pos);
    if (!ms || !ms.length) return null;
    const me = pos.turn;
    const best = Math.max(...ms.map((m) => m.ev));
    const width = 20; // 定跡でも評価の低い手（序盤の５二金右など）は選ばない
    let cands = ms.filter((m) => m.ev >= best - width);
    // 振り飛車は、定跡の戦法の印に居飛車のような手も混じるので、飛車を振るまでは定跡を使わない
    if (STRATEGIES[this.strategyKey].ranged && !this.rookSwung(pos)) return null;
    {
      const bk = STRATEGIES[this.strategyKey].base || this.strategyKey;
      if (!BOOK_TAGS.includes(bk)) return null; // 棒銀など定跡で区別できない戦法は駒組み手順で指す
      cands = cands.filter((m) => m.tags[me].has(bk));
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

  // 形の定跡の候補（自分の駒の配置が定跡に出てきた形と同じなら、そこで指された駒組みの手）。重みの大きい順
  shapeCands(pos, legal) {
    if (pos.ply > PLAN_MAX_PLY || this.noJoseki) return [];
    const out = [];
    for (const u of this.fallbackMoves(josekiShapeMoves, pos)) {
      const mv = legal.find((x) => moveToUsi(x) === u);
      if (mv && !pos.board[mv.to]) out.push(mv);
    }
    return out.sort(() => Math.random() - 0.5);
  }

  // 対振り飛車用の戦法（エルモ・ミレニアム）や右四間で、相手が振らずにその戦法の定跡がないときは、居飛車の定跡で指す
  fallbackMoves(fn, pos) {
    const ms = fn(pos, this.strategyKey);
    if (ms.length) return ms;
    const base = STRATEGIES[this.strategyKey].base;
    if (base) return fn(pos, base); // 細かい戦法の手順を外れたら、大きな戦法の定跡で
    if (!['elmo', 'millennium', 'migishiken'].includes(this.strategyKey)) return ms;
    return fn(pos, 'ibisha');
  }

  // 人の定跡の手（js/joseki.js）。レベルによらず指す
  josekiMove(pos) {
    if (this.noJoseki) return null;
    if (this.castleChosen && pos.ply > 12) return null; // 囲いを指定したときは、途中から囲いの手順を優先
    const legal = pos.legalMoves();
    const ms = this.fallbackMoves(josekiMoves, pos).map((u) => legal.find((x) => moveToUsi(x) === u)).filter(Boolean);
    return ms.length ? ms[Math.floor(Math.random() * ms.length)] : null;
  }

  // 選んだ手を深く読み直して、最善からの損を返す（浅い読みの見落としで大きく損する手を避けるため）。null は中断
  async deepLoss(pos, mv) {
    const n = Math.max(DEEP_NODES, (this.cfg.nodes || 0) * 2);
    const a = await this.engine.searchOnce({ sfen: pos.toSfen(), multipv: 1, go: `go nodes ${n}` });
    if (!a) return null;
    const p = pos.clone();
    p.applyMove(mv);
    const b = await this.engine.searchOnce({ sfen: p.toSfen(), multipv: 1, go: `go nodes ${n}` });
    if (!b) return null;
    if (!a.lines[0] || !b.lines[0]) return 0;
    return value(a.lines[0]) + value(b.lines[0]);
  }

  // 候補の手が、最善と比べて tol 以内の損か（読み直しが必要なら1回だけ読む）。null は中断
  async lossOf(pos, mv, lines, bestV) {
    const u = moveToUsi(mv);
    const hit = lines.find((l) => l.pv[0] === u);
    if (hit) return bestV - value(hit);
    const p = pos.clone();
    p.applyMove(mv);
    const r2 = await this.engine.searchOnce({ sfen: p.toSfen(), multipv: 1, go: `go nodes ${Math.max(OPEN_NODES, this.cfg.nodes || 300000)}` });
    if (!r2) return null;
    const l2 = r2.lines[0];
    return l2 ? bestV + value(l2) : 99999;
  }

  get strategyName() { return STRATEGIES[this.strategyKey].name; }

  // 次に指したい駒組みの手（指せなければ null）
  nextPlanMove(pos) {
    if (pos.ply > PLAN_MAX_PLY || this.planFails >= 4) return null; // 手順を4つ飛ばしたら駒組みはやめる
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

  // 序盤は全レベル共通でまともに指す。OPEN_END手目までは深く読んで損を小さく、MID_END手目にかけてレベル本来の強さに戻す
  phase(ply) { return ply <= OPEN_END ? 0 : ply >= MID_END ? 1 : (ply - OPEN_END) / (MID_END - OPEN_END); }
  tolAt(ply) {
    const t = this.phase(ply);
    const early = ply <= 16 ? OPEN_TOL : Math.min(this.cfg.tol, OPEN_TOL); // 16手目までは毎回同じ将棋にならないよう少し散らす
    return Math.round(early + (this.cfg.tol - early) * t);
  }
  goAt(clock, side, ply) {
    if (!this.cfg.nodes) return this.goCommand(clock, side, ply);
    const t = this.phase(ply);
    const n = Math.max(this.cfg.nodes, OPEN_NODES);
    return `go nodes ${Math.round(n + (this.cfg.nodes - n) * t)}`;
  }

  // 戻り値: { move, resign, info } / 中断されたら null
  async think(pos, clock) {
    // まず人の定跡
    const jm = this.josekiMove(pos);
    if (jm) return { move: jm, joseki: true };
    const sfen = pos.toSfen();
    const tol = this.tolAt(pos.ply);
    const mpv = Math.max(this.cfg.mpv, pos.ply <= MID_END ? 4 : 1);
    const res = await this.engine.searchOnce({ sfen, multipv: mpv, go: this.goAt(clock, pos.turn, pos.ply) });
    if (!res) return null;
    if (res.bestmove === 'resign') return { resign: true };
    if (res.bestmove === 'win') return { win: true };
    const lines = res.lines.filter((l) => l && l.pv && l.pv[0]);
    if (!lines.length) return { move: usiToMove(res.bestmove) };
    const bestV = Math.max(...lines.map(value));

    // 定跡の形（人の定跡の手順に出てくる自分の駒の形なら、その手順の手）。棒銀と囲いを指定したときは、駒組み手順を先に試す
    const legal = pos.legalMoves();
    const shapeFirst = this.strategyKey !== 'bougin' && !this.castleChosen;
    const tryShape = async () => {
      const cs = this.shapeCands(pos, legal).slice(0, 2);
      for (const mv of cs) {
        const loss = await this.lossOf(pos, mv, lines, bestV);
        if (loss == null) return null;
        const isRook = typeOf(pos.board[mv.from]) === 'R';
        const lim = isRook && STRATEGIES[this.strategyKey].ranged ? PLAN_TOL_ATTACK : SHAPE_TOL;
        if (loss <= lim) {
          const dl = await this.deepLoss(pos, mv);
          if (dl == null) return null;
          if (dl <= lim + GUARD_EXTRA) return { move: mv, shape: true };
        }
      }
      return false;
    };
    if (shapeFirst) {
      const r = await tryShape();
      if (r === null) return null;
      if (r) return r;
    }

    // コンピュータの定跡（最善との差が小さい手だけ）
    const bm = this.bookMove(pos);
    if (bm) {
      const loss = await this.lossOf(pos, bm, lines, bestV);
      if (loss == null) return null;
      if (loss <= PLAN_TOL) return { move: bm, book: true };
    }

    // 戦法の駒組み（自然な手のときだけ。損が大きい手は指さない）
    const planMv = this.nextPlanMove(pos);
    if (planMv) {
      const u = moveToUsi(planMv);
      let pv = null;
      const hit = lines.find((l) => l.pv[0] === u);
      if (hit) pv = value(hit);
      else {
        const p = pos.clone();
        p.applyMove(planMv);
        const r2 = await this.engine.searchOnce({ sfen: p.toSfen(), multipv: 1, go: `go nodes ${Math.max(OPEN_NODES, this.cfg.nodes || 300000)}` });
        if (!r2) return null;
        const l2 = r2.lines[0];
        if (l2) pv = -value(l2);
      }
      const plim = this.planAttack[this.planIdx] ? PLAN_TOL_ATTACK : PLAN_TOL;
      let okPlan = pv != null && bestV - pv <= plim;
      if (okPlan) {
        const dl = await this.deepLoss(pos, planMv);
        if (dl == null) return null;
        okPlan = dl <= plim + GUARD_EXTRA;
      }
      if (okPlan) {
        this.planIdx++;
        this.stepFails = 0;
        return { move: planMv, plan: true };
      }
      // 3回続けて見送ったら、その手順は飛ばして次の手順へ
      if (++this.stepFails >= 3) { this.planIdx++; this.stepFails = 0; this.planFails++; }
    }

    if (!shapeFirst) {
      const r = await tryShape();
      if (r === null) return null;
      if (r) return r;
    }

    // レベルに応じて、損が許容範囲の手から選ぶ（良い手ほど選ばれやすい）
    const ok = lines.filter((l) => bestV - value(l) <= tol);
    // 自分が詰ませられる局面や、詰まされる手は許容しない
    const safe = ok.filter((l) => !(l.mate != null && l.mate < 0) || value(l) === bestV);
    const pool = safe.length ? safe : [lines.find((l) => value(l) === bestV)];
    const scale = tol * 0.4 + 1;
    const w = pool.map((l) => Math.exp(-(bestV - value(l)) / scale));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    let pick = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
    const bestLine = lines.find((l) => value(l) === bestV);
    if (pick !== bestLine && bestLine) {
      // 浅い読みで選んだ最善以外の手は、深く読み直して損が大きすぎたら最善の手にする
      const dl = await this.deepLoss(pos, usiToMove(pick.pv[0]));
      if (dl == null) return null;
      if (dl > tol + GUARD_EXTRA) pick = bestLine;
    }
    return { move: usiToMove(pick.pv[0]) };
  }
}
