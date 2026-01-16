# AI Development プロジェクト チートシート

このドキュメント集は、本プロジェクトのデバッグと新機能開発のための講義資料です。

## 学習の進め方（セマンティックツリー学習法）

各ドキュメントは以下の構造で記述されています：

1. **幹（根本原理）** - その技術の本質的な概念を理解する
2. **枝葉（実践）** - 具体的な使い方とパターン

まず「幹」を理解してから「枝葉」に進むことで、断片的な知識ではなく体系的な理解が得られます。

---

## ディレクトリ構成

```
cheetsheets/
├── README.md           # このファイル（目次）
├── debug/              # デバッグ関連
│   ├── 01-electron-fundamentals.md
│   ├── 02-typescript-debugging.md
│   ├── 03-ipc-debugging.md
│   ├── 04-llm-voice-memory-debugging.md
│   └── 05-html-json-debugging.md
└── develop/            # 開発関連
    ├── 01-architecture-overview.md
    ├── 02-adding-new-features.md
    ├── 03-ipc-handler-development.md
    ├── 04-frontend-development.md
    └── 05-configuration-system.md
```

---

## デバッグガイド（debug/）

問題が発生した時の調査・解決方法。

### [01-electron-fundamentals.md](debug/01-electron-fundamentals.md)
**Electron デバッグの基礎**

- Main Process と Renderer Process の違い
- どのプロセスでエラーが発生しているか特定する方法
- DevTools の使い方
- よく遭遇するエラーと対処法

### [02-typescript-debugging.md](debug/02-typescript-debugging.md)
**TypeScript / Node.js デバッグ**

- TypeScript コンパイルエラーの読み方
- 型エラーの対処法
- async/await のデバッグ
- Node.js 固有の問題

### [03-ipc-debugging.md](debug/03-ipc-debugging.md)
**IPC 通信デバッグ**

- IPC の仕組み
- 3箇所（Renderer/Preload/Main）でのログ確認
- ストリーミング通信のデバッグ
- よくある IPC エラー

### [04-llm-voice-memory-debugging.md](debug/04-llm-voice-memory-debugging.md)
**LLM / Voice / Memory システムのデバッグ**

- LLM Router のデバッグ
- Ollama / Anthropic の接続確認
- STT（音声認識）のデバッグ
- TTS（音声合成）のデバッグ
- メモリシステムのデバッグ
- Discord Bot のデバッグ

### [05-html-json-debugging.md](debug/05-html-json-debugging.md)
**HTML / CSS / JSON デバッグ**

- Renderer UI のデバッグ
- Live2D のデバッグ
- JSON 設定ファイルのデバッグ
- package.json / tsconfig.json の問題

---

## 開発ガイド（develop/）

新機能を追加する際の手順とパターン。

### [01-architecture-overview.md](develop/01-architecture-overview.md)
**アーキテクチャ概要**

- プロジェクト全体の構造
- 各コンポーネントの役割
- データフローの理解
- 設計パターン

### [02-adding-new-features.md](develop/02-adding-new-features.md)
**新機能追加ガイド**

- 機能追加の5ステップ
- どこから書き始めるか
- 新しいツール機能の追加例
- 新しい IPC 機能の追加例
- チェックリスト

### [03-ipc-handler-development.md](develop/03-ipc-handler-development.md)
**IPC ハンドラ開発**

- IPC の設計原則
- invoke/handle パターン
- ストリーミングパターン
- 本プロジェクトの IPC チャンネル一覧
- ベストプラクティス

### [04-frontend-development.md](develop/04-frontend-development.md)
**フロントエンド開発**

- HTML 構造の書き方
- CSS スタイリング
- TypeScript でのイベント処理
- Live2D 開発
- よくあるパターン（ローディング、トースト、モーダル）

### [05-configuration-system.md](develop/05-configuration-system.md)
**設定システム**

- 設定の階層構造
- 型定義の書き方
- 新しい設定項目の追加手順
- 環境変数の使い方
- 動的な設定更新

---

## クイックリファレンス

### 問題発生時の最初のステップ

1. **どのプロセスで発生？**
   - ターミナルにエラー → Main Process
   - DevTools Console にエラー → Renderer Process

2. **エラーメッセージを読む**
   - スタックトレースの発生箇所を特定
   - エラーコードがあればドキュメントを確認

3. **ログを追加**
   ```typescript
   console.log('[Debug] ここまで到達');
   console.log('[Debug] 変数の値:', variable);
   ```

### 新機能開発の流れ

```
1. 設計（要件定義、影響範囲の特定）
   ↓
2. 型定義（src/main/config/types.ts など）
   ↓
3. Main Process 実装
   ↓
4. Preload 更新
   ↓
5. Renderer 実装
   ↓
6. テスト
```

### よく使うコマンド

```bash
# ビルド
npm run build

# 開発モードで起動
npm run dev

# クリーンビルド
rm -rf dist/ && npm run build

# 依存関係の再インストール
rm -rf node_modules/ && npm install

# JSON 構文チェック
cat config/config.json | jq .

# 外部サービス確認
curl http://localhost:11434/api/tags  # Ollama
curl http://localhost:50021/speakers  # VOICEVOX
```

---

## Discord Bot セットアップ手順

このアプリケーションを Discord Bot として利用するための手順です。

### 1. Discord Developer Portal でアプリ作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリック
3. アプリ名を入力して作成

### 2. Bot を有効化

1. 左メニューから「Bot」を選択
2. 「Add Bot」をクリック
3. 「Reset Token」でトークンを取得（**一度しか表示されないので必ずコピー**）

### 3. Bot の権限設定

「Bot」ページで以下を設定：

**Privileged Gateway Intents**（必須）：
- ✅ MESSAGE CONTENT INTENT（メッセージ内容の読み取り）
- ✅ SERVER MEMBERS INTENT（メンバー情報の取得）
- ✅ PRESENCE INTENT（プレゼンス情報）

### 4. OAuth2 で招待 URL を生成

1. 左メニューから「OAuth2」→「URL Generator」を選択
2. **Scopes** で以下を選択：
   - ✅ `bot`
   - ✅ `applications.commands`（スラッシュコマンドを使う場合）

3. **Bot Permissions** で以下を選択：
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Connect（VC に参加）
   - ✅ Speak（VC で発言）
   - ✅ Use Voice Activity

4. 生成された URL をコピー

### 5. サーバーに Bot を追加

1. 生成した URL をブラウザで開く
2. Bot を追加したいサーバーを選択
3. 「認証」をクリック

### 6. 環境変数を設定

プロジェクトの `.env` ファイルに追加：

```bash
DISCORD_BOT_TOKEN=your_bot_token_here
```

### 7. 起動確認

```bash
npm run dev
```

ターミナルに以下のようなログが出れば成功：
```
[Discord] Bot ログイン完了: YourBotName#1234
[Discord] 参加サーバー数: 1
```

### トラブルシューティング

| 症状 | 原因と対処 |
|------|-----------|
| `Error [TokenInvalid]` | トークンが無効。Developer Portal でリセット |
| `Missing Access` | Bot の権限不足。招待 URL を権限付きで再生成 |
| メッセージに反応しない | MESSAGE CONTENT INTENT が無効 |
| VC に参加できない | Connect / Speak 権限がない |

---

## プロジェクト固有の重要ファイル

| ファイル | 役割 |
|---------|------|
| `src/main/index.ts` | エントリーポイント、IPC 定義 |
| `src/preload/index.ts` | IPC ブリッジ |
| `src/renderer/renderer.ts` | メイン UI ロジック |
| `src/main/config/types.ts` | 設定の型定義 |
| `config/default.json` | デフォルト設定 |
| `src/main/llm/router.ts` | LLM プロバイダ管理 |
| `src/main/voice/voiceDialogueController.ts` | 音声対話制御 |
| `src/main/memory/memoryManager.ts` | 記憶管理 |

---

## 学習順序の推奨

### デバッグを学ぶ場合

1. [01-electron-fundamentals.md](debug/01-electron-fundamentals.md) - まずプロセスモデルを理解
2. [02-typescript-debugging.md](debug/02-typescript-debugging.md) - 型エラーの対処法
3. [03-ipc-debugging.md](debug/03-ipc-debugging.md) - IPC は問題が起きやすい
4. 必要に応じて他のドキュメント

### 開発を学ぶ場合

1. [01-architecture-overview.md](develop/01-architecture-overview.md) - 全体像を把握
2. [02-adding-new-features.md](develop/02-adding-new-features.md) - 開発の流れ
3. [03-ipc-handler-development.md](develop/03-ipc-handler-development.md) - IPC 開発
4. [04-frontend-development.md](develop/04-frontend-development.md) - UI 開発
5. [05-configuration-system.md](develop/05-configuration-system.md) - 設定管理
