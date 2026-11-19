// 指し手の読み上げ（ブラウザの音声合成を使う）
import { SENTE, moveToJa, fileOf, rankOf, typeOf } from './shogi.js';
import { audio } from './sound.js';

// 将棋の符号の読み方: 2は「にい」、5は「ごお」と伸ばす
const NUM = { '１': 'いち', '２': 'にい', '３': 'さん', '４': 'よん', '５': 'ごお', '６': 'ろく', '７': 'なな', '８': 'はち', '９': 'きゅう' };
const KAN = { '一': 'いち', '二': 'にい', '三': 'さん', '四': 'よん', '五': 'ごお', '六': 'ろく', '七': 'なな', '八': 'はち', '九': 'きゅう' };
// 長いものから順に置き換える
const WORDS = [
  ['成香', 'なりきょう'], ['成桂', 'なりけい'], ['成銀', 'なりぎん'], ['不成', 'ならず'],
  ['同　', 'どう '], ['同', 'どう '],
  ['歩', 'ふ'], ['香', 'きょう'], ['桂', 'けい'], ['銀', 'ぎん'], ['金', 'きん'], ['角', 'かく'], ['飛', 'ひしゃ'],
  ['玉', 'ぎょく'], ['王', 'おう'], ['と', 'と'], ['馬', 'うま'], ['龍', 'りゅう'], ['竜', 'りゅう'],
  ['成', 'なり'], ['打', 'うつ'], ['右', 'みぎ'], ['左', 'ひだり'], ['上', 'あがる'], ['引', 'ひく'], ['寄', 'よる'], ['直', 'すぐ'],
];

// style: 'kana' は「ななはちきん」のようにひらがなを続けて書く（音声が1語として抑揚をつける）
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

export const speechSupported = () => typeof self !== 'undefined' && 'speechSynthesis' in self;

let voice = null;
function pickVoice() {
  if (!speechSupported()) return null;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === 'ja-JP' && /Google|Kyoko|O-ren|Otoya/.test(v.name)) || vs.find((v) => v.lang && v.lang.startsWith('ja')) || null;
  return voice;
}
if (typeof self !== 'undefined' && 'speechSynthesis' in self) {
  pickVoice();
  speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pickVoice);
}


export function speak(text) {
  if (!speechSupported()) return;
  // 読み上げが追いつかないときは、古いものを捨てて新しい手を読む
  if (speechSynthesis.pending || speechSynthesis.speaking) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (voice || pickVoice()) u.voice = voice;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ---- アクセントを調整した音声（Open JTalk と HTS Voice「Mei」で前もって作った音をつなぐ） ----
// 座標は「ななは↘ち」のように3モーラ目のあとで下がる1語、駒の名前などは別の句で平らに読む
let sprite = null, spriteLoading = null;
export function loadVoice() {
  if (spriteLoading) return spriteLoading;
  spriteLoading = (async () => {
    const ac = audio();
    if (!ac) throw new Error('音声を再生できません');
    const [meta, buf] = await Promise.all([
      fetch('voice/sprite.json').then((r) => r.json()),
      fetch('voice/sprite.mp3').then((r) => r.arrayBuffer()),
    ]);
    const data = await new Promise((res, rej) => ac.decodeAudioData(buf, res, rej));
    sprite = { meta, data };
    return sprite;
  })().catch((e) => { spriteLoading = null; throw e; });
  return spriteLoading;
}

const SUFFIX = { '成': 'nari', '不成': 'narazu', '打': 'utsu', '右': 'migi', '左': 'hidari', '上': 'agaru', '引': 'hiku', '寄': 'yoru', '直': 'sugu' };

// 指し手を音のかけら（キー）の並びにする
export function moveClips(pos, mv, prevTo) {
  const keys = [pos.turn === SENTE ? 'sente' : 'gote'];
  keys.push(prevTo === mv.to ? 'dou' : `${fileOf(mv.to)}${rankOf(mv.to)}`);
  const ja = moveToJa(pos, mv, prevTo, { mark: false });
  if (mv.drop) {
    keys.push(mv.drop, 'utsu');
    return keys;
  }
  keys.push(typeOf(pos.board[mv.from]));
  // 駒の名前より後ろ（成・不成・右・上など）
  let rest = ja.replace(/^(同　|[１-９][一二三四五六七八九])/, '').replace(/^(成香|成桂|成銀|[歩香桂銀金角飛玉王と馬龍竜])/, '');
  while (rest.length) {
    if (rest.startsWith('不成')) { keys.push('narazu'); rest = rest.slice(2); continue; }
    const k = SUFFIX[rest[0]];
    if (k) keys.push(k);
    rest = rest.slice(1);
  }
  return keys;
}

let playingUntil = 0;
export function playClips(keys) {
  const ac = audio();
  if (!ac || !sprite) return false;
  const { clips } = sprite.meta;
  let t = Math.max(ac.currentTime + 0.03, playingUntil);
  keys.forEach((k, i) => {
    const c = clips[k];
    if (!c) return;
    const src = ac.createBufferSource();
    src.buffer = sprite.data;
    const g = ac.createGain();
    g.gain.value = 1.4;
    src.connect(g).connect(ac.destination);
    // 圧縮で前後にずれることがあるので、少し広めに切り出す
    const start = Math.max(0, c[0] - 0.02), dur = c[1] + 0.04;
    src.start(t, start, dur);
    t += dur + (i === 0 ? 0.08 : 0.0);
  });
  playingUntil = t + 0.05;
  return true;
}
