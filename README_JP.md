# X Autopost テクニカルドキュメント

## 1. プロジェクト概要

X Autopost は、Google Apps Script と TypeScript を使用して構築された X (旧 Twitter) への自動投稿システムです。Google スプレッドシートをデータベースとして活用し、事前に準備した投稿を指定した時間に自動的に公開する機能を提供します。

## 2. システム要件

- Google アカウント
- Google スプレッドシート
- Google Apps Script
- X API 開発者アカウント（API キー、シークレットキー、アクセストークン、アクセストークンシークレット）
- Node.js と npm（開発環境）

## 3. プロジェクト構造

```
.
├── src/
│   ├── api/
│   │   ├── archive.ts     # アーカイブ機能
│   │   ├── media.ts       # メディア処理
│   │   ├── postData.ts    # 投稿データ管理
│   │   ├── triggers.ts    # トリガー管理
│   │   └── xauth.ts       # X 認証情報管理
│   ├── test/
│   │   └── testApi.ts     # API テスト
│   ├── apiv2.ts           # APIエンドポイント
│   ├── auth.ts            # 認証処理
│   ├── main.ts            # メイン処理
│   ├── media.ts           # メディア機能
│   ├── types.d.ts         # 型定義
│   └── utils.ts           # ユーティリティ関数
├── appsscript.json        # Apps Script 設定
├── esbuild.config.js      # ビルド設定
├── modify-codejs.js       # コード修正スクリプト
├── package.json           # プロジェクト設定
├── README.md              # ドキュメント
└── tsconfig.json          # TypeScript 設定
```

## 4. データモデル

### 4.1 XAuthInfo インターフェース

```typescript
export interface XAuthInfo {
  accountId: string; // X アカウント ID
  apiKey: string; // Consumer Key
  apiKeySecret: string; // Consumer Secret
  accessToken: string; // アクセストークン
  accessTokenSecret: string; // アクセストークンシークレット
}
```

### 4.2 XPostData インターフェース

```typescript
export interface XPostData {
  id?: string; // 投稿の一意な識別子
  createdAt?: string; // 投稿作成日時
  postSchedule?: string; // 投稿予定日時
  postTo?: string; // 投稿先アカウント ID
  contents?: string; // 投稿内容
  media?: string; // メディア URL（カンマ区切り）
  inReplyToInternal?: string; // 内部でのリプライ先投稿 ID
}
```

### 4.3 PostError インターフェース

```typescript
export interface PostError {
  timestamp: string; // エラー発生時間
  context: string; // エラーコンテキスト
  message: string; // エラーメッセージ
  stack: string; // スタックトレース
}
```

### 4.4 TriggerProps インターフェース

```typescript
export interface TriggerProps {
  intervalMinuts: number; // トリガー実行間隔（分）
}
```

## 5. コアコンポーネント

### 5.1 API レイヤー (apiv2.ts)

`doPost()` と `doGet()` 関数を提供し、クライアントからのリクエストを処理します。target と action パラメータに基づいて適切なモジュールの関数を呼び出します。

#### POST エンドポイント処理フロー:

1. リクエストパラメータと JSON ボディを抽出
2. target と action に基づいて処理を分岐
3. 適切なモジュール関数を呼び出し
4. レスポンスを JSON 形式で返却

#### GET エンドポイント処理フロー:

1. リクエストパラメータを抽出
2. target と action に基づいて処理を分岐
3. データ取得関数を呼び出し
4. レスポンスを JSON 形式で返却

#### エラーハンドリング:

- 適切な HTTP ステータスコードを設定
- エラーメッセージをログに記録
- クライアントに JSON 形式でエラー情報を返却

### 5.2 投稿自動化エンジン (main.ts)

`autoPostToX()` 関数を中心とした自動投稿処理を提供します。

#### 投稿処理フロー:

1. 必要なシートの存在確認とセットアップ
2. 投稿データを時刻順にソート
3. 現在時刻から 1 分以内に予定されている投稿を抽出
4. 投稿処理の冪等性を Cache で確保
5. メディアのアップロード処理
6. リプライ関係の解決
7. X API を使用して投稿
8. 投稿データを "Posted" シートに移動
9. "Posted" シートを時系列順にソート

#### 投稿関数 (`postTweet`):

```typescript
async function postTweet(
  content: string, // 投稿内容
  mediaIds: string[], // メディア ID 配列
  replyToPostId: string | null, // リプライ先 ID
  accountId: string // アカウント ID
): Promise<any>;
```

OAuth 1.0a 認証を使用して X API にリクエストを送信する処理を実装しています。

### 5.3 認証モジュール (auth.ts)

X API との通信に必要な OAuth 1.0a 認証処理を提供します。

#### 主要関数:

- `generateSignatureBaseString()`: OAuth 署名のベース文字列を生成
- `generateSignature()`: HMAC-SHA1 署名を生成
- `getXAuthById()`: アカウント ID に対応する認証情報を取得
- `generateAuthHeader()`: 認証ヘッダーを生成

### 5.4 メディアモジュール (media.ts)

X への投稿に添付するメディアを管理します。

#### `uploadMediaToX()` 関数:

Google Drive のメディアを X にアップロードし、メディア ID を取得します。

1. URL からファイル ID を抽出
2. DriveApp から Blob データを取得
3. OAuth 署名を生成
4. X メディアアップロード API を呼び出し
5. 返却されたメディア ID を収集して返却

### 5.5 ユーティリティモジュール (utils.ts)

共通して使用される便利な関数を提供します。

#### 主要関数:

- `sortPostsBySchedule()`: 投稿データを予定時刻でソート
- `isWithinOneMinute()`: 2 つの日時が 1 分以内かチェック
- `sendErrorEmail()`: エラー通知メールを送信
- `logErrorToSheet()`: エラーをシートに記録
- `fetchWithRetries()`: リトライ機能付き HTTP リクエスト

## 6. API モジュール

### 6.1 アーカイブ機能 (api/archive.ts)

`archiveSheet()` 関数を使用して、"Posted" または "Errors" シートのデータを別のスプレッドシートにコピーします。

### 6.2 メディア処理 (api/media.ts)

`uploadMediaFile()` 関数を使用して、メディアファイルを Google Drive にアップロードし、共有設定を行います。

### 6.3 投稿データ管理 (api/postData.ts)

投稿データの CRUD 操作を提供します:

- `createPostData()`: 新しい投稿データを作成
- `fetchPostData()`: 全投稿データを取得
- `updatePostData()`: 投稿データを更新
- `deletePostData()`: 投稿データを削除
- `fetchPostedData()`: 投稿済みデータを取得
- `fetchErrorData()`: エラーデータを取得

### 6.4 トリガー管理 (api/triggers.ts)

Apps Script のトリガーを管理します:

- `createTimeBasedTrigger()`: 時間ベースのトリガーを作成
- `deleteAllTriggers()`: すべてのトリガーを削除

### 6.5 X 認証管理 (api/xauth.ts)

X API 認証情報を PropertiesService に安全に保存・管理します:

- `createXAuth()`: 新しい認証情報を作成
- `getXAuthAll()`: 全アカウントの認証情報を取得
- `updateXAuth()`: 認証情報を更新
- `deleteXAuth()`: 認証情報を削除

## 7. ビルドプロセス

プロジェクトは esbuild を使用してバンドルされ、Google Apps Script にデプロイされます:

1. `npm run build`: TypeScript コードをコンパイル
2. `npm run bundle`: esbuild でファイルをバンドル
3. `npm run modify`: code.js を修正（ラッパーを削除）
4. `npm run push`: clasp を使用して Apps Script にプッシュ

`package.json` に定義されたスクリプト:

```json
{
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "deploy": "npm run bundle && npm run modify && npm run push",
    "bundle": "node esbuild.config.js",
    "modify": "node modify-codejs.js",
    "push": "npm run copy-dist && clasp push && npm run cleanup-dist-copy",
    "copy-dist": "copyfiles -u 1 dist/*.js ./",
    "cleanup-dist-copy": "del-cli code.js",
    "testgen": "del-cli src/test/testApi.js && tsc --project test-tsconfig.json"
  }
}
```

## 8. セットアップガイド

### 8.1 開発環境のセットアップ

1. リポジトリをクローン
2. 依存パッケージをインストール: `npm install`
3. `.clasp.json` ファイルを作成し、scriptId を設定

### 8.2 Google スプレッドシートの設定

1. 新しい Google スプレッドシートを作成
2. 以下のシートを作成:
   - "Posts": 投稿データ用
   - "Posted": 投稿済みデータ用
   - "Errors": エラーログ用

### 8.3 X API 認証情報の設定

1. X デベロッパープラットフォームでアプリを作成
2. Consumer Key/Secret と Access Token/Secret を取得
3. API を使用して認証情報を登録:
   - エンドポイント: `?action=create&target=xauth`
   - ペイロード: `{ "accountId": "...", "apiKey": "...", "apiKeySecret": "...", "accessToken": "...", "accessTokenSecret": "..." }`

### 8.4 デプロイ

1. Apps Script として Web アプリにデプロイ
2. アクセス権限を適切に設定
3. トリガーを設定:
   - エンドポイント: `?action=create&target=trigger`
   - ペイロード: `{ "intervalMinutes": 1 }`

## 9. 使用例

### 9.1 新しい投稿を作成する

```http
POST ?action=create&target=postData
Content-Type: application/json

{
  "postTo": "アカウントID",
  "media": "https://drive.google.com/file/d/xxxx/view",
  "postSchedule": "2025-04-01T10:00:00Z",
  "contents": "テスト投稿です #テスト"
}
```

### 9.2 スレッド投稿を作成する

```http
POST ?action=create&target=postData
Content-Type: application/json

{
  "postTo": "アカウントID",
  "postSchedule": "2025-04-01T10:05:00Z",
  "contents": "これはスレッドの返信です",
  "inReplyToInternal": "元投稿のID"
}
```

### 9.3 メディアをアップロードする

```http
POST ?action=upload&target=media
Content-Type: application/json

{
  "xMediaFileData": [
    {
      "filename": "image.jpg",
      "filedata": "BASE64_ENCODED_DATA",
      "mimeType": "image/jpeg"
    }
  ]
}
```

### 9.4 投稿済みデータをアーカイブする

```http
POST ?action=archive&target=posted
Content-Type: application/json

{
  "filename": "2025年3月投稿履歴"
}
```

## 10. エラーハンドリング

システムは以下の方法でエラーを処理します:

1. エラーログをスプレッドシートに記録
2. メール通知を送信（重要なエラー）
3. HTTP ステータスコードを返却
4. 冪等性を確保してデータの一貫性を保証

## 11. セキュリティ対策

1. 認証情報は PropertiesService で安全に保存
2. API リクエストはパラメータバリデーションを実施
3. メディアアップロード時のファイルタイプチェック
4. OAuth 1.0a 署名による API リクエスト認証
5. レート制限に対応したリトライ機能

## 12. 注意事項

- X API の利用制限に注意すること
- 大量のメディアアップロードは Google Drive の容量を消費します
- スプレッドシートに大量のデータを保存する場合はパフォーマンスに影響する可能性があります
- メディア投稿には高度なサービス「Drive API v3」の有効化が必要です

このドキュメントは X Autopost アプリケーションの技術的な詳細を記載しています。システムの改善やカスタマイズを行う際にご活用ください。
