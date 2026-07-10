# /programs/ — 202612 プログラムカード用 画像

`/202612orisen/` のプログラムカードで使う 16:9 画像を、ここに置いてください。

## ファイル名（プログラムごと）

`src/pages/202612orisen/index.astro` の `programs` 配列の `code` に、拡張子 `.jpg` を付けたもの。

| code | ファイル名 | プログラム |
|---|---|---|
| panshoku      | panshoku.jpg      | スポあんぱん食い競走 |
| kakekko       | kakekko.jpg       | かけっこ教室 |
| music-dribble | music-dribble.jpg | ミュージックドリブル |
| soccer        | soccer.jpg        | サッカー教室 |
| baseball5     | baseball5.jpg     | Baseball5 体験 |
| legit         | legit.jpg         | Legit ダンス |
| sunrockers    | sunrockers.jpg    | サンロッカーズ渋谷 バスケ |
| 3x3           | 3x3.jpg           | 3x3 バスケ |
| dip           | dip.jpg           | Dip Battles |
| judo          | judo.jpg          | 柔道体験 |
| fencing       | fencing.jpg       | フェンシング体験 |
| ycap          | ycap.jpg          | YCAP チームビルディング |
| parkour       | parkour.jpg       | パルクール |
| rec-bousai    | rec-bousai.jpg    | レク協会 ／ 防災スポーツ |
| boccia        | boccia.jpg        | ボッチャ |
| shogi         | shogi.jpg         | 将棋 ／ カードゲーム |
| esports       | esports.jpg       | eスポーツ ／ 雀魂 |
| radio         | radio.jpg         | 渋谷のラジオ 公開収録 |

## 画像仕様

- **アスペクト比**: 16:9（推奨サイズ 1280 × 720 または 1920 × 1080）
- **形式**: JPEG（`.jpg`）
- **容量目安**: 1ファイル 200KB 前後（大きすぎる場合は圧縮）
- **明るめの構図** を推奨（カード左上に日付バッジが乗るため、その辺りに文字が入る画像は避ける）

## 画像が無い間の見え方

画像ファイルが未配置の間は、`programs` 配列の `theme` プロパティに応じたカラーグラデーションのプレースホルダーが表示されます（`navy` / `orange` / `green` / `pink` / `purple` / `yellow` / `blue`）。

## 配置手順

1. 上記のファイル名でこのフォルダに `.jpg` を保存
2. `git add public/programs/*.jpg && git commit -m "assets: 202612 プログラム画像を配置"`
3. push → Cloudflare Pages が自動デプロイ、カードに画像が反映
