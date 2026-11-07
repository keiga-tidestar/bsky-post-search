# 投稿検索フォーム

投稿者・キーワード・期間を入力すると、Blueskyの検索画面（bsky.app）を新しいタブで開くツール。

- 結果はこのページに表示せず、bsky.app の検索画面を開くだけ
- Bluesky APIとログイン処理は使わない。検索結果を見るには bsky.app へのログインが必要
- 広告、アクセス解析、外部スクリプトは入れていない

## 使い方

`index.html` をブラウザで直接開くだけで動作する。サーバー・インストール不要。

`index.html?handle=alice.bsky.social` のように `handle` を付けて開くと、投稿者欄にその値が入った状態で始まる。

## 生成する検索URL

```
https://bsky.app/search?q=<クエリ>&tab=latest
```

クエリは `<キーワード> from:<ハンドル> since:<開始> until:<終了> lang:<言語>` の順に、値のある項目だけをつなげる。言語は「指定なし・日本語（`ja`）・英語（`en`）」から選ぶ。期間は日本時間の日付をUTCに直す。

- `since`：開始日の0時（JST）
- `until`：終了日の翌日0時（JST）。`until` は指定時刻を含まないため

例：投稿者 `alice.bsky.social`、キーワード `pauper`、期間 2026-11-01〜2026-11-03

```
pauper from:alice.bsky.social since:2026-10-31T15:00:00Z until:2026-11-03T15:00:00Z
```

## ファイル構成

```
index.html          エントリポイント
css/
  style.css         スタイル（レスポンシブ・ダークモード対応）
js/
  script.js         URL生成ロジック・画面の更新
test/
  script.test.js    URL生成ロジックのテスト
```

## テスト

Node標準のテストランナーで、`js/script.js` のURL生成とハンドル整形をテストする。

```
node --test
```
