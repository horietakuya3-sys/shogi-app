# 読み上げ音声（sprite.mp3 / sprite.json）

指し手の読み上げに使う音のかけら（先手・後手、81の座標、駒の名前、成・不成・打・同・右左上引寄直）を1つのファイルにまとめたものです。
tools/build_sprite.py で、Open JTalk（pyopenjtalk）と HTS Voice「Mei」から作りました。

- 座標は4モーラの1語として、3モーラ目のあとで音が下がるように作っています（例: ななは↘ち、さんよ↘ん、いちに↘い）
- 駒の名前などは別の句として平らに読みます
- 音声: HTS Voice "Mei" released by MMDAgent Project Team, Copyright (c) 2009-2013 Nagoya Institute of Technology, Department of Computer Science. Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/)
- 合成: Open JTalk（Modified BSD License）/ pyopenjtalk（MIT License）
