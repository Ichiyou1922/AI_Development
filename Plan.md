# 開発の予定

- [ ] ollamaでもtool群が使えるようにする
- [x] discordの音声入力の改善．現状音声入力がきちんと動作しない．入力チャンクが細かすぎる？
- [ ] スクリーンショット解析でユーザーのアクションを推測し，リアクションする
- [ ] 音声イベントの解析？難易度高いなぁ
- [ ] 推論ルータの設計->やろうと思ったけどollamaで統一して良くない？
- [ ] プラグインインターフェースの実装
- [ ] プラグインにツール群を移行する->ホットリロードを実装する
- [ ] 自発的にyoutubeとか本を読ませたいな->ユーザーに共有
- [ ] ログ設計と構造化ログ->自発的情報収集
- [ ] デバッグ機能をつけねば
- [ ] 知識の自動更新->何が重要で何が重要じゃないか？
- [ ] ハードコード解消->設定ファイルで管理する
- [ ] フィードバックループの実装->ユーザーの反応から学習，倫理感を考慮する

dockerでVOICEVOX Engineをダウンロード
```bash
docker run --rm --gpus all -p 50021:50021 voicevox/voicevox_engine:nvidia-ubuntu20.04-latest
```

voicevox重いのでCPU版を使おう
```bash
docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
```

GPU版はこっち
```bash
docker run --rm --gpus all -p 50021:50021 voicevox/voicevox_engine:nvidia-ubuntu20.04-latest
```

Discordの音声入力はうまくいった
原因はDiscordの音声データの形式（Opus）とwhisperが受け取りたいデータ形式（PCM）の乖離にあった．
デコードの部分を追加して解決