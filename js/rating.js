// レーティングと段位（このアプリ独自の目安。公式の段級位とは関係ない）
// AIとの対局（人1人対AI、待ったなし、勝敗がついたもの）だけで計算する。
// 記録から毎回計算し直すので、書き出し・読み込みしても同じ結果になる。

// AIレベルごとの仮のレーティング（実際の強さに合わせて今後調整する）
// v49：序盤が定跡どおりになって強くなったので、全体を300上げた。目安は「Lv7がぴよ将棋のLv30（四段＋）より強い」（Akitack、2026-11-23）
// v51：Lv7（後手）がぴよ将棋Lv35（六段）に勝ち、Lv36（六段）に負けた。Akitackの見立て「このあたりがLv7」で、Lv7を六段（2300）に。
//      Lv4＝1500は違和感がない（Akitack）ので固定し、Lv4〜Lv7のあいだを等分。Lv8より上も同じくらいの間隔で上げた
export const AI_RATING = [null, 900, 1100, 1300, 1500, 1750, 2000, 2300, 2500, 2700, 3000];
export const START_RATING = 1000;
export const PROVISIONAL_GAMES = 10; // これより少ないうちは「仮」

// 持ち時間の区分
export const TIME_CLASSES = {
  none: '時間なし',
  byo: '秒読みのみ',
  blitz: '早指し（5分以下）',
  rapid: '10〜15分',
  long: '30分以上',
};
export function timeClass(tc) {
  if (!tc) return null;
  const { main = 0, byo = 0 } = tc;
  if (!main && !byo) return 'none';
  if (!main) return 'byo';
  if (main <= 300) return 'blitz';
  if (main <= 900) return 'rapid';
  return 'long';
}

// 段級位（下限のレーティング）
const RANKS = [
  [2400, '七段'], [2250, '六段'], [2100, '五段'], [1950, '四段'], [1800, '三段'], [1650, '二段'], [1500, '初段'],
  [1400, '1級'], [1300, '2級'], [1200, '3級'], [1100, '4級'], [1000, '5級'], [900, '6級'], [800, '7級'], [700, '8級'], [600, '9級'],
  [-Infinity, '10級'],
];
export function rankOf(r) {
  for (const [min, name] of RANKS) if (r >= min) return name;
  return '10級';
}
// 次の段級位までのあと何点か
export function nextRank(r) {
  const up = RANKS.slice().reverse().find(([min]) => min > r);
  return up ? { name: up[1], need: Math.ceil(up[0] - r) } : null;
}

export const isRated = (g) => g.mySide != null && g.aiLevel && !g.undo && ['win', 'lose', 'draw'].includes(g.outcome);

function update(st, opp, score) {
  const k = st.n < 20 ? 40 : 20; // 最初は大きく動き、だんだん落ち着く
  const e = 1 / (1 + 10 ** ((opp - st.r) / 400));
  const d = k * (score - e);
  st.r += d;
  st.n++;
  return d;
}

// 全体と持ち時間ごとのレーティングを計算する
export function computeRatings(games) {
  const rated = games.filter(isRated).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  const overall = { r: START_RATING, n: 0, hist: [] };
  const byTime = {};
  const perGame = new Map(); // key -> { before, after, delta, timeKey, tBefore, tAfter }
  for (const g of rated) {
    const opp = AI_RATING[g.aiLevel];
    const score = g.outcome === 'win' ? 1 : g.outcome === 'draw' ? 0.5 : 0;
    const before = overall.r;
    update(overall, opp, score);
    overall.hist.push(Math.round(overall.r));
    const tk = timeClass(g.timeControl);
    let tBefore = null, tAfter = null;
    if (tk) {
      const t = byTime[tk] || (byTime[tk] = { r: START_RATING, n: 0, hist: [] });
      tBefore = t.r;
      update(t, opp, score);
      t.hist.push(Math.round(t.r));
      tAfter = t.r;
    }
    perGame.set(g.key, { before, after: overall.r, timeKey: tk, tBefore, tAfter });
  }
  return { overall, byTime, perGame };
}
