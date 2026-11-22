// 指し手の読み上げ
// 1. 四国めたん（VOICEVOX）で前もって作った音声（voice/metan/）。一手ぶん（座標＋駒＋成・不成・打）を丸ごと1つの音にしてある
// 2. 端末の音声合成（音声をまだ読み込めていないとき、または「端末の音声」を選んだとき）
import { SENTE, moveToJa, fileOf, rankOf, PIECE_NAME } from './shogi.js';
import { audio } from './sound.js';

// ---- 端末の音声合成 ----
// 将棋の符号の読み方: 2は「ニー」、5は「ゴー」と伸ばす
// 座標はカタカナにする（ひらがなの「は」は助詞の「わ」と読まれ、「ごおにい」は不自然に読まれるため）
const NUM = { '１': 'イチ', '２': 'ニー', '３': 'サン', '４': 'ヨン', '５': 'ゴー', '６': 'ロク', '７': 'ナナ', '８': 'ハチ', '９': 'キュー' };
const KAN = { '一': 'イチ', '二': 'ニー', '三': 'サン', '四': 'ヨン', '五': 'ゴー', '六': 'ロク', '七': 'ナナ', '八': 'ハチ', '九': 'キュー' };
// 長いものから順に置き換える
const WORDS = [
  ['成香', 'なりきょう'], ['成桂', 'なりけい'], ['成銀', 'なりぎん'], ['不成', 'ならず'],
  ['同　', 'どう '], ['同', 'どう '],
  ['歩', 'ふ'], ['香', 'きょう'], ['桂', 'けい'], ['銀', 'ぎん'], ['金', 'きん'], ['角', 'かく'], ['飛', 'ひしゃ'],
  ['玉', 'ぎょく'], ['王', 'おう'], ['と', 'と'], ['馬', 'うま'], ['龍', 'りゅう'], ['竜', 'りゅう'],
  ['成', 'なり'], ['打', 'うつ'], ['右', 'みぎ'], ['左', 'ひだり'], ['上', 'あがる'], ['引', 'ひく'], ['寄', 'よる'], ['直', 'すぐ'],
];

// style: 'kana' は「ナナハチきん」のようにひらがなを続けて書く（音声が1語として抑揚をつける）
//        'kanji' は「７八金」のように符号のまま渡す（音声の辞書の読み方に任せる）
export function moveReading(pos, mv, prevTo, style = 'kana') {
  const side = pos.turn === SENTE ? 'せんて' : 'ごて';
  let s = moveToJa(pos, mv, prevTo, { mark: false });
  if (style === 'kanji') return `${side}、${s.replace(/　/g, '')}`;
  let out = '';
  if (NUM[s[0]] && KAN[s[1]]) { out += NUM[s[0]] + KAN[s[1]]; s = s.slice(2); }
  while (s.length) {
    const w = WORDS.find(([k]) => s.startsWith(k));
    if (w) { out += w[1]; s = s.slice(w[0].length); } else { out += s[0]; s = s.slice(1); }
  }
  // 区切りの空白は入れず、1つの言葉として読ませる
  return `${side}、${out.replace(/\s+/g, '')}`;
}

export const deviceSpeechSupported = () => typeof self !== 'undefined' && 'speechSynthesis' in self;
const webAudioSupported = () => typeof self !== 'undefined' && !!(self.AudioContext || self.webkitAudioContext);
// 読み上げの設定を出せるか（どちらかの方法で声を出せる）
export const speechSupported = () => deviceSpeechSupported() || webAudioSupported();

let voice = null;
function pickVoice() {
  if (!deviceSpeechSupported()) return null;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === 'ja-JP' && /Google|Kyoko|O-ren|Otoya/.test(v.name)) || vs.find((v) => v.lang && v.lang.startsWith('ja')) || null;
  return voice;
}
if (deviceSpeechSupported()) {
  pickVoice();
  speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

// 端末の音声で読み、読み終わったら解決する
function deviceSay(text) {
  return new Promise((res) => {
    if (!deviceSpeechSupported()) { res(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (voice || pickVoice()) u.voice = voice;
    u.rate = 1.05;
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    u.onend = fin;
    u.onerror = fin;
    setTimeout(fin, 1500 + text.length * 250); // onend が来ない端末のため
    speechSynthesis.speak(u);
  });
}

// ---- 読み上げの順番待ち ----
// 読み上げの途中で次の手が指されても切らずに、順に読む。
// ただし、まだ読んでいない手が3手以上たまったら、古い手を飛ばして新しい2手だけ残す
const MAX_WAITING_MOVES = 2;
const READ_GAP = 0.25; // 続けて読むときの、前の読み上げとの間（秒）
const waiting = []; // { kind: 'move' | 'clock' | 'end', play: () => Promise }
let reading = false;
function enqueue(kind, play) {
  if (kind === 'move') {
    const ms = waiting.filter((x) => x.kind === 'move');
    while (ms.length >= MAX_WAITING_MOVES) waiting.splice(waiting.indexOf(ms.shift()), 1);
  }
  waiting.push({ kind, play });
  pump();
}
async function pump() {
  if (reading) return;
  const it = waiting.shift();
  if (!it) return;
  reading = true;
  try { await it.play(); } catch { /* 次へ */ }
  if (waiting.length) await new Promise((r) => setTimeout(r, READ_GAP * 1000));
  reading = false;
  pump();
}
export const speak = (text) => enqueue('end', () => deviceSay(text));

// いま何かを読み上げているか、読み上げ待ちがあるか
export const speaking = () => reading || waiting.length > 0;

// ---- 前もって作った音声 ----
export const VOICES = {
  metan: { name: '四国めたん', credit: 'VOICEVOX:四国めたん', dir: 'voice/metan/', sizeMB: 16 },
};
let voiceName = 'metan'; // 'metan' または 'device'
export function setVoice(name) { voiceName = VOICES[name] ? name : 'device'; }

const pack = { name: '', index: null, buf: null, loading: null, failed: false };
const decoded = new Map(); // キー → AudioBuffer

// 音声を読み込む（初回は約16MB。Service Worker がキャッシュするので2回目からはネットなしで使える）
// onStart は実際にネットから取ってくるときだけ呼ぶ
export function loadVoice(onStart) {
  const v = VOICES[voiceName];
  if (!v || !webAudioSupported()) return Promise.resolve(false);
  if (pack.name === voiceName && pack.buf) return Promise.resolve(true);
  if (pack.name === voiceName && pack.loading) return pack.loading;
  pack.name = voiceName; pack.index = null; pack.buf = null; pack.failed = false;
  decoded.clear();
  pack.loading = (async () => {
    try {
      const cached = typeof caches !== 'undefined' && await caches.match(v.dir + 'pack.bin', { ignoreSearch: true }).catch(() => null);
      if (!cached && onStart) onStart(v);
      const [ix, bin] = await Promise.all([
        fetch(v.dir + 'index.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch(v.dir + 'pack.bin').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
      ]);
      if (pack.name !== voiceName) return false;
      pack.index = ix.clips; pack.buf = bin;
      return true;
    } catch {
      pack.failed = true;
      return false;
    } finally {
      pack.loading = null;
    }
  })();
  return pack.loading;
}
export const voiceReady = () => VOICES[voiceName] && pack.name === voiceName && !!pack.buf;

async function clip(key) {
  if (decoded.has(key)) return decoded.get(key);
  const e = pack.index && pack.index[key];
  const ac = audio();
  if (!e || !ac) return null;
  const data = pack.buf.slice(e[0], e[0] + e[1]);
  const b = await new Promise((res, rej) => {
    const p = ac.decodeAudioData(data, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  if (decoded.size > 300) decoded.delete(decoded.keys().next().value);
  decoded.set(key, b);
  return b;
}

// parts: [[キー, 前の間（秒。負なら前の音に少し重ねる）], ...]。鳴らし終わったら true、音がそろわなければ false
async function playClipsNow(parts) {
  let bufs;
  try { bufs = await Promise.all(parts.map(([k]) => clip(k))); } catch { return false; }
  if (bufs.some((b) => !b)) return false;
  const ac = audio();
  const t0 = ac.currentTime + 0.03;
  let t = t0;
  bufs.forEach((b, i) => {
    t = Math.max(ac.currentTime + 0.03, t + parts[i][1]);
    const src = ac.createBufferSource();
    src.buffer = b;
    src.connect(ac.destination);
    src.start(t);
    t += b.duration;
  });
  await new Promise((r) => setTimeout(r, (t - ac.currentTime) * 1000 + 30));
  return true;
}

// 前もって作った音声で読む。音がそろわなければ端末の音声で
const clipsOr = (parts, text) => async () => { if (!(await playClipsNow(parts))) await deviceSay(text); };

const usePack = () => voiceName !== 'device' && voiceReady();
const SIDE_GAP = 0.12; // 「せんて」のあとの間
const JOIN = -0.07; // 駒の名前と「みぎ」などをつなぐとき（前の音の終わりの無音に少し重ねる）

const CODE_OF = Object.fromEntries(Object.entries(PIECE_NAME).map(([k, v]) => [v, k]));
const NAMES = Object.values(PIECE_NAME).sort((a, b) => b.length - a.length);

// 指し手を音のキーの並びにする
export function moveClips(pos, mv, prevTo) {
  let s = moveToJa(pos, mv, prevTo, { mark: false });
  let dest;
  if (s.startsWith('同')) { dest = 'do'; s = s.replace(/^同　?/, ''); } else { dest = `${fileOf(mv.to)}${rankOf(mv.to)}`; s = s.slice(2); }
  const nm = NAMES.find((n) => s.startsWith(n));
  if (!nm) return null;
  const p = CODE_OF[nm];
  s = s.slice(nm.length);
  let pr = '';
  for (const w of ['打', '不成', '成']) if (s.startsWith(w)) { pr = w; s = s.slice(w.length); break; }
  const side = ['side|' + (pos.turn === SENTE ? 0 : 1), 0];
  if (!s) return [side, [`${dest}|${p}||${pr}`, SIDE_GAP]];
  // 右・左・上・引・寄・直がつく手は、駒までの音に「みぎなり」などの音をつなぐ
  return [side, [`${dest}|${p}||`, SIDE_GAP], [`suf|${s}|${pr}`, JOIN]];
}

export function speakMove(pos, mv, prevTo, style = 'kana') {
  if (usePack()) {
    const parts = moveClips(pos, mv, prevTo);
    if (parts) { enqueue('move', clipsOr(parts, moveReading(pos, mv, prevTo, style))); return; }
  }
  const text = moveReading(pos, mv, prevTo, style);
  enqueue('move', () => deviceSay(text));
}

// dropIfBusy: 読み上げ中なら読まない（秒読みの数字は遅れて読むと意味がないので）
export function speakClock(sec, text, { dropIfBusy = false } = {}) {
  if (dropIfBusy && speaking()) return;
  if (usePack() && pack.index[`clk|${sec}`]) {
    enqueue('clock', clipsOr([[`clk|${sec}`, 0]], text));
    return;
  }
  enqueue('clock', () => deviceSay(text));
}

// 中断：「中断しました」。四国めたんの音声には「中断」だけがあるので、その声で読む
export function speakInterrupt() {
  if (usePack() && pack.index['end|中断']) { enqueue('end', clipsOr([['end|中断', 0]], '中断しました')); return; }
  speak('中断しました');
}

// 終局: 「つみ。まで85手で先手の勝ち」
// tail は「先手の勝ち」「後手の勝ち」「千日手」「持将棋」「中断」
export function speakEnd(word, n, tail, text) {
  const parts = [[`end|${word}`, 0], [`made|${n}`, 0.15], [`tail|${tail}`, -0.04]];
  if (usePack() && parts.every(([k]) => pack.index[k])) {
    enqueue('end', clipsOr(parts, text));
    return;
  }
  speak(text);
}
