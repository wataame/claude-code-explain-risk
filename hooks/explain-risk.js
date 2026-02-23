#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================
// 言語判定（LANG 環境変数で切り替え）
// ja で始まれば日本語、それ以外は英語（デフォルト）
// ============================================
const LANG = (process.env.LANG || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';

// ============================================
// カラー定義（ANSI 標準16色 — ターミナルテーマに自動で馴染む）
// ============================================
const COLORS = {
  low:   '\x1b[36m',  // Cyan（低リスク）
  mid:   '\x1b[33m',  // Yellow（中リスク）
  high:  '\x1b[31m',  // Red（高リスク）
  reset: '\x1b[0m',
};

// ============================================
// stdin から JSON を読み取る
// ============================================
let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  // JSON パースに失敗した場合は安全側に倒す（fail-closed）
  const fallbackReason = LANG === 'ja'
    ? '\x1b[33m\x1b[1m|| リスク: 中\x1b[22m\n入力の解析に失敗しました。\n操作内容を確認してください。\x1b[0m'
    : '\x1b[33m\x1b[1m|| Risk: Medium\x1b[22m\nFailed to parse input.\nPlease review the operation.\x1b[0m';
  const fallback = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: fallbackReason,
    },
  };
  process.stdout.write(JSON.stringify(fallback));
  process.exit(0);
}

const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};
const permissionMode = input.permission_mode || 'default';

// ============================================
// テキストヘルパー: { ja, en } から現在の言語のテキストを返す
// ============================================
function t(obj) {
  if (typeof obj === 'string') return obj;
  return obj[LANG] || obj.en;
}

// ============================================
// ユーザーの allow リストを尊重する
// Claude Code の settings.json に明示的に許可されたコマンドは介入しない
// ============================================

function isAllowedBySettings() {
  const home = os.homedir();
  const cwd = process.cwd();

  // 検索対象の settings ファイル（グローバル + プロジェクト階層）
  const settingsFiles = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
  ];

  // CWD から上位に向かって .claude/settings*.json を探す
  let dir = cwd;
  const seen = new Set();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    settingsFiles.push(
      path.join(dir, '.claude', 'settings.json'),
      path.join(dir, '.claude', 'settings.local.json'),
    );
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 各 settings の permissions.allow を確認
  for (const file of settingsFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const raw = data.permissions && data.permissions.allow;
      const allow = Array.isArray(raw) ? raw : [];
      for (const entry of allow) {
        // 型チェック: 文字列以外のエントリはスキップ
        if (typeof entry !== 'string') continue;

        // ツール単位の許可（例: "Bash" でBash全許可、"Task" 等）
        if (entry === toolName) return true;

        // パターン付き許可（例: "Bash(cat:*)"）
        const m = entry.match(/^(\w+)\((.+)\)$/);
        if (!m || m[1] !== toolName) continue;

        const pattern = m[2];

        if (toolName === 'Bash') {
          const cmd = toolInput.command || '';

          // 複合コマンド（; && || 単独&）は allow スキップしない
          // 例: "cat a.txt; rm -rf /" が Bash(cat:*) で素通りするのを防ぐ
          // パイプ(|)は除外 — ls | head 等の日常的な使用に影響するため
          // 最初の行のみでチェック — 改行以降はヒアドキュメントやスクリプト本文
          const firstLine = cmd.split('\n')[0];
          const stripped = firstLine.replace(/'[^']*'|"[^"]*"/g, '');
          if (/;|&&|\|\||(?<![&])&(?!&)/.test(stripped)) continue;

          // Bash コマンドのパターンマッチング
          // Claude Code 形式: "Bash(cat:*)" の : を空白に変換し、* をワイルドカードに
          const regexStr = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // regex 特殊文字をエスケープ（* 以外）
            .replace(/\*/g, '.*')                      // * → .*
            .replace(/:/g, '\\s*');                     // : → 空白マッチ
          try {
            if (new RegExp('^' + regexStr + '$', 's').test(cmd)) {
              return true;
            }
          } catch { /* invalid regex, skip */ }
        }
      }
    } catch { /* ファイルが存在しないか読み取れない場合はスキップ */ }
  }
  return false;
}

// -auto / bypassPermissions モードではフック介入不要（全て自動承認される前提）
if (permissionMode === 'dontAsk' || permissionMode === 'bypassPermissions') {
  process.exit(0);
}

// 全モード共通: ユーザーの settings.json で許可済みコマンドは自動承認
// フックがない時と同じ挙動を維持するため permissionDecision: 'allow' を返す
// 注: process.exit(0) ではフック登録時に自動承認が機能しないため明示的に 'allow' を使用
if (isAllowedBySettings()) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }));
  process.exit(0);
}

// ============================================
// 安全なツール（読み取り専用）はそのまま通す
// ============================================
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep',
  'WebSearch', 'WebFetch',
  'TaskList', 'TaskGet',
  'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
];

if (SAFE_TOOLS.includes(toolName)) {
  process.exit(0);
}

// ============================================
// リスク判定
// ============================================
// 返却値:
//   level: "低" | "中" | "高"
//   risk:  リスクの説明（何が起きうるか）
//   action: 操作の説明（何をしようとしているか）

function classify() {
  switch (toolName) {
    case 'Edit':
      return {
        level: '中',
        risk: t({ ja: 'ファイルの内容が変更されます', en: 'File contents will be modified' }),
        action: t({ ja: 'ファイルの一部を書き換えようとしています', en: 'Attempting to modify part of a file' }),
      };

    case 'Write':
      return {
        level: '中',
        risk: t({ ja: 'ファイルが上書きされる可能性があります', en: 'File may be overwritten' }),
        action: t({ ja: 'ファイルを新規作成または上書きしようとしています', en: 'Attempting to create or overwrite a file' }),
      };

    case 'NotebookEdit':
      return {
        level: '中',
        risk: t({ ja: 'ノートブックの内容が変更されます', en: 'Notebook contents will be modified' }),
        action: t({ ja: 'Jupyter ノートブックを編集しようとしています', en: 'Attempting to edit a Jupyter notebook' }),
      };

    case 'Bash':
      return classifyBash(toolInput.command || '');

    case 'Task':
      return {
        level: '低',
        risk: t({ ja: '読み取り専用の操作です', en: 'Read-only operation' }),
        action: t({ ja: '別の AI エージェントに作業を依頼しようとしています', en: 'Attempting to delegate work to another AI agent' }),
      };

    case 'TaskCreate':
    case 'TaskUpdate':
      return {
        level: '低',
        risk: t({ ja: 'Claude 内部のタスク管理のみで、ファイルへの影響はありません', en: 'Internal task management only, no file impact' }),
        action: t({ ja: 'タスクリストを更新しようとしています', en: 'Attempting to update the task list' }),
      };

    default:
      if (toolName.startsWith('mcp__')) {
        const shortName = toolName.replace(/^mcp__\w+__/, '');
        return {
          level: '中',
          risk: t({ ja: '外部サービスと通信します', en: 'Communicates with an external service' }),
          action: t({ ja: `外部ツール（${shortName}）を呼び出そうとしています`, en: `Attempting to call external tool (${shortName})` }),
        };
      }
      return {
        level: '中',
        risk: t({ ja: '操作内容を確認してください', en: 'Please review the operation' }),
        action: t({ ja: `${toolName} を実行しようとしています`, en: `Attempting to execute ${toolName}` }),
      };
  }
}

// ============================================
// Bash コマンドの詳細分類
// ============================================

function classifyBash(command) {
  const cmd = command.trim();

  // =============================================
  // 評価順序: 高リスク → 中リスク → 低リスク
  // 高リスクを最初に評価し、echo > file や find -delete 等の
  // 複合コマンドが低リスクに誤判定されるのを防ぐ
  // =============================================

  // --- 🔴 高リスク（削除・送信・管理者・不可逆操作） ---
  const highRisk = [
    // ファイル削除
    { p: /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*\b/, r: { ja: '削除されたファイルは復元できません', en: 'Deleted files cannot be recovered' }, a: { ja: 'ファイルやフォルダをまとめて削除しようとしています', en: 'Attempting to recursively delete files and folders' } },
    { p: /\brm\s/,                          r: { ja: '削除されたファイルは復元できません', en: 'Deleted files cannot be recovered' }, a: { ja: 'ファイルを削除しようとしています', en: 'Attempting to delete files' } },
    { p: /\bfind\b.*-delete\b/,             r: { ja: '削除されたファイルは復元できません', en: 'Deleted files cannot be recovered' }, a: { ja: 'ファイルを検索して削除しようとしています', en: 'Attempting to find and delete files' } },
    { p: /\bfind\b.*-exec\b/,              r: { ja: '見つかったファイルに対して何でも実行できてしまいます', en: 'Arbitrary commands can be executed on found files' }, a: { ja: '見つかったファイルに対してコマンドを実行しようとしています', en: 'Attempting to execute commands on found files' } },
    { p: /\btruncate\b/,                    r: { ja: 'ファイルの内容が失われます', en: 'File contents will be lost' }, a: { ja: 'ファイルの中身を空にしようとしています', en: 'Attempting to truncate a file' } },
    // Git（不可逆・外部送信）
    { p: /\bgit\s+push\s+.*--force\b/,      r: { ja: '他の人の作業が消える可能性があります', en: "Others' work may be lost" }, a: { ja: 'Git の履歴を強制上書きしようとしています', en: 'Attempting to force-push Git history' } },
    { p: /\bgit\s+push\b/,                  r: { ja: '他のメンバーの作業に影響する可能性があります', en: "May affect other team members' work" }, a: { ja: 'コードをリモート（GitHub等）に送信しようとしています', en: 'Attempting to push code to remote (GitHub, etc.)' } },
    { p: /\bgit\s+reset\s+--hard\b/,        r: { ja: '未保存の変更が失われます', en: 'Unsaved changes will be lost' }, a: { ja: '変更履歴を強制的に巻き戻そうとしています', en: 'Attempting to hard reset Git history' } },
    { p: /\bgit\s+clean\b/,                 r: { ja: '削除されたファイルは復元できません', en: 'Deleted files cannot be recovered' }, a: { ja: 'Git で管理されていないファイルをまとめて削除しようとしています', en: 'Attempting to delete untracked files' } },
    { p: /\bgit\s+(checkout|restore)\s+\./, r: { ja: '未保存の変更が失われます', en: 'Unsaved changes will be lost' }, a: { ja: '変更中のファイルを元に戻そうとしています', en: 'Attempting to discard local changes' } },
    { p: /\bgit\s+branch\s+.*-D\b/,         r: { ja: 'ブランチが強制削除されます', en: 'Branch will be force-deleted' }, a: { ja: 'Git ブランチを強制削除しようとしています', en: 'Attempting to force-delete a Git branch' } },
    { p: /\bgit\s+stash\s+(clear|drop)\b/,  r: { ja: '一時保存した変更が完全に削除されます', en: 'Stashed changes will be permanently deleted' }, a: { ja: '一時保存した作業内容を削除しようとしています', en: 'Attempting to delete stashed work' } },
    // GitHub CLI（不可逆）
    { p: /\bgh\s+pr\s+merge\b/,             r: { ja: 'プルリクエストがマージされます', en: 'Pull request will be merged' }, a: { ja: 'GitHub のプルリクエストをマージしようとしています', en: 'Attempting to merge a GitHub pull request' } },
    // 管理者・システム
    { p: /\bsudo\b/,                         r: { ja: 'システム全体に影響する可能性があります', en: 'May affect the entire system' }, a: { ja: '管理者権限でコマンドを実行しようとしています', en: 'Attempting to run a command with admin privileges' } },
    { p: /\bsystemctl\b/,                   r: { ja: 'システムサービスの動作が変わります', en: 'System service behavior will change' }, a: { ja: 'システムサービスを操作しようとしています', en: 'Attempting to manage a system service' } },
    { p: /\blaunchctl\b/,                   r: { ja: 'システムサービスの動作が変わります', en: 'System service behavior will change' }, a: { ja: 'macOS サービスを操作しようとしています', en: 'Attempting to manage a macOS service' } },
    { p: /\b(reboot|shutdown)\b/,           r: { ja: 'システムが停止します', en: 'System will shut down' }, a: { ja: 'システムを再起動またはシャットダウンしようとしています', en: 'Attempting to reboot or shut down the system' } },
    // 外部スクリプト実行
    { p: /\bcurl\b.*\|\s*(bash|sh)\b/,       r: { ja: '悪意あるコードが実行される危険があります', en: 'Risk of executing malicious code' }, a: { ja: 'ネットからダウンロードしたスクリプトを実行しようとしています', en: 'Attempting to pipe a downloaded script to shell' } },
    { p: /\bwget\b.*\|\s*(bash|sh)\b/,       r: { ja: '悪意あるコードが実行される危険があります', en: 'Risk of executing malicious code' }, a: { ja: 'ネットからダウンロードしたスクリプトを実行しようとしています', en: 'Attempting to pipe a downloaded script to shell' } },
    // 権限・所有者
    { p: /\bchmod\b/,                        r: { ja: 'セキュリティ設定が変わる可能性があります', en: 'Security settings may change' }, a: { ja: 'ファイルの読み書き権限を変更しようとしています', en: 'Attempting to change file permissions' } },
    { p: /\bchown\b/,                        r: { ja: 'セキュリティ設定が変わる可能性があります', en: 'Security settings may change' }, a: { ja: 'ファイルの所有者を変更しようとしています', en: 'Attempting to change file ownership' } },
    // プロセス
    { p: /\bkill(?:all)?\b/,                  r: { ja: '保存されていないデータが失われる可能性があります', en: 'Unsaved data may be lost' }, a: { ja: '実行中のプログラムを強制終了しようとしています', en: 'Attempting to terminate a running process' } },
    // リモート接続・ファイル転送（ssh-keygen等はローカル操作なので中リスクで先にマッチ）
    { p: /\bsshpass\b/,                      r: { ja: '外部サーバー上で操作が行われます', en: 'Operations will be performed on a remote server' }, a: { ja: '別のサーバーにパスワード付きで接続しようとしています', en: 'Attempting to connect to a server with a password' } },
    { p: /\bssh\s/,                          r: { ja: '外部サーバー上で操作が行われます', en: 'Operations will be performed on a remote server' }, a: { ja: '別のサーバーに接続しようとしています', en: 'Attempting to connect to a remote server' } },
    { p: /\bscp\b/,                          r: { ja: '外部サーバーとファイルが転送されます', en: 'Files will be transferred to/from a remote server' }, a: { ja: 'リモートサーバーとファイルを転送しようとしています', en: 'Attempting to transfer files via SCP' } },
    { p: /\brsync\b/,                        r: { ja: '外部サーバーとファイルが同期されます', en: 'Files will be synced with a remote server' }, a: { ja: 'ファイルを同期しようとしています', en: 'Attempting to sync files via rsync' } },
    // ファイル直接書き換え
    { p: /\bsed\b.*\s-[a-zA-Z]*i\b/,         r: { ja: 'ファイルの内容が直接変更されます', en: 'File contents will be modified in-place' }, a: { ja: 'ファイルの内容を直接書き換えようとしています', en: 'Attempting to edit a file in-place with sed' } },
    // 危険なコマンド
    { p: /\bdd\b/,                           r: { ja: 'ディスクのデータが上書きされる可能性があります', en: 'Disk data may be overwritten' }, a: { ja: 'ディスクに直接データを書き込もうとしています', en: 'Attempting to write directly to disk' } },
    { p: /\beval\b/,                         r: { ja: '意図しないコマンドが実行される可能性があります', en: 'Unintended commands may be executed' }, a: { ja: '文字列からコマンドを組み立てて実行しようとしています', en: 'Attempting to construct and execute a command from a string' } },
    { p: /\bcrontab\b/,                      r: { ja: '定期実行タスクが変更されます', en: 'Scheduled tasks will be modified' }, a: { ja: '定期実行タスクの設定を変更しようとしています', en: 'Attempting to modify crontab' } },
    // パッケージ公開
    { p: /\bnpm\s+publish\b/,                r: { ja: '公開すると取り消せません', en: 'Publishing cannot be undone' }, a: { ja: 'npm パッケージを公開しようとしています', en: 'Attempting to publish an npm package' } },
    // リダイレクト書き込み（echo > file 等をキャッチ、>/dev/null と 2>/dev/null は除外）
    { p: /(?<![2&])>>?\s*(?!\/dev\/null)[^\s]/,  r: { ja: '既存の内容が消える可能性があります', en: 'Existing contents may be overwritten' }, a: { ja: 'ファイルに書き込みをしようとしています', en: 'Attempting to write to a file via redirection' } },
  ];
  for (const { p, r, a } of highRisk) {
    if (p.test(cmd)) {
      return { level: '高', risk: t(r), action: t(a) };
    }
  }

  // --- 🟡 中リスク（変更・実行・通信） ---
  const mediumRisk = [
    // === 読み取り専用コマンド（低リスク相当だが、汎用パターンより先にマッチ必要） ===
    // brew info/list 等は \bnode\b 等より先に評価する必要がある
    { p: /\bnpm\s+(list|ls|outdated|audit|info|show|view)\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'npm パッケージの情報を確認しようとしています', en: 'Checking npm package information' }, _l: '低' },
    { p: /\bpip3?\s+(list|show|freeze)\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'Python パッケージの情報を確認しようとしています', en: 'Checking Python package information' }, _l: '低' },
    { p: /\bbrew\s+(list|info|search|config)\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'Homebrew の情報を確認しようとしています', en: 'Checking Homebrew information' }, _l: '低' },
    { p: /\byarn\s+(list|info|why)\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'yarn パッケージの情報を確認しようとしています', en: 'Checking yarn package information' }, _l: '低' },
    { p: /^\s*command\s+-v\b/,               r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コマンドの場所を調べようとしています', en: 'Looking up command location' }, _l: '低' },
    { p: /^\s*which\b/,                      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コマンドの場所を調べようとしています', en: 'Looking up command location' }, _l: '低' },
    { p: /^\s*type\b/,                       r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コマンドの種類を調べようとしています', en: 'Looking up command type' }, _l: '低' },
    // SSH（ローカル操作 — 高リスクの ssh 接続より先にマッチさせる）
    { p: /\bssh-keygen\b/,                   r: { ja: '既存のキーが上書きされる可能性があります', en: 'Existing keys may be overwritten' }, a: { ja: 'サーバー接続用の認証キーを作成しようとしています', en: 'Attempting to generate an SSH key' } },
    { p: /\bssh-add\b/,                      r: { ja: 'サーバーへの接続が可能になります', en: 'Server connections will be enabled' }, a: { ja: 'サーバー接続用の認証キーを登録しようとしています', en: 'Attempting to add an SSH key to the agent' } },
    { p: /\bssh-agent\b/,                    r: { ja: 'サーバーへの接続が可能になります', en: 'Server connections will be enabled' }, a: { ja: 'サーバー接続用の認証キー管理を起動しようとしています', en: 'Attempting to start the SSH agent' } },
    // パッケージ管理
    { p: /\bnpm\s+(ci|install)\b/,           r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'npm パッケージをインストールしようとしています', en: 'Attempting to install npm packages' } },
    { p: /\bnpm\s+uninstall\b/,             r: { ja: 'ソフトウェアが削除されます', en: 'Software will be removed' }, a: { ja: 'npm パッケージを削除しようとしています', en: 'Attempting to uninstall npm packages' } },
    { p: /\bnpm\s+(init|create)\b/,          r: { ja: 'プロジェクト設定が変更されます', en: 'Project configuration will be modified' }, a: { ja: '新しいプロジェクトを作成しようとしています', en: 'Attempting to create a new project' } },
    { p: /\bnpm\s+exec\b/,                   r: { ja: '意図しないコードが実行される可能性があります', en: 'Unintended code may be executed' }, a: { ja: '外部ツールをダウンロードして実行しようとしています', en: 'Attempting to download and execute an external tool' } },
    { p: /\byarn\s+(add|install)\b/,        r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'yarn パッケージをインストールしようとしています', en: 'Attempting to install yarn packages' } },
    { p: /\bpnpm\s+(add|install)\b/,        r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'pnpm パッケージをインストールしようとしています', en: 'Attempting to install pnpm packages' } },
    { p: /\bpip3?\s+install\b/,             r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Python パッケージをインストールしようとしています', en: 'Attempting to install Python packages' } },
    { p: /\bpip3?\s+uninstall\b/,           r: { ja: 'ソフトウェアが削除されます', en: 'Software will be removed' }, a: { ja: 'Python パッケージを削除しようとしています', en: 'Attempting to uninstall Python packages' } },
    { p: /\buv\s+(pip|add|sync|run)\b/,     r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Python パッケージを管理しようとしています', en: 'Attempting to manage Python packages via uv' } },
    { p: /\bpoetry\s+(install|add|run|build)\b/, r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Python パッケージを管理しようとしています', en: 'Attempting to manage Python packages via Poetry' } },
    { p: /\bconda\s+(install|create)\b/,    r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Conda パッケージを管理しようとしています', en: 'Attempting to manage Conda packages' } },
    { p: /\bbrew\s+install\b/,              r: { ja: 'システム構成が変更されます', en: 'System configuration will change' }, a: { ja: 'Homebrew でソフトウェアをインストールしようとしています', en: 'Attempting to install software via Homebrew' } },
    { p: /\bbrew\s+uninstall\b/,            r: { ja: 'ソフトウェアが削除されます', en: 'Software will be removed' }, a: { ja: 'Homebrew でソフトウェアを削除しようとしています', en: 'Attempting to uninstall software via Homebrew' } },
    { p: /\bgem\s+install\b/,              r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Ruby パッケージをインストールしようとしています', en: 'Attempting to install a Ruby gem' } },
    { p: /\bcargo\s+install\b/,            r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Rust パッケージをインストールしようとしています', en: 'Attempting to install a Rust crate' } },
    { p: /\bgo\s+install\b/,              r: { ja: '不正なソフトウェアが含まれる可能性があります', en: 'Malicious software may be included' }, a: { ja: 'Go パッケージをインストールしようとしています', en: 'Attempting to install a Go package' } },
    // Git 操作
    { p: /\bgit\s+add\b/,                   r: { ja: '意図しないファイルが含まれる可能性があります', en: 'Unintended files may be staged' }, a: { ja: '変更したファイルを保存対象に追加しようとしています', en: 'Attempting to stage files for commit' } },
    { p: /\bgit\s+commit\b/,                r: { ja: '変更内容が確定されます', en: 'Changes will be committed' }, a: { ja: 'コードの変更を記録しようとしています', en: 'Attempting to commit changes' } },
    { p: /\bgit\s+checkout\b/,              r: { ja: '未保存の変更が失われる可能性があります', en: 'Unsaved changes may be lost' }, a: { ja: 'ブランチを切り替えようとしています', en: 'Attempting to switch branches' } },
    { p: /\bgit\s+switch\b/,               r: { ja: '未保存の変更が失われる可能性があります', en: 'Unsaved changes may be lost' }, a: { ja: 'ブランチを切り替えようとしています', en: 'Attempting to switch branches' } },
    { p: /\bgit\s+merge\b/,                 r: { ja: '変更が衝突する可能性があります', en: 'Merge conflicts may occur' }, a: { ja: '別のブランチの変更を取り込もうとしています', en: 'Attempting to merge another branch' } },
    { p: /\bgit\s+pull\b/,                 r: { ja: '変更が衝突する可能性があります', en: 'Merge conflicts may occur' }, a: { ja: 'リモートの変更をダウンロードして取り込もうとしています', en: 'Attempting to pull remote changes' } },
    { p: /\bgit\s+clone\b/,                r: { ja: 'ディスク容量を使用します', en: 'Disk space will be used' }, a: { ja: 'Git リポジトリをダウンロードしようとしています', en: 'Attempting to clone a Git repository' } },
    { p: /\bgit\s+stash\b/,                 r: { ja: '一時保存した変更を忘れる可能性があります', en: 'Stashed changes may be forgotten' }, a: { ja: '作業中の変更を一時保存しようとしています', en: 'Attempting to stash changes' } },
    { p: /\bgit\s+rebase\b/,                r: { ja: '変更の履歴が衝突する可能性があります', en: 'History conflicts may occur' }, a: { ja: '変更の記録を並べ替えようとしています', en: 'Attempting to rebase commits' } },
    { p: /\bgit\s+worktree\b/,              r: { ja: '並行作業用のフォルダが追加・削除されます', en: 'Worktree folders will be added or removed' }, a: { ja: '並行作業用フォルダを操作しようとしています', en: 'Attempting to manage Git worktrees' } },
    { p: /\bgit\s+cherry-pick\b/,           r: { ja: '変更が衝突する可能性があります', en: 'Merge conflicts may occur' }, a: { ja: '別の作業ブランチの変更を取り込もうとしています', en: 'Attempting to cherry-pick a commit' } },
    { p: /\bgit\s+(am|apply)\b/,            r: { ja: 'ファイルが変更される可能性があります', en: 'Files may be modified' }, a: { ja: '変更差分をファイルに反映しようとしています', en: 'Attempting to apply a patch' } },
    // GitHub CLI（書き込み系 — 読み取り系は低リスクセクションでマッチ）
    { p: /\bgh\s+pr\s+create\b/,            r: { ja: 'GitHub にプルリクエストが作成されます', en: 'A pull request will be created on GitHub' }, a: { ja: 'GitHub にプルリクエストを作成しようとしています', en: 'Attempting to create a GitHub pull request' } },
    { p: /\bgh\s+issue\s+create\b/,         r: { ja: 'GitHub に Issue が作成されます', en: 'An issue will be created on GitHub' }, a: { ja: 'GitHub に Issue を作成しようとしています', en: 'Attempting to create a GitHub issue' } },
    { p: /\bgh\s+(pr|issue)\s+close\b/,     r: { ja: 'GitHub 上のアイテムが閉じられます', en: 'A GitHub item will be closed' }, a: { ja: 'GitHub の Issue / PR を閉じようとしています', en: 'Attempting to close a GitHub issue or PR' } },
    { p: /\bgh\s+release\s+create\b/,       r: { ja: 'GitHub にリリースが作成されます', en: 'A release will be created on GitHub' }, a: { ja: 'GitHub にリリースを作成しようとしています', en: 'Attempting to create a GitHub release' } },
    { p: /\bgh\s+repo\s+(clone|fork)\b/,    r: { ja: 'ディスク容量を使用します', en: 'Disk space will be used' }, a: { ja: 'GitHub リポジトリをコピーしようとしています', en: 'Attempting to clone or fork a GitHub repository' } },
    { p: /\bgh\s+api\b/,                     r: { ja: 'GitHub API にリクエストが送信されます', en: 'A request will be sent to the GitHub API' }, a: { ja: 'GitHub API を呼び出そうとしています', en: 'Attempting to call the GitHub API' } },
    // ファイル操作
    { p: /\bmkdir\b/,                        r: { ja: 'ディスク容量を使用します', en: 'Disk space will be used' }, a: { ja: '新しいフォルダを作成しようとしています', en: 'Attempting to create a directory' } },
    { p: /\btouch\b/,                        r: { ja: '同名ファイルの日時が変わる可能性があります', en: 'File timestamps may change' }, a: { ja: '新しい空ファイルを作成しようとしています', en: 'Attempting to create an empty file' } },
    { p: /\bcp\b/,                           r: { ja: '同名ファイルが上書きされる可能性があります', en: 'Existing files may be overwritten' }, a: { ja: 'ファイルをコピーしようとしています', en: 'Attempting to copy files' } },
    { p: /\bmv\b/,                           r: { ja: '元の場所からファイルがなくなります', en: 'Files will be removed from their original location' }, a: { ja: 'ファイルを移動しようとしています', en: 'Attempting to move files' } },
    { p: /\bln\b/,                           r: { ja: 'リンク先を誤ると混乱の原因になります', en: 'Incorrect links can cause confusion' }, a: { ja: 'リンクを作成しようとしています', en: 'Attempting to create a link' } },
    { p: /\btee\b/,                          r: { ja: 'ファイルに書き込まれます', en: 'Output will be written to a file' }, a: { ja: '出力をファイルに書き込みながら表示しようとしています', en: 'Attempting to write output to a file via tee' } },
    // アーカイブ
    { p: /\btar\b/,                          r: { ja: 'ファイルが展開または圧縮されます', en: 'Files will be extracted or compressed' }, a: { ja: 'アーカイブファイルを操作しようとしています', en: 'Attempting to work with an archive file' } },
    { p: /\bunzip\b/,                        r: { ja: '同名ファイルが上書きされる可能性があります', en: 'Existing files may be overwritten' }, a: { ja: 'ZIP ファイルを展開しようとしています', en: 'Attempting to extract a ZIP file' } },
    { p: /\bzip\b/,                          r: { ja: 'ディスク容量を使用します', en: 'Disk space will be used' }, a: { ja: 'ファイルを ZIP 圧縮しようとしています', en: 'Attempting to create a ZIP archive' } },
    { p: /\bg(un)?zip\b/,                   r: { ja: 'ファイルが圧縮または展開されます', en: 'Files will be compressed or extracted' }, a: { ja: 'ファイルを圧縮・展開しようとしています', en: 'Attempting to compress or extract files' } },
    // スクリプト・プログラム実行
    { p: /\bnpx\b/,                          r: { ja: '意図しないコードが実行される可能性があります', en: 'Unintended code may be executed' }, a: { ja: '外部ツールをダウンロードして実行しようとしています', en: 'Attempting to download and execute an external tool' } },
    { p: /\bnpm\s+(run|start|test)\b/,      r: { ja: '意図しないコードが実行される可能性があります', en: 'Unintended code may be executed' }, a: { ja: 'プロジェクトのスクリプトを実行しようとしています', en: 'Attempting to run a project script' } },
    { p: /\byarn\s+(run|dev|start|test|build)\b/, r: { ja: '意図しないコードが実行される可能性があります', en: 'Unintended code may be executed' }, a: { ja: 'プロジェクトのスクリプトを実行しようとしています', en: 'Attempting to run a project script' } },
    { p: /\bpnpm\s+(run|dev|start|test|build)\b/, r: { ja: '意図しないコードが実行される可能性があります', en: 'Unintended code may be executed' }, a: { ja: 'プロジェクトのスクリプトを実行しようとしています', en: 'Attempting to run a project script' } },
    { p: /\bnode\b/,                         r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'JavaScript のプログラムを実行しようとしています', en: 'Attempting to run a JavaScript program' } },
    { p: /\bbun\b/,                          r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Bun でプログラムを実行しようとしています', en: 'Attempting to run a program with Bun' } },
    { p: /\bdeno\b/,                         r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Deno でプログラムを実行しようとしています', en: 'Attempting to run a program with Deno' } },
    { p: /\bpython3?\b/,                    r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Python のプログラムを実行しようとしています', en: 'Attempting to run a Python program' } },
    { p: /\bruby\b/,                         r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Ruby のプログラムを実行しようとしています', en: 'Attempting to run a Ruby program' } },
    { p: /\bperl\b/,                         r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Perl のプログラムを実行しようとしています', en: 'Attempting to run a Perl program' } },
    { p: /\bswift\b/,                        r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'Swift のプログラムを実行しようとしています', en: 'Attempting to run a Swift program' } },
    // テスト・E2E
    { p: /\b(jest|vitest|mocha)\b/,          r: { ja: 'テスト中にファイルが変更される場合があります', en: 'Files may be modified during testing' }, a: { ja: 'JavaScript のテストを実行しようとしています', en: 'Attempting to run JavaScript tests' } },
    { p: /\bpytest\b/,                       r: { ja: 'テスト中にファイルが変更される場合があります', en: 'Files may be modified during testing' }, a: { ja: 'Python のテストを実行しようとしています', en: 'Attempting to run Python tests' } },
    { p: /\bcargo\s+test\b/,                r: { ja: 'テスト中にファイルが変更される場合があります', en: 'Files may be modified during testing' }, a: { ja: 'Rust のテストを実行しようとしています', en: 'Attempting to run Rust tests' } },
    { p: /\bgo\s+test\b/,                   r: { ja: 'テスト中にファイルが変更される場合があります', en: 'Files may be modified during testing' }, a: { ja: 'Go のテストを実行しようとしています', en: 'Attempting to run Go tests' } },
    { p: /\b(playwright|cypress)\b/,         r: { ja: 'ブラウザが操作され、ファイルが変更される場合があります', en: 'Browser will be controlled and files may be modified' }, a: { ja: 'ブラウザを使った自動テストを実行しようとしています', en: 'Attempting to run browser-based automated tests' } },
    // ビルド
    { p: /\bmake\b/,                         r: { ja: '変換されたファイルが生成されます', en: 'Build artifacts will be generated' }, a: { ja: 'プロジェクトをビルドしようとしています', en: 'Attempting to build the project' } },
    { p: /\bcmake\b/,                        r: { ja: 'プロジェクトの設定ファイルが生成されます', en: 'Build configuration files will be generated' }, a: { ja: 'ビルド設定を生成しようとしています', en: 'Attempting to generate build configuration' } },
    { p: /\bcargo\s+build\b/,               r: { ja: '変換されたファイルが生成されます', en: 'Build artifacts will be generated' }, a: { ja: 'Rust プロジェクトをビルドしようとしています', en: 'Attempting to build a Rust project' } },
    { p: /\bgo\s+build\b/,                  r: { ja: '変換されたファイルが生成されます', en: 'Build artifacts will be generated' }, a: { ja: 'Go プロジェクトをビルドしようとしています', en: 'Attempting to build a Go project' } },
    { p: /\btsc\b/,                          r: { ja: '変換されたファイルが生成されます', en: 'Compiled files will be generated' }, a: { ja: 'TypeScript を JavaScript に変換しようとしています', en: 'Attempting to compile TypeScript' } },
    { p: /\b(webpack|vite|esbuild)\b/,      r: { ja: '変換されたファイルが生成されます', en: 'Bundled files will be generated' }, a: { ja: 'JavaScript ファイルをまとめて変換しようとしています', en: 'Attempting to bundle JavaScript files' } },
    { p: /\bxcrun\b/,                        r: { ja: '変換されたファイルが生成される可能性があります', en: 'Build artifacts may be generated' }, a: { ja: 'Xcode のコマンドラインツールを実行しようとしています', en: 'Attempting to run Xcode command-line tools' } },
    { p: /\bxcodebuild\b/,                  r: { ja: '変換されたファイルが生成される可能性があります', en: 'Build artifacts may be generated' }, a: { ja: 'Xcode でプロジェクトをビルドしようとしています', en: 'Attempting to build with Xcode' } },
    // リンター・フォーマッター
    { p: /\b(eslint|prettier)\b/,           r: { ja: 'コードが自動修正される場合があります', en: 'Code may be auto-fixed' }, a: { ja: 'コードをチェック・整形しようとしています', en: 'Attempting to lint or format code' } },
    { p: /\b(ruff|black|flake8|mypy)\b/,    r: { ja: 'コードが自動修正される場合があります', en: 'Code may be auto-fixed' }, a: { ja: 'Python コードをチェック・整形しようとしています', en: 'Attempting to lint or format Python code' } },
    { p: /\brubocop\b/,                      r: { ja: 'コードが自動修正される場合があります', en: 'Code may be auto-fixed' }, a: { ja: 'Ruby コードをチェックしようとしています', en: 'Attempting to lint Ruby code' } },
    // サーバー起動
    { p: /\b(flask|uvicorn|gunicorn)\b/,    r: { ja: 'ローカルサーバーが起動されます', en: 'A local server will start' }, a: { ja: 'Python Web サーバーを起動しようとしています', en: 'Attempting to start a Python web server' } },
    { p: /\bnext\b/,                         r: { ja: 'ローカルサーバーが起動されます', en: 'A local server will start' }, a: { ja: 'Next.js サーバーを起動しようとしています', en: 'Attempting to start a Next.js server' } },
    // データベース
    { p: /\bpsql\b/,                         r: { ja: 'データベースのデータが変更される可能性があります', en: 'Database data may be modified' }, a: { ja: 'PostgreSQL データベースを操作しようとしています', en: 'Attempting to access PostgreSQL' } },
    { p: /\bmysql\b/,                        r: { ja: 'データベースのデータが変更される可能性があります', en: 'Database data may be modified' }, a: { ja: 'MySQL データベースを操作しようとしています', en: 'Attempting to access MySQL' } },
    { p: /\bsqlite3\b/,                     r: { ja: 'データベースのデータが変更される可能性があります', en: 'Database data may be modified' }, a: { ja: 'SQLite データベースを操作しようとしています', en: 'Attempting to access SQLite' } },
    { p: /\bredis-cli\b/,                   r: { ja: 'データベースのデータが変更される可能性があります', en: 'Database data may be modified' }, a: { ja: 'Redis データベースを操作しようとしています', en: 'Attempting to access Redis' } },
    // コンテナ
    { p: /\bdocker[\s-]compose\b/,          r: { ja: 'システムリソースが使用されます', en: 'System resources will be used' }, a: { ja: 'Docker Compose でコンテナを管理しようとしています', en: 'Attempting to manage containers with Docker Compose' } },
    { p: /\bdocker\b/,                       r: { ja: 'システムリソースが使用されます', en: 'System resources will be used' }, a: { ja: 'Docker コンテナを操作しようとしています', en: 'Attempting to manage Docker containers' } },
    { p: /\bkubectl\b/,                      r: { ja: 'クラスター上のリソースが変更される可能性があります', en: 'Cluster resources may be modified' }, a: { ja: 'Kubernetes クラスターを操作しようとしています', en: 'Attempting to manage Kubernetes resources' } },
    // ネットワーク通信
    { p: /\bcurl\b/,                         r: { ja: '外部サーバーと通信します', en: 'Communicates with an external server' }, a: { ja: 'インターネットとデータを送受信しようとしています', en: 'Attempting to send/receive data over the internet' } },
    { p: /\bwget\b/,                         r: { ja: '外部サーバーと通信します', en: 'Communicates with an external server' }, a: { ja: 'インターネットからファイルをダウンロードしようとしています', en: 'Attempting to download a file from the internet' } },
    // デプロイ・クラウド
    { p: /\bfirebase\s+deploy\b/,            r: { ja: '本番環境にデプロイされます', en: 'Will be deployed to production' }, a: { ja: 'Firebase にデプロイしようとしています', en: 'Attempting to deploy to Firebase' } },
    { p: /\b(vercel|netlify)\b/,             r: { ja: '本番環境にデプロイされる可能性があります', en: 'May be deployed to production' }, a: { ja: 'クラウドサービスを操作しようとしています', en: 'Attempting to use a cloud service' } },
    { p: /\b(gcloud|gsutil|bq)\b/,           r: { ja: 'クラウドリソースが変更される可能性があります', en: 'Cloud resources may be modified' }, a: { ja: 'Google Cloud を操作しようとしています', en: 'Attempting to use Google Cloud' } },
    { p: /\b(terraform|pulumi)\b/,           r: { ja: 'インフラ構成が変更されます', en: 'Infrastructure configuration will change' }, a: { ja: 'インフラ構成を変更しようとしています', en: 'Attempting to modify infrastructure' } },
    // メディア処理
    { p: /\bffmpeg\b/,                       r: { ja: 'メディアファイルが変換・生成されます', en: 'Media files will be converted or generated' }, a: { ja: '動画・音声ファイルを変換しようとしています', en: 'Attempting to convert audio/video files' } },
    // バージョン管理
    { p: /\b(nvm|pyenv|rbenv)\b/,           r: { ja: '動作環境のバージョンが切り替わります', en: 'Runtime version will change' }, a: { ja: 'プログラミング言語のバージョンを切り替えようとしています', en: 'Attempting to switch language runtime version' } },
    // シェル・スクリプト
    { p: /\bexpect\b/,                       r: { ja: '意図しない入力が自動送信される可能性があります', en: 'Unintended input may be sent automatically' }, a: { ja: 'キーボード入力を自動化して操作しようとしています', en: 'Attempting to automate interactive input' } },
    { p: /\bosascript\b/,                   r: { ja: 'macOS 上で自動操作が行われます', en: 'Automated actions will be performed on macOS' }, a: { ja: 'AppleScript を実行しようとしています', en: 'Attempting to run AppleScript' } },
    { p: /\bsource\b/,                      r: { ja: 'ターミナルの設定が変更される可能性があります', en: 'Shell environment may change' }, a: { ja: 'スクリプトを読み込もうとしています', en: 'Attempting to source a script' } },
    { p: /\b(bash|sh|zsh)\b/,              r: { ja: 'ファイル変更やデータ送信の可能性があります', en: 'May modify files or send data' }, a: { ja: 'シェルスクリプトを実行しようとしています', en: 'Attempting to run a shell script' } },
    // その他
    { p: /\bopen\b/,                         r: { ja: '外部アプリケーションが起動します', en: 'An external application will launch' }, a: { ja: 'ファイルまたは URL を開こうとしています', en: 'Attempting to open a file or URL' } },
    { p: /\bsed\b/,                          r: { ja: 'テキスト処理が実行されます', en: 'Text processing will be performed' }, a: { ja: 'テキスト変換処理を実行しようとしています', en: 'Attempting to process text with sed' } },
    { p: /\bawk\b/,                          r: { ja: 'テキスト処理が実行されます', en: 'Text processing will be performed' }, a: { ja: 'テキスト処理を実行しようとしています', en: 'Attempting to process text with awk' } },
  ];
  for (const { p, r, a, _l } of mediumRisk) {
    if (p.test(cmd)) {
      return { level: _l || '中', risk: t(r), action: t(a) };
    }
  }

  // --- 🟢 低リスク（情報表示のみ） ---
  const safeCmds = [
    // 基本コマンド
    { p: /^\s*ls\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの一覧を表示しようとしています', en: 'Listing files' } },
    { p: /^\s*pwd\s*$/,     r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '現在のフォルダの場所を確認しようとしています', en: 'Checking current directory' } },
    { p: /^\s*cd\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'フォルダを移動しようとしています', en: 'Changing directory' } },
    { p: /^\s*echo\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'テキストを表示しようとしています', en: 'Displaying text' } },
    { p: /^\s*cat\b/,       r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの中身を表示しようとしています', en: 'Displaying file contents' } },
    { p: /^\s*head\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの先頭を表示しようとしています', en: 'Displaying beginning of file' } },
    { p: /^\s*tail\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの末尾を表示しようとしています', en: 'Displaying end of file' } },
    { p: /^\s*wc\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの行数を数えようとしています', en: 'Counting lines in a file' } },
    { p: /^\s*tree\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'フォルダ構造を表示しようとしています', en: 'Displaying directory tree' } },
    { p: /^\s*date\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '現在の日時を表示しようとしています', en: 'Displaying current date and time' } },
    { p: /^\s*which\b/,     r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コマンドの場所を調べようとしています', en: 'Looking up command location' } },
    { p: /^\s*whoami\s*$/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '現在のユーザー名を確認しようとしています', en: 'Checking current username' } },
    { p: /^\s*uname\b/,     r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'システム情報を表示しようとしています', en: 'Displaying system information' } },
    { p: /^\s*sw_vers\b/,   r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'macOS のバージョンを確認しようとしています', en: 'Checking macOS version' } },
    { p: /^\s*hostname\s*$/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コンピューター名を確認しようとしています', en: 'Checking hostname' } },
    { p: /^\s*id\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ユーザー情報を確認しようとしています', en: 'Checking user information' } },
    { p: /^\s*env\s*$/,     r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '環境変数の一覧を表示しようとしています', en: 'Listing environment variables' } },
    { p: /^\s*printenv\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '環境変数を表示しようとしています', en: 'Displaying environment variables' } },
    { p: /^\s*export\b/,    r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '環境変数を設定しようとしています', en: 'Setting an environment variable' } },
    { p: /^\s*type\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'コマンドの種類を調べようとしています', en: 'Looking up command type' } },
    { p: /^\s*file\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの種類を調べようとしています', en: 'Checking file type' } },
    { p: /^\s*stat\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの詳細情報を確認しようとしています', en: 'Checking file details' } },
    { p: /^\s*sleep\b/,     r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '指定時間だけ待機しようとしています', en: 'Waiting for a specified duration' } },
    { p: /^\s*(true|false|:)\s*$/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '何もしないコマンドです', en: 'No-op command' } },
    // 検索・テキスト処理（読み取り専用）
    { p: /^\s*find\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルを検索しようとしています', en: 'Searching for files' } },
    { p: /^\s*grep\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'テキストを検索しようとしています', en: 'Searching text' } },
    { p: /^\s*rg\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'テキストを高速検索しようとしています', en: 'Searching text with ripgrep' } },
    { p: /^\s*diff\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルの差分を比較しようとしています', en: 'Comparing file differences' } },
    { p: /^\s*sort\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'テキストを並び替えて表示しようとしています', en: 'Sorting text output' } },
    { p: /^\s*uniq\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '重複行を除去して表示しようとしています', en: 'Removing duplicate lines' } },
    { p: /^\s*cut\b/,       r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'テキストの一部を切り出して表示しようとしています', en: 'Extracting text fields' } },
    { p: /^\s*tr\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '文字を変換して表示しようとしています', en: 'Translating characters' } },
    { p: /^\s*jq\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'JSON データを整形・抽出しようとしています', en: 'Processing JSON data' } },
    { p: /^\s*yq\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'YAML データを整形・抽出しようとしています', en: 'Processing YAML data' } },
    // パス・ファイル情報
    { p: /^\s*realpath\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルパスを正規化して表示しようとしています', en: 'Resolving file path' } },
    { p: /^\s*basename\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイル名を取り出して表示しようとしています', en: 'Extracting filename' } },
    { p: /^\s*dirname\b/,   r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ディレクトリ名を取り出して表示しようとしています', en: 'Extracting directory name' } },
    { p: /^\s*du\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ファイルサイズを確認しようとしています', en: 'Checking disk usage' } },
    { p: /^\s*df\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ディスクの空き容量を確認しようとしています', en: 'Checking available disk space' } },
    // プロセス情報
    { p: /^\s*ps\b/,        r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '実行中のプロセスを確認しようとしています', en: 'Listing running processes' } },
    { p: /^\s*lsof\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: '開いているファイルを確認しようとしています', en: 'Listing open files' } },
    // ネットワーク情報
    { p: /^\s*ping\b/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ネットワーク接続を確認しようとしています', en: 'Checking network connectivity' } },
    { p: /^\s*dig\b/,       r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'DNS 情報を確認しようとしています', en: 'Looking up DNS information' } },
    { p: /^\s*nslookup\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'DNS 情報を確認しようとしています', en: 'Looking up DNS information' } },
    // Git（読み取り系）
    { p: /\bgit\s+config\s+--(list|get)\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'Git の設定を確認しようとしています', en: 'Checking Git configuration' } },
    { p: /\bgit\s+(status|log|diff|branch|show|remote|tag|fetch)\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'Git の情報を確認しようとしています', en: 'Checking Git information' } },
    // GitHub CLI（読み取り系）
    { p: /\bgh\s+(pr|issue)\s+(view|list|status|checks|diff)\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'GitHub の情報を確認しようとしています', en: 'Checking GitHub information' } },
    { p: /\bgh\s+repo\s+view\b/,  r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'GitHub の情報を確認しようとしています', en: 'Checking GitHub information' } },
    { p: /\bgh\s+auth\s+status\b/, r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'GitHub の認証状態を確認しようとしています', en: 'Checking GitHub authentication status' } },
    // パッケージ情報（読み取り系）は中リスクセクション先頭で _l:'低' として処理済み
    // メディア情報（読み取り系）
    { p: /^\s*ffprobe\b/,   r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'メディアファイルの情報を確認しようとしています', en: 'Checking media file information' } },
    // バージョン・ヘルプ
    { p: /--version\s*$/,   r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'バージョン情報を表示しようとしています', en: 'Displaying version information' } },
    { p: /--help\s*$/,      r: { ja: 'ファイルへの影響はありません', en: 'No impact on files' }, a: { ja: 'ヘルプ情報を表示しようとしています', en: 'Displaying help information' } },
  ];
  for (const { p, r, a } of safeCmds) {
    if (p.test(cmd)) {
      return { level: '低', risk: t(r), action: t(a) };
    }
  }

  // --- デフォルト: 不明なコマンドは中リスク ---
  return {
    level: '中',
    risk: t({ ja: '操作内容を確認してください', en: 'Please review the operation' }),
    action: t({ ja: 'コマンドを実行しようとしています', en: 'Attempting to execute a command' }),
  };
}

// ============================================
// 出力
// ============================================

const result = classify();

// 低リスク: フックとしては意見を出さず、Claude Code のデフォルト判定に委ねる
// allow リストに入っていれば自動許可、入っていなければ標準の確認ダイアログ
// isAllowedBySettings() のパターン漏れに対するフォールバックとしても機能する
if (result.level === '低') {
  process.exit(0);
}

// 中・高リスクのみ: リスク説明付きの確認ダイアログ
const color = result.level === '高' ? COLORS.high : COLORS.mid;
const icon = result.level === '高' ? '|||' : '||';

const levelLabel = LANG === 'ja'
  ? (result.level === '高' ? '高' : '中')
  : (result.level === '高' ? 'High' : 'Medium');

const riskWord = LANG === 'ja' ? 'リスク' : 'Risk';

// フォーマット:
//   {icon} リスク/Risk: {レベル}  ← 太字
//   {操作の説明}。
//   {リスクの説明}。
const period = LANG === 'ja' ? '。' : '.';
const reason = [
  `${color}\x1b[1m${icon} ${riskWord}: ${levelLabel}\x1b[22m`,
  `${result.action}${period}`,
  `${result.risk}${period}${COLORS.reset}`,
].join('\n');

const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: reason,
  },
};

process.stdout.write(JSON.stringify(output));
