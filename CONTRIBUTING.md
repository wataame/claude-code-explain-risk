# 貢献ガイド

claude-code-explain-risk への貢献を歓迎します！

## Issue の出し方

### バグ報告

- どのコマンドで問題が起きたか
- 期待する動作と実際の動作
- OS と Node.js のバージョン

### 新しいコマンドの追加リクエスト

- コマンド名と用途
- 推奨するリスクレベル（低/中/高）
- 説明テキストの案（あれば）

## PR の送り方

1. リポジトリをフォーク
2. ブランチを作成: `git checkout -b feature/add-xxx-command`
3. 変更を加える
4. テストで動作確認（下記参照）
5. PR を作成

## テスト方法

フックの動作は以下のコマンドで確認できます：

```bash
# コマンドのリスク判定をテスト
echo '{"tool_name":"Bash","tool_input":{"command":"ここにコマンド"}}' | node hooks/explain-risk.js

# ANSI カラーを除去して読みやすくする
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | node hooks/explain-risk.js | \
  python3 -c "import sys,json,re; d=json.load(sys.stdin); print(re.sub(r'\x1b\[[0-9;]*m','',d['hookSpecificOutput']['permissionDecisionReason']))"
```

## コーディングルール

- 新しいコマンドを追加する場合は、既存のパターンに合わせてください
- 説明テキストは非エンジニアにも分かりやすい日本語で書いてください
- 専門用語は避け、平易な表現を使ってください
- 評価順序（高 → 中 → 低）を維持してください
