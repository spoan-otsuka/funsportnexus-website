# fun sport nexus 公式サイト

「明るく、楽しく、人と人をつなぐ」 ── fun sport nexus の公式サイト。

公開URL（予定）：**https://funsportnexus.org/**
公開目標：2026年9月

## アーキテクチャ

```
[訪問者]
    ↓ HTTPS
[Cloudflare Pages]  funsportnexus.org
    ├ Astro（SSG + サーバーレス）
    └ Pages Functions
         ├ GET  /api/slots    プログラム枠＋残席
         ├ POST /api/apply    申込受付
         └ /api/admin/*       管理API（Phase 3〜4）
              ↓
    [Cloudflare D1]   申込管理（既存 fsn-apply-db を流用）
    [Resend API]      自動返信メール
    [Slack Webhook]   事務局通知（軍神提案）

[microCMS]            お知らせ・コラム・実績・パートナー情報
   ↓ APIで読込
[Astro SSG]           ビルド時にコンテンツ取得→静的化
```

## 移行元との関係

| 旧 | 新 |
|---|---|
| funsportnexus.org（WordPress on Xserver）| funsportnexus.org（Astro on Cloudflare Pages）|
| /202612orisen/（WPの page-content）| /202612orisen/（Astro pages）|
| apply.funsportnexus.org（Cloudflare Worker）| funsportnexus.org/apply/（統合）|
| WP投稿（お知らせ・コラム）| microCMS |
| WPメディア | Cloudflare R2 |

## ディレクトリ構成

```
/
├ src/
│  ├ pages/              Astro ページ（ファイルベースルーティング）
│  ├ layouts/            BaseLayout, etc.
│  ├ components/         再利用コンポーネント
│  └ styles/             global.css（デザイントークン）
├ public/                静的アセット
├ functions/             Cloudflare Pages Functions
│  └ api/
│     ├ slots.js         GET スロット一覧
│     ├ apply.js         POST 申込受付（Phase 3 実装）
│     └ admin/           管理API（Phase 4 実装）
├ db/
│  ├ schema.sql          D1 スキーマ
│  └ seed.sql            初期データ（26スロット）
├ astro.config.mjs       Astro 設定（@astrojs/cloudflare adapter）
├ wrangler.toml          Cloudflare 設定（D1 binding + 環境変数）
└ README.md
```

## 開発

### セットアップ

```bash
npm install
```

### ローカル開発

```bash
npm run dev          # Astro dev サーバー
npm run preview      # wrangler pages dev（Functions込み）
```

### 本番デプロイ

```bash
npm run build        # Astro ビルド
npm run deploy       # Cloudflare Pages デプロイ
```

## 移行ステップ（軍神 implementation_plan.md ベース）

- [x] Step 1-A: 環境構築（adapter / wrangler / db / functions 雛形）
- [ ] Step 1-B: 申込システム統合（apply.funsportnexus.org の機能を統合）
- [ ] Step 1-C: GitHub 連携 + Cloudflare Pages デプロイ
- [ ] Step 2-A: 共通レイアウト / デザイントークン
- [ ] Step 2-B: 202612orisen 特設サイト（4ページ）Astro 化
- [ ] Step 3: microCMS 連携 / 既存WP記事移行
- [ ] Step 4: DNS 切替 / 旧WP廃止

## ライセンス

© 公益財団法人 スポーツ安全協会
