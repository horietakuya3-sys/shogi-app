import pyopenjtalk, numpy as np, copy, sys
T = pyopenjtalk.run_frontend('テスト')[0]
def word(kana, acc, chain=0):
    w = copy.deepcopy(T)
    w.update({'string': kana, 'read': kana, 'pron': kana, 'acc': acc, 'mora_size': len([c for c in kana if c not in 'ャュョァィゥェォ']), 'chain_flag': chain,
              'pos': '名詞', 'pos_group1': '一般', 'pos_group2': '*', 'pos_group3': '*', 'ctype': '*', 'cform': '*', 'orig': kana, 'chain_rule': '*'})
    return w
def synth(words, path, speed=1.0):
    labels = pyopenjtalk.make_label(words)
    x = pyopenjtalk.synthesize(labels, speed=speed)
    x, sr = x if isinstance(x, tuple) else (x, 48000)
    import soundfile as sf
    sf.write(path, (x/32768.0).astype('float32'), sr)
if __name__ == '__main__':
    print(T.keys())
    synth([word('センテ',1,-1), word('ナナハチ',3,0), word('キン',0,0)], 'test1.wav')
    synth([word('ゴテ',1,-1), word('サンヨン',3,0), word('ヒシャ',0,0)], 'test2.wav')
