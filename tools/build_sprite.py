# 読み上げ用の音声をまとめて作る（Open JTalk + HTS Voice「Mei」）
# 座標は4モーラの1語で、3モーラ目のあとで下がる（例: ななは↘ち）。駒の名前などは別の句で平らに読む
import json, numpy as np, soundfile as sf, subprocess
from synth import word
import pyopenjtalk

NUM = {1: 'イチ', 2: 'ニイ', 3: 'サン', 4: 'ヨン', 5: 'ゴオ', 6: 'ロク', 7: 'ナナ', 8: 'ハチ', 9: 'キュウ'}
clips = {}
def make(key, words, speed=1.05):
    labels = pyopenjtalk.make_label(words)
    x = pyopenjtalk.synthesize(labels, speed=speed)
    x, sr = x if isinstance(x, tuple) else (x, 48000)
    x = x.astype('float32') / 32768.0
    # 前後の無音を切る
    th = 0.01 * np.max(np.abs(x))
    idx = np.where(np.abs(x) > th)[0]
    x = x[max(0, idx[0] - int(0.01 * sr)): idx[-1] + int(0.03 * sr)]
    clips[key] = (x, sr)

make('sente', [word('センテ', 1, -1)])
make('gote', [word('ゴテ', 1, -1)])
for f in range(1, 10):
    for r in range(1, 10):
        kana = NUM[f] + NUM[r]
        make(f'{f}{r}', [word(kana, 3, -1)])
for key, kana in [('dou', 'ドウ'), ('P', 'フ'), ('L', 'キョウ'), ('N', 'ケイ'), ('S', 'ギン'), ('G', 'キン'), ('B', 'カク'), ('R', 'ヒシャ'),
                  ('K', 'ギョク'), ('+P', 'ト'), ('+L', 'ナリキョウ'), ('+N', 'ナリケイ'), ('+S', 'ナリギン'), ('+B', 'ウマ'), ('+R', 'リュウ'),
                  ('nari', 'ナリ'), ('narazu', 'ナラズ'), ('utsu', 'ウツ'), ('migi', 'ミギ'), ('hidari', 'ヒダリ'), ('agaru', 'アガル'),
                  ('hiku', 'ヒク'), ('yoru', 'ヨル'), ('sugu', 'スグ')]:
    make(key, [word(kana, 0, -1)])

sr = 48000
gap = np.zeros(int(0.12 * sr), dtype='float32')
parts, offsets, t = [], {}, 0.0
for k, (x, s) in clips.items():
    assert s == sr
    offsets[k] = [round(t, 4), round(len(x) / sr, 4)]
    parts += [x, gap]
    t += (len(x) + len(gap)) / sr
sf.write('sprite.wav', np.concatenate(parts), sr)
json.dump({'voice': 'HTS Voice Mei (CC BY 3.0) / Open JTalk', 'clips': offsets}, open('sprite.json', 'w'), ensure_ascii=False)
print(len(clips), 'clips', round(t, 1), 'sec')
