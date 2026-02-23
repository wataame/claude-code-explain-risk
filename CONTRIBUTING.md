# 貢献ガイド / Contributing Guide

[English](#english) | [日本語](#日本語)

---

## 日本語

claude-code-explain-risk に興味を持ってくれてありがとうございます！

### Issue を立てる

気になったことがあれば、お気軽に Issue を立ててください。

**バグ報告**
- どのコマンドで問題が起きたか
- 期待する動作と実際の動作
- OS と Node.js のバージョン

**コマンド追加のリクエスト**
- コマンド名と用途
- 推奨するリスクレベル（低/中/高）
- 説明テキストの案（あれば）

### PR を送る

1. リポジトリをフォーク
2. ブランチを作成: `git checkout -b feature/add-xxx-command`
3. 変更を加える
4. テストで動作確認（下記参照）
5. PR を作成

### テスト方法

```bash
# コマンドのリスク判定をテスト
echo '{"tool_name":"Bash","tool_input":{"command":"ここにコマンド"}}' | node hooks/explain-risk.js

# ANSI カラーを除去して読みやすくする
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | node hooks/explain-risk.js | \
  python3 -c "import sys,json,re; d=json.load(sys.stdin); print(re.sub(r'\x1b\[[0-9;]*m','',d['hookSpecificOutput']['permissionDecisionReason']))"
```

### コーディングルール

- 新しいコマンドを追加する場合は、既存のパターンに合わせてください
- 説明テキストは非エンジニアにも分かりやすい言葉で書いてください
- 専門用語は避け、平易な表現を使ってください
- 評価順序（高 → 中 → 低）を維持してください

---

## English

Thanks for your interest in claude-code-explain-risk!

### Opening an Issue

Feel free to open an issue for anything you notice.

**Bug Reports**
- Which command caused the problem
- Expected behavior vs actual behavior
- OS and Node.js version

**Command Requests**
- Command name and what it does
- Suggested risk level (Low / Medium / High)
- Suggested explanation text (if any)

### Sending a PR

1. Fork the repository
2. Create a branch: `git checkout -b feature/add-xxx-command`
3. Make your changes
4. Test your changes (see below)
5. Open a PR

### Testing

```bash
# Test risk classification for a command
echo '{"tool_name":"Bash","tool_input":{"command":"your command here"}}' | node hooks/explain-risk.js

# Strip ANSI colors for readability
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | node hooks/explain-risk.js | \
  python3 -c "import sys,json,re; d=json.load(sys.stdin); print(re.sub(r'\x1b\[[0-9;]*m','',d['hookSpecificOutput']['permissionDecisionReason']))"
```

### Coding Guidelines

- Follow existing patterns when adding new commands
- Write explanations in plain language that non-engineers can understand
- Avoid jargon — keep it simple
- Maintain the evaluation order (High → Medium → Low)
