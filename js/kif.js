// KIF / KI2 / SFEN の読み込みと KIF の書き出し
import { Position, STARTPOS, SENTE, ZEN, KAN, PIECE_NAME, typeOf, fileOf, rankOf, sq, moveToJa, sameMove, usiToMove } from './shogi.js';

const HANDICAP = {
  '平手': STARTPOS,
  '香落ち': 'lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '右香落ち': '1nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '角落ち': 'lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '飛車落ち': 'lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '飛香落ち': 'lnsgkgsn1/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '二枚落ち': 'lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '四枚落ち': '1nsgkgsn1/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '六枚落ち': '2sgkgs2/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '八枚落ち': '3gkg3/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
  '十枚落ち': '4k4/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1',
};

const NAME_TO_TYPE = {
  '歩': 'P', '香': 'L', '桂': 'N', '銀': 'S', '金': 'G', '角': 'B', '飛': 'R', '玉': 'K', '王': 'K',
  'と': '+P', '成香': '+L', '杏': '+L', '成桂': '+N', '圭': '+N', '成銀': '+S', '全': '+S',
  '馬': '+B', '龍': '+R', '竜': '+R',
};
const ZEN_NUM = { '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9 };
const KAN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const END_WORDS = ['投了', '中断', '千日手', '詰み', '持将棋', '切れ負け', '反則勝ち', '反則負け', '入玉勝ち', '不戦勝', '不戦敗', '時間切れ'];

// ファイルのバイト列を文字列に（UTF-8で読めなければShift_JIS）
export function decodeBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

// 戻り値: { startSfen, moves: [{move, comment}], header: {}, result }
export function parseGameText(text) {
  const t = text.trim();
  // SFEN / USI position 形式
  if (/^(position\s+)?(startpos|sfen\s)/.test(t) || /^[lnsgkbrpLNSGKBRP1-9+\/]+\s+[bw]\s/.test(t)) {
    return parseUsi(t);
  }
  return parseKif(t);
}

function parseUsi(t) {
  let s = t.replace(/^position\s+/, '');
  let startSfen = STARTPOS, rest = '';
  if (s.startsWith('startpos')) {
    rest = s.slice(8);
  } else {
    s = s.replace(/^sfen\s+/, '');
    const m = s.match(/^(\S+\s+[bw]\s+\S+(?:\s+\d+)?)(.*)$/);
    if (!m) throw new Error('SFENを読み取れませんでした');
    startSfen = m[1].trim();
    if (startSfen.split(/\s+/).length === 3) startSfen += ' 1';
    rest = m[2];
  }
  const ms = rest.replace(/^\s*moves\s*/, '').trim().split(/\s+/).filter(Boolean);
  const pos = new Position(startSfen);
  const moves = [];
  for (const u of ms) {
    const mv = usiToMove(u);
    if (!pos.isLegal(mv)) throw new Error(`${moves.length + 1}手目 ${u} は指せない手です`);
    pos.applyMove(mv);
    moves.push({ move: mv, comment: '' });
  }
  return { startSfen, moves, header: {}, result: '' };
}

function parseKif(text) {
  const lines = text.split(/\r?\n/);
  const header = {};
  let startSfen = STARTPOS;
  const bod = [];
  let pos = null;
  const moves = [];
  let prevTo = null;
  let result = '';
  let ended = false;
  let isKi2 = null;
  let summary = '';

  const ensurePos = () => {
    if (!pos) {
      if (bod.length) startSfen = bodToSfen(bod, header);
      pos = new Position(startSfen);
    }
  };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (/^変化：/.test(line)) break; // 本譜のみ読む
    if (line.startsWith('*')) { // コメント
      const c = line.slice(1);
      if (moves.length) moves[moves.length - 1].comment += (moves[moves.length - 1].comment ? '\n' : '') + c;
      continue;
    }
    if (line.startsWith('&')) continue;
    // 局面図（BOD）
    if (/^[ 　]*[|｜]/.test(line) || /^[ 　]*９[ 　]*８[ 　]*７/.test(line) || /^\+-+/.test(line)) {
      if (/[|｜]/.test(line)) bod.push(line);
      continue;
    }
    const hm = line.match(/^([^：:]+)[：:](.*)$/);
    if (hm && !/^\s*\d+\s/.test(line) && !/^[▲△☗☖]/.test(line)) {
      const key = hm[1].trim(), val = hm[2].trim();
      header[key] = val;
      if (key === '手合割' && HANDICAP[val.replace(/\s/g, '')]) startSfen = HANDICAP[val.replace(/\s/g, '')];
      if (key === 'SFEN' || key === '局面') startSfen = val;
      continue;
    }
    if (/^手数[-－]/.test(line)) { isKi2 = false; continue; }
    if (/^(先手番|後手番)/.test(line)) { if (line.startsWith('後手番')) header.__turn = 'w'; continue; }
    if (ended) continue;

    // KIF: "   1 ７六歩(77)   ( 0:01/00:00:01)"
    const km = line.match(/^\s*(\d+)[ \t]+(.+)$/);
    if (km) {
      ensurePos();
      const tok = km[2].trim().split(/[ \t]+/)[0];
      if (END_WORDS.some((w) => tok.startsWith(w))) { result = tok; ended = true; continue; }
      const mv = parseOne(pos, tok, prevTo, true);
      if (!mv) throw new Error(`${km[1]}手目「${tok}」を読み取れませんでした`);
      pos.applyMove(mv);
      prevTo = mv.to;
      moves.push({ move: mv, comment: '' });
      continue;
    }
    // KI2: "▲７六歩    △３四歩"
    if (/^[▲△☗☖]/.test(line)) {
      ensurePos();
      const toks = line.split(/(?=[▲△☗☖])/).map((s) => s.trim()).filter(Boolean);
      for (const tk of toks) {
        const body = tk.slice(1).trim();
        if (END_WORDS.some((w) => body.startsWith(w))) { result = body; ended = true; break; }
        const mv = parseOne(pos, body, prevTo, false);
        if (!mv) throw new Error(`${moves.length + 1}手目「${tk}」を読み取れませんでした`);
        pos.applyMove(mv);
        prevTo = mv.to;
        moves.push({ move: mv, comment: '' });
      }
      continue;
    }
    const em = line.match(/^まで(\d+)手(.*)$/);
    if (em) { summary = line.trim(); ended = true; continue; }
  }
  ensurePos();
  return { startSfen, moves, header, result, summary };
}

// 1手分の文字列を解釈（例: ７六歩(77) / 同　歩(23) / ５五角打 / ２二角成 / ４八金右）
function parseOne(pos, tok, prevTo, kif) {
  let s = tok.replace(/[\s　]+/g, '');
  let to;
  if (s.startsWith('同')) {
    to = prevTo;
    s = s.slice(1);
  } else {
    const f = ZEN_NUM[s[0]] || Number(s[0]);
    const r = KAN_NUM[s[1]] || Number(s[1]);
    if (!f || !r) return null;
    to = sq(f, r);
    s = s.slice(2);
  }
  if (to == null) return null;
  // 駒名
  let type = null;
  for (const name of ['成香', '成桂', '成銀', ...Object.keys(NAME_TO_TYPE)]) {
    if (s.startsWith(name)) { type = NAME_TO_TYPE[name]; s = s.slice(name.length); break; }
  }
  if (!type) return null;
  let from = null;
  const fm = s.match(/\((\d)(\d)\)/);
  if (fm) { from = sq(Number(fm[1]), Number(fm[2])); s = s.replace(fm[0], ''); }
  const drop = s.includes('打');
  const noPromo = s.includes('不成');
  const promo = !noPromo && s.includes('成');
  const rel = s.replace(/不成|成|打/g, '');

  const legal = pos.legalMoves().filter((m) => m.to === to);
  if (drop) return legal.find((m) => m.drop === type) || null;
  if (from != null) {
    return legal.find((m) => !m.drop && m.from === from && !!m.promote === promo) || null;
  }
  // KI2: 駒の種類と相対表記で特定
  let cands = legal.filter((m) => !m.drop && typeOf(pos.board[m.from]) === type && !!m.promote === promo);
  if (!cands.length) {
    // 盤上に同種がなく持ち駒から打つ場合（KI2では打が省略される）
    return legal.find((m) => m.drop === type) || null;
  }
  if (cands.length > 1 && rel) {
    const exact = cands.filter((m) => moveToJa(pos, m, null, { mark: false }).endsWith(rel));
    if (exact.length) cands = exact;
  }
  return cands[0];
}

// 局面図（BOD）からSFENへ
function bodToSfen(bodLines, header) {
  const rows = [];
  for (const l of bodLines) {
    const m = l.match(/[|｜](.*)[|｜]/);
    if (!m) continue;
    const cells = [];
    const body = m[1];
    for (let i = 0; i + 1 < body.length + 1 && cells.length < 9; i += 2) {
      const side = body[i], name = body[i + 1];
      if (name === '・' || name === undefined) { cells.push(null); continue; }
      const t = NAME_TO_TYPE[name];
      if (!t) { cells.push(null); continue; }
      cells.push(side === 'v' ? t.toLowerCase() : t);
    }
    rows.push(cells);
  }
  if (rows.length !== 9) return STARTPOS;
  const board = rows.map((cells) => {
    let s = '', e = 0;
    for (const c of cells) {
      if (!c) { e++; continue; }
      if (e) { s += e; e = 0; }
      s += c;
    }
    if (e) s += e;
    return s;
  }).join('/');
  const hand = (val, upper) => {
    if (!val || val.startsWith('なし')) return '';
    let s = '';
    for (const part of val.split(/[\s　]+/).filter(Boolean)) {
      const name = part[0];
      const t = NAME_TO_TYPE[name];
      if (!t) continue;
      const num = part.slice(1).split('').reduce((a, ch) => {
        const map = { '十': 10, ...KAN_NUM };
        if (ch === '十') return (a || 1) * 10;
        return a + (map[ch] || 0);
      }, 0) || 1;
      s += (num > 1 ? num : '') + (upper ? t : t.toLowerCase());
    }
    return s;
  };
  const h = hand(header['先手の持駒'] || header['下手の持駒'], true) + hand(header['後手の持駒'] || header['上手の持駒'], false);
  const turn = header.__turn || (header['手合割'] && header['手合割'] !== '平手' ? 'w' : 'b');
  return `${board} ${turn} ${h || '-'} 1`;
}

// KIF 書き出し
export function toKif(startSfen, moves, header = {}, result = '', summary = '') {
  const out = ['# ---- shogi-app 棋譜ファイル ----'];
  const handicap = Object.keys(HANDICAP).find((k) => HANDICAP[k] === startSfen);
  for (const k of ['開始日時', '棋戦', '先手', '後手']) if (header[k]) out.push(`${k}：${header[k]}`);
  if (handicap) out.push(`手合割：${handicap}`);
  else out.push(`手合割：平手`, `SFEN：${startSfen}`);
  out.push('手数----指手---------消費時間--');
  const pos = new Position(startSfen);
  let prevTo = null;
  moves.forEach((m, i) => {
    const s = moveToJa(pos, m.move, prevTo, { mark: false, kifFrom: true });
    out.push(`${String(i + 1).padStart(4)} ${s}`);
    if (m.comment) for (const c of m.comment.split('\n')) out.push('*' + c);
    pos.applyMove(m.move);
    prevTo = m.move.to;
  });
  if (result) out.push(`${String(moves.length + 1).padStart(4)} ${result}`);
  if (summary) out.push(summary);
  return out.join('\n') + '\n';
}
