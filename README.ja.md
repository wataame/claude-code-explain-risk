<p align="center">
  <img src="assets/header.png" alt="Claude Code Explain Risk" width="600">
</p>

# Claude Code Explain Risk

**Claude Code の許可ダイアログに、操作のリスクを分かりやすく表示するツール**

[English](README.md)

---

Claude Code を使っていると「このコマンドを許可しますか？」というダイアログが表示されますが、何が起きるのか分かりにくいことがあります。

このツールを入れると、コマンドのリスクレベル（低・中・高）と、何をしようとしているかの説明が表示されるようになります。日本語・英語に対応しており、システムの言語設定に合わせて自動で切り替わります。

## 表示例

```
||| リスク: 高
ファイルやフォルダをまとめて削除しようとしています。
削除されたファイルは復元できません。
```

```
|| リスク: 中
npm パッケージをインストールしようとしています。
不正なソフトウェアが含まれる可能性があります。
```

低リスク（`ls`、`cat`、`git status` など）はそのまま通るので、邪魔になりません。

## インストール

### ワンライナー（おすすめ）

```bash
curl -fsSL https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main/install.sh | bash
```

### ローカルインストール

```bash
git clone https://github.com/wataame/claude-code-explain-risk.git
cd claude-code-explain-risk
bash install.sh
```

インストール後、Claude Code を再起動すると有効になります。

## アンインストール

```bash
# ローカルにリポジトリがある場合
bash uninstall.sh

# リポジトリがない場合
curl -fsSL https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main/uninstall.sh | bash
```

## リスクレベル

| レベル | 表示 | 動作 |
|---|---|---|
| 低 | 表示なし | そのまま通ります（Claude Code のデフォルト動作） |
| 中 | 黄色で説明表示 | 操作内容とリスクを説明してから確認 |
| 高 | 赤色で説明表示 | 操作内容とリスクを説明してから確認 |

## 対応コマンド（150+）

### 高リスク（赤）

| カテゴリ | コマンド例 |
|---|---|
| ファイル削除 | `rm -rf`、`find -delete`、`truncate` |
| Git 不可逆操作 | `git push`、`git reset --hard`、`git clean`、`git stash clear` |
| 管理者権限 | `sudo`、`systemctl`、`launchctl` |
| リモート接続 | `ssh`、`scp`、`rsync` |
| 外部スクリプト | `curl \| bash`、`wget \| sh` |
| 権限変更 | `chmod`、`chown` |
| プロセス終了 | `kill`、`killall` |

### 中リスク（黄）

| カテゴリ | コマンド例 |
|---|---|
| パッケージ管理 | `npm install`、`pip install`、`brew install`、`yarn add` |
| Git 操作 | `git add`、`git commit`、`git merge`、`git pull` |
| ファイル操作 | `mkdir`、`cp`、`mv`、`touch` |
| プログラム実行 | `node`、`python3`、`ruby`、`bun` |
| テスト | `jest`、`pytest`、`playwright` |
| ビルド | `make`、`tsc`、`webpack` |
| デプロイ | `firebase deploy`、`vercel`、`gcloud` |
| データベース | `psql`、`mysql`、`sqlite3` |

### 低リスク（表示なし）

| カテゴリ | コマンド例 |
|---|---|
| 基本コマンド | `ls`、`pwd`、`cd`、`echo`、`cat` |
| 検索 | `find`、`grep`、`rg`、`diff` |
| テキスト処理 | `jq`、`sort`、`cut` |
| Git 読み取り | `git status`、`git log`、`git diff` |
| バージョン確認 | `--version`、`--help` |

## 設定との連携

### allow リスト

Claude Code の `settings.json` で許可済みのコマンドには介入しません。フックを入れる前と同じ動作を維持します。

```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(npm test:*)"
    ]
  }
}
```

### Permission Mode

| モード | フックの動作 |
|---|---|
| `default` | allow リストにマッチ → 自動許可 / それ以外 → リスク説明 + 確認 |
| `acceptEdits` | 同上 |
| `dontAsk` | フック介入なし（全て自動承認） |
| `bypassPermissions` | フック介入なし（全て自動承認） |

## 言語

システムの `LANG` 環境変数に基づいて自動で切り替わります。

| `LANG` | 表示言語 |
|---|---|
| `ja_JP.UTF-8` 等（`ja` で始まる） | 日本語 |
| それ以外（`en_US.UTF-8` 等） | 英語 |

特別な設定は不要です。

## 動作環境

- **Node.js** — Claude Code に同梱されているので追加インストール不要
- **対応OS** — macOS、Linux
- **依存パッケージ** — なし（Node.js 標準ライブラリのみ使用）

## 仕組み

Claude Code の [PreToolUse フック](https://docs.anthropic.com/en/docs/claude-code/hooks) を使っています。Bash コマンドが実行される前にフックが呼ばれ、コマンドのリスクを判定して説明を表示します。

```
Claude Code がコマンドを実行しようとする
  ↓
explain-risk.js が呼ばれる
  ↓
コマンドのリスクを判定（低/中/高）
  ↓
低リスク → そのまま通す
中・高リスク → 説明を表示して確認
```

### 対象ツール

リスク説明が表示されるのは **Bash コマンドのみ** です。これは Claude Code の仕様上、フックの説明テキストを表示できるのが Bash の許可ダイアログに限られるためです。

| ツール | 許可ダイアログ | リスク説明 |
|---|---|---|
| **Bash** | あり | あり（このツールが表示） |
| Edit / Write | あり（Claude Code 独自のUI） | なし |
| WebFetch / WebSearch | あり（Claude Code 独自のUI） | なし |
| MCP ツール | あり（Claude Code 独自のUI） | なし |
| Read / Glob / Grep | なし（自動許可） | なし |

Bash 以外のツール（Edit、Write、WebFetch、MCP など）では、Claude Code 独自の許可ダイアログがそのまま表示されます。これらのツールは Claude Code が専用のUIで内容を表示するため、フックの説明テキストは使用されません。

> Bash は全ツール使用の約 38% を占め、非エンジニアが最も判断に困るツールです。実用上、Bash だけでも十分な効果があります。

なお、フック内部では MCP ツールや Edit / Write に対しても判定ロジックを備えています。Claude Code 側で対応が進めば（[#17356](https://github.com/anthropics/claude-code/issues/17356)）、将来的にこれらのツールでもリスク説明が表示されるようになる見込みです。

## 貢献

Issue や PR を歓迎しています！詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

- 新しいコマンドの追加リクエスト
- 説明テキストの改善
- バグ報告
- ドキュメントの改善

## ライセンス

[MIT](LICENSE)
