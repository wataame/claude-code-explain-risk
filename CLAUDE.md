# claude-code-explain-risk — プロジェクト設定

## プロジェクト概要

非エンジニアが Claude Code を使う際に、許可ダイアログの内容を分かりやすく説明するツール。
`PreToolUse` フックを使い、Bash コマンドのリスクレベル（中/高）と説明を表示する。
低リスクコマンドは Claude Code のデフォルト判定に委ねる。
日本語・英語対応（`LANG` 環境変数で自動切替）。

## リポジトリ情報

- **GitHub**: `https://github.com/wataame/claude-code-explain-risk`
- **ライセンス**: MIT

## ドキュメント

| ファイル | 内容 |
|---|---|
| `README.md` | 英語メインの説明書 |
| `README.ja.md` | 日本語版の説明書 |
| `CONTRIBUTING.md` | 貢献ガイド（日本語） |
| `LICENSE` | MIT License |
| `PLAN.md` | 企画書（課題・調査結果・技術仕様・実機検証結果・進捗管理） |
| `hooks/explain-risk.js` | フック本体（Node.js、リスク判定ロジック） |
| `install.sh` | インストーラー（`~/.claude/` に配置） |
| `uninstall.sh` | アンインストーラー |
| `.gitignore` | ローカル専用ファイルの除外設定 |

## 重要な技術的発見

- `permissionDecisionReason` は **Bash コマンドにのみ表示される**
- Edit/Write/Read/Glob は Claude Code 独自の許可UIが優先され、フックのテキストは表示されない
- `systemMessage` は許可**後**に表示される（判断前に見えないため不採用）
- stderr 出力も Claude Code にキャプチャされ、ユーザーに表示されない
- Bash は全ツール使用の 38% を占め、非エンジニアが最も困るツールなので実用上は問題なし
- Issue #17356 が修正されれば Edit/Write でも表示される見込みあり
- **`permissionDecision: 'ask'` は `permissionDecisionReason` 表示に必須**（省略すると何も表示されない — Option B で実証済み）
- **`permissionDecision: 'ask'` は Claude Code の allow リストを上書きする**（allow 済みコマンドでも毎回確認ダイアログが出る）
  - → 解決策: フック内で settings.json を読み、allow リストに該当するコマンドをスキップ
- **`process.exit(0)` はフック登録時にデフォルト動作に戻さない**（3回以上の実機検証で確定）
  - `process.exit(0)` — ダイアログ表示される ❌
  - 空 JSON 出力 — ダイアログ表示される ❌
  - `permissionDecision: 'allow'` — 自動承認される ✅（唯一の動作する方法）
- **`permission_mode` フィールドがフック入力 JSON に含まれる**（公式ドキュメント記載）
  - 値: `"default"`, `"acceptEdits"`, `"dontAsk"`, `"plan"`, `"bypassPermissions"`
  - CLI: `claude --permission-mode <mode>`（`--semiauto` / `--auto` は非公式エイリアス）

## 表示仕様（確定）

### フォーマット
```
{icon} リスク: {レベル}   ← 太字
{操作の説明}。
{リスクの説明（結果・影響）}。
```

### リスクレベル別の動作
| レベル | アイコン | 色 | 動作 |
|---|---|---|---|
| 低 | — | — | `process.exit(0)` → Claude Code のデフォルト判定に委ねる |
| 中 | `\|\|` | Yellow | リスク説明 + 確認ダイアログ |
| 高 | `\|\|\|` | Red | リスク説明 + 確認ダイアログ |

- 低リスクはフックが介入しない（`isAllowedBySettings()` のパターン漏れに対するフォールバック）
- ASCII 文字のみ使用（Unicode 記号は日本語フォントで幅ズレするため不採用）
- ANSI 標準16色でターミナルテーマに自動で馴染む

## Allow リスト連携 & Permission Mode 対応

ユーザーの `settings.json` で許可済みコマンドにはフックが介入しない。

### Permission Mode 別の動作

| モード | CLI フラグ | フックの動作 |
|---|---|---|
| `default` | なし（通常起動） | allow リストマッチ → 自動承認 / それ以外 → リスク説明 + ダイアログ |
| `acceptEdits` | `--permission-mode acceptEdits` | 同上 |
| `dontAsk` | `--permission-mode dontAsk` | `process.exit(0)` — フック介入なし |
| `bypassPermissions` | `--dangerously-skip-permissions` | `process.exit(0)` — フック介入なし |
| `plan` | `--permission-mode plan` | 同上（allow リスト尊重 + リスク説明） |

### 設計方針: フックなしの挙動を維持する

- **全モード共通で allow リストを尊重する** — フックがない時と同じ挙動を維持
- allow リストにマッチ → `permissionDecision: 'allow'` で自動承認
- allow リストにマッチしない + 中・高リスク → `permissionDecision: 'ask'` + リスク説明
- allow リストにマッチしない + 低リスク → `process.exit(0)` でデフォルト判定に委ねる
- `process.exit(0)` ではフック登録時に自動承認が機能しないため、明示的に `'allow'` を使用

### `permissionDecision: 'allow'` の安全性

`permissionDecision: 'allow'` が発動する条件（全て同時に満たす必要あり）:
1. ユーザー自身の `settings.json` の allow リストにマッチすること
2. 複合コマンド（`;` `&&` `||` 改行 単独`&`）を含まないこと

### Allow リスト読み込み

フック起動時に以下の settings ファイルを読み込む：
- `~/.claude/settings.json`（グローバル）
- `~/.claude/settings.local.json`（グローバル・ローカル）
- `<CWD>/.claude/settings.json` および `.local.json`（プロジェクト）
- CWD から上位ディレクトリを順にたどって `.claude/settings*.json` を探索

### パターン変換ルール
| settings.json の記法 | 意味 | 変換後 regex |
|---|---|---|
| `"Bash"` | Bash 全許可 | （ツール名完全一致） |
| `"Bash(ls:*)"` | `ls` + 任意引数 | `^ls\s*.*$` |
| `"Bash(done)"` | `done` のみ | `^done$` |
| `"Bash(cat:*)"` | `cat` + 任意引数 | `^cat\s*.*$` |

- `:` → `\s*`（空白マッチ）
- `*` → `.*`（ワイルドカード）

### 複合コマンドガード

allow リストにマッチしても、最初の行に複合コマンドを含む場合はスキップしない。
- 対象: `;` `&&` `||` 単独`&`（バックグラウンド実行）
- 例: `cat a.txt; rm -rf /` が `Bash(cat:*)` で素通りするのを防ぐ
- パイプ `|` は除外（`ls | head` 等の日常使用に影響するため）
- 引用符内の文字は除外（`echo "a && b"` が誤判定されるのを防止）
- **最初の行のみでチェック** — 改行以降はヒアドキュメントやスクリプト本文であり、コマンドチェーンではない

## コマンドカバレッジ（150+ パターン）

### 高リスク
ファイル削除（`rm`, `find -delete`, `truncate`）、Git 不可逆（`push`, `reset --hard`, `clean`, `branch -D`, `stash clear/drop`）、GitHub（`gh pr merge`）、管理者（`sudo`, `systemctl`, `launchctl`）、リモート接続（`ssh`, `scp`, `rsync`）、権限変更（`chmod`, `chown`）、プロセス終了（`kill`）、外部スクリプト実行（`curl | bash`）、リダイレクト書き込み（`> file` — `>/dev/null` と `2>/dev/null` は除外）

### 中リスク
パッケージ管理（`npm install/ci`, `pip install`, `brew install`, `yarn add`, `pnpm add`, `uv`, `poetry`, `conda`, `gem`, `cargo`, `go install`）、Git 操作（`add`, `commit`, `checkout`, `merge`, `pull`, `rebase`, `worktree`, `cherry-pick`）、GitHub CLI 書き込み（`pr create`, `issue create/close`, `release create`, `api`）、ファイル操作（`mkdir`, `touch`, `cp`, `mv`）、プログラム実行（`node`, `python`, `ruby`, `bun`, `deno`）、テスト（`jest`, `pytest`, `playwright`）、ビルド（`make`, `tsc`, `webpack`）、デプロイ（`firebase deploy`, `vercel`, `gcloud`, `terraform`）、DB（`psql`, `mysql`, `sqlite3`）、コンテナ（`docker`, `kubectl`）

### 低リスク
基本（`ls`, `pwd`, `cd`, `echo`, `cat`, `head`, `tail`）、検索（`find`, `grep`, `rg`, `diff`）、テキスト処理（`jq`, `yq`, `sort`, `cut`）、Git 読み取り（`status`, `log`, `diff`, `branch`）、GitHub 読み取り（`pr view/list/checks`, `auth status`）、パッケージ情報（`npm list/audit`, `pip list`, `brew info`）、バージョン/ヘルプ（`--version`, `--help`）

### 評価順序の注意
- **高 → 中 → 低** の順で評価（`echo > file` が低リスクに誤判定されるのを防止）
- 中リスクセクション先頭に `_l: '低'` プロパティ付きで読み取り専用コマンドを配置（`brew info node` 等が `\bnode\b` に先にマッチするのを防止）

## Codex レビュー修正（8件）

### 初回レビュー（6件）
1. `rm -r` regex: `\brm\b.*-.*r` → `\brm\b.*-[a-zA-Z]*r[a-zA-Z]*\b`（`rm -f report.txt` 誤判定防止）
2. `kill` regex: `\bkillall?\b` → `\bkill(?:all)?\b`（`kill` 単体もマッチ）
3. JSON パースエラー: `process.exit(0)` → 中リスクフォールバック出力（fail-closed）
4. `sed -i` regex: `\bsed\s+(-[a-zA-Z]*)*i` → `\bsed\b.*\s-[a-zA-Z]*i\b`
5. `curl/wget` 説明矛盾: action "取得" vs risk "送信" → "送受信" + "通信します"
6. `TaskCreate/TaskUpdate`: "読み取り専用" → "Claude 内部のタスク管理のみ"

### 2回目レビュー（2件）
7. 複合コマンドガード追加: `cat a.txt; rm -rf /` が `Bash(cat:*)` で素通りするのを防止
8. 型チェック追加: `typeof entry !== 'string'` で非文字列エントリをスキップ

### 3回目レビュー（3件）
9. default モードでも allow リストを尊重: フックなしの挙動を維持（`permissionMode !== 'default'` 条件を削除）
10. 複合コマンドガードに改行 `\n` と単独 `&` を追加: allow バイパス攻撃を防止
11. `Array.isArray(allow)` チェック追加: `permissions.allow` が配列でない場合の防御

### 4回目レビュー（別セッション AI レビュー — 2件）
12. 複合コマンドチェックを最初の行のみに限定: ヒアドキュメント・複数行スクリプトで allow が正しく効くように
13. 低リスクは `process.exit(0)` でデフォルト判定に委ねる: `isAllowedBySettings()` パターン漏れのフォールバック

## 説明テキストの方針

- 非エンジニアにも分かりやすい日本語で記述
- 専門用語を避け、平易な表現を使用
- action（何をしようとしているか）と risk（その結果どうなるか）で別の情報を伝える
- 主な言い換え例:
  - 「再帰的に削除」→「まとめて削除」
  - 「コミット準備状態」→「保存対象に追加」
  - 「コードの競合」→「変更が衝突」
  - 「退避した変更」→「一時保存した変更」
  - 「コンパイル結果」→「変換されたファイル」
  - 「ビルド成果物」→「変換されたファイル」
  - 「シェル環境」→「ターミナルの設定」
  - 「ランタイム」→「動作環境」
  - 「SSH 鍵」→「サーバー接続用の認証キー」
  - 「E2E テスト」→「ブラウザを使った自動テスト」
  - 「不正なパッケージが混入」→「不正なソフトウェアが含まれる」

## 現在の状態

- **リポジトリ名**: `claude-code-explain-risk`
- **ライセンス**: MIT
- フック完成・ローカルインストール済み（`~/.claude/hooks/explain-risk.js`）
- Allow リスト連携実装・動作確認済み
- Permission Mode 対応（`default` / `acceptEdits` / `dontAsk` / `bypassPermissions`）実装・動作確認済み
- 低リスクは `process.exit(0)` でデフォルト判定に委ねる（中・高のみリスク説明表示）
- Codex レビュー 8件 + 別セッション AI レビュー 2件 = 計13件修正済み
- 説明テキスト非エンジニア向け見直し完了（25+ 箇所修正）
- 多言語対応（日本語/英語）実装・38テスト全通過（`LANG` 環境変数で自動切替）
- コマンドカバレッジ 150+ パターン
- install.sh / uninstall.sh は動作確認済み
- 公開準備ファイル作成済み（README.md、README.en.md、CONTRIBUTING.md、LICENSE、.gitignore）
- install.sh の URL を `wataame/claude-code-explain-risk` に更新済み
- **次のタスク**: GitHub リポジトリ作成・初回コミット・公開

## 開発時の注意

- フックを編集したら `~/.claude/hooks/explain-risk.js` にもコピーすること
  ```bash
  cp hooks/explain-risk.js ~/.claude/hooks/explain-risk.js
  ```
- フックのテストは以下のコマンドで可能（Claude Code の再起動不要）：
  ```bash
  echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | node hooks/explain-risk.js
  ```
- ANSI エスケープを除去して読みやすくする場合：
  ```bash
  echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | node hooks/explain-risk.js | \
    python3 -c "import sys,json,re; d=json.load(sys.stdin); print(re.sub(r'\x1b\[[0-9;]*m','',d['hookSpecificOutput']['permissionDecisionReason']))"
  ```
- settings.json の変更は Claude Code の再起動が必要
- nvm 環境では `node` がシェル関数の場合あり。テスト時は明示的にバイナリパスを使用：
  ```bash
  echo '...' | ~/.nvm/versions/node/v22.22.0/bin/node hooks/explain-risk.js
  ```

## ターミナル環境（表示確認用）

- アプリ: Ghostty（tmux モード）
- フォント: UDEV Gothic NF / 14pt
- テーマ: Dracula+
