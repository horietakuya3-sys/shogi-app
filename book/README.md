# 定跡データ（book.txt）

やねうら王の「新ペタショック定跡 233万局面」（new_petabook_20250505c、作者 やねうらお 氏、MIT License）から、平手の初形から辿れる序盤（26手目まで）の局面だけを取り出し、このアプリ用に小さくしたものです。

- 入手元: https://github.com/yaneurao/YaneuraOu/releases/tag/new_petabook233
- 取り出し方: 8手目までは定跡にあるすべての手、それ以降は最善手から評価値150以内の上位4手を辿る
- 各手には、その先の手順で先手・後手がどの戦法になるか（四間飛車、角換わりなど）の印をつけています
- 形式: 1行目はJSONのヘッダ。2行目以降は「局面SFENのハッシュ（cyrb53, 36進）<TAB>手:評価値:先手の戦法印:後手の戦法印 …」

元データのライセンス（MIT License）:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## shape1.txt（形の定跡）

同じ新ペタショック定跡から作った、自分の駒の配置だけで引く表です。相手が定跡を外れても、自分の駒の形が定跡に出てきた形と同じなら、そこで指された駒組みの手（駒を取る手・打つ手を除く）を候補にします。`node tools/build_book.mjs <user_book1.db> <book.txt> 28 200 6 8 <shape1.txt>` で作ります。
