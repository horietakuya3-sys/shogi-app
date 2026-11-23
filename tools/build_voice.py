# VOICEVOX の声（四国めたん・春日部つむぎなど）で将棋の読み上げ音声を前もって作り、1つのファイルにまとめる
# 使い方: python3 tools/build_voice.py <出力先> 0 <style id> <クレジット>  例: 四国めたん 2 "VOICEVOX:四国めたん"、春日部つむぎ 8 "VOICEVOX:春日部つむぎ"（VOICEVOX CORE 0.16 の Python 版、ONNX Runtime、0.vvm、Open JTalk 辞書を D に置く）
# 出力: OUT/pack.bin（MP3を並べたもの）と OUT/index.json（キー → [開始, 長さ]）
import json, os, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

D = "/home/claude/vv/dl"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/vv/pack"
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 0
SID = int(sys.argv[3]) if len(sys.argv) > 3 else 2  # 2: 四国めたん ノーマル、8: 春日部つむぎ ノーマル
CREDIT = sys.argv[4] if len(sys.argv) > 4 else "VOICEVOX:四国めたん"
os.makedirs(OUT, exist_ok=True)

ort = Onnxruntime.load_once(filename=f"{D}/voicevox_onnxruntime-linux-x64-1.17.3/lib/libvoicevox_onnxruntime.so.1.17.3")
syn = Synthesizer(ort, OpenJtalk(f"{D}/open_jtalk_dic_utf_8-1.11"), cpu_num_threads=2)
with VoiceModelFile.open(f"{D}/0.vvm") as m:
    syn.load_voice_model(m)

NUM = {1: "イチ", 2: "ニイ", 3: "サン", 4: "ヨン", 5: "ゴオ", 6: "ロク", 7: "ナナ", 8: "ハチ", 9: "キュウ"}
PIECE = {"P": "フ", "L": "キョウ", "N": "ケイ", "S": "ギン", "G": "キン", "B": "カク", "R": "ヒシャ", "K": "ギョク",
         "+P": "ト", "+L": "ナリキョウ", "+N": "ナリケイ", "+S": "ナリギン", "+B": "ウマ", "+R": "リュウ"}
PROMOTABLE = ["P", "L", "N", "S", "B", "R"]
DROPPABLE = ["P", "L", "N", "S", "G", "B", "R"]
PR = {"": "", "成": "ナリ", "不成": "ナラズ", "打": "ウツ"}
SUF = {"右": "ミギ", "左": "ヒダリ", "直": "スグ", "上": "アガル", "引": "ヒク", "寄": "ヨル"}
GOLD_SUF = ["右", "左", "直", "上", "引", "寄", "右上", "右引", "右寄", "左上", "左引", "左寄"]
SILVER_SUF = ["右", "左", "直", "上", "引", "右上", "右引", "左上", "左引"]
ALL_SUF = GOLD_SUF


def suf_kana(s):
    return "".join(SUF[c] for c in s)


def coord_kana(f, r):
    a, b = NUM[f], NUM[r]
    # 4モーラの1語で、3モーラ目のあとで下がる（ななは↘ち）。キュウは「キュ」「ウ」の2モーラ
    return a + b[:-1] + "'" + b[-1] if not b.endswith("ュウ") else a + b[:-1] + "'" + b[-1]


def flat(k):
    # 平板: 最後のモーラにアクセント記号を置く
    return k + "'"


items = []  # (key, kind, data)
dests = [(f, r) for f in range(1, 10) for r in range(1, 10)]
# 1. 指し手（座標＋駒＋成・不成・打）。打は駒の名前のあとに「うつ」
for f, r in dests:
    ck = coord_kana(f, r)
    for p in PIECE:
        prs = [""] + (["成", "不成"] if p in PROMOTABLE else []) + (["打"] if p in DROPPABLE else [])
        for pr in prs:
            items.append((f"{f}{r}|{p}||{pr}", "kana", f"{ck}/{flat(PIECE[p] + PR[pr])}"))
# 2. 同
for p in PIECE:
    prs = [""] + (["成", "不成"] if p in PROMOTABLE else [])
    for pr in prs:
        items.append((f"do|{p}||{pr}", "kana", f"ドウ'/{flat(PIECE[p] + PR[pr])}"))
# 3. 区別の言葉（丸ごと作っていない手で、駒の名前のあとにつなぐ）
for s in ALL_SUF:
    for pr in ["", "成", "不成"]:
        items.append((f"suf|{s}|{pr}", "kana", flat(suf_kana(s) + PR[pr])))
# 4. 手番
items.append(("side|0", "kana", "センテ'"))
items.append(("side|1", "kana", "ゴテ'"))
# 5. 残り時間
CLOCK = {600: "10分", 540: "9分", 480: "8分", 420: "7分", 360: "6分", 300: "5分", 240: "4分", 180: "3分",
         150: "2分30秒", 120: "2分", 90: "1分30秒", 60: "1分", 30: "30秒", 20: "20秒", 10: "10秒"}
for sec, t in CLOCK.items():
    items.append((f"clk|{sec}", "text", t))
for sec in range(1, 10):
    items.append((f"clk|{sec}", "kana", flat(NUM[sec])))
# 6. 終局
for w, t in {"詰み": "つみ", "投了": "投了", "千日手": "千日手", "持将棋": "持将棋", "切れ負け": "切れ負け",
             "入玉勝ち": "入玉勝ち", "中断": "中断"}.items():
    items.append((f"end|{w}", "text", t + "。"))
for n in range(1, 401):
    items.append((f"made|{n}", "text", f"まで{n}手で"))
for t in ["先手の勝ち", "後手の勝ち", "千日手", "持将棋", "中断"]:
    items.append((f"tail|{t}", "text", t))

keys = [k for k, _, _ in items]
assert len(keys) == len(set(keys)), "キーの重複"
if LIMIT:
    items = items[:LIMIT]
print("clips:", len(items), flush=True)


def synth(kind, data):
    q = syn.create_audio_query_from_kana(data, SID) if kind == "kana" else syn.create_audio_query(data, SID)
    q.pre_phoneme_length = 0.05
    q.post_phoneme_length = 0.08
    return syn.synthesis(q, SID)


tmp = tempfile.mkdtemp()


def encode(i, wav):
    w = f"{tmp}/{i}.wav"; o = f"{tmp}/{i}.mp3"
    open(w, "wb").write(wav)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", w, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame",
                    "-b:a", "32k", "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", o], check=True)
    os.remove(w)
    return o


t0 = time.time()
index = {}
pool = ThreadPoolExecutor(1)
futs = []
for i, (k, kind, data) in enumerate(items):
    wav = synth(kind, data)
    futs.append((k, pool.submit(encode, i, wav)))
    if i % 500 == 0:
        print(i, k, round(time.time() - t0), "s", flush=True)
with open(f"{OUT}/pack.bin", "wb") as fo:
    pos = 0
    for k, fu in futs:
        b = open(fu.result(), "rb").read()
        fo.write(b)
        index[k] = [pos, len(b)]
        pos += len(b)
json.dump({"voice": CREDIT, "format": "mp3", "clips": index}, open(f"{OUT}/index.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("done", len(index), pos, "bytes", round(time.time() - t0), "s")
