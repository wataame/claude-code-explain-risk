#!/bin/bash
set -e

# ============================================
# Claude Code Safe Guide — インストーラー
# ============================================
#
# 使い方:
#   ローカル:  bash install.sh
#   リモート:  curl -fsSL https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main/install.sh | bash
#

REPO_URL="https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

HOOK_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo ""
echo "🛡️  Claude Code Safe Guide をインストールしています..."
echo ""

# ============================================
# 1. ディレクトリ作成
# ============================================
mkdir -p "$HOOK_DIR"

# ============================================
# 2. フックスクリプトを配置
# ============================================
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/hooks/explain-risk.js" ]; then
  # ローカルからコピー
  cp "$SCRIPT_DIR/hooks/explain-risk.js" "$HOOK_DIR/explain-risk.js"
  echo "  ✓ フックスクリプトをコピーしました（ローカル）"
else
  # GitHub からダウンロード
  curl -fsSL "$REPO_URL/hooks/explain-risk.js" -o "$HOOK_DIR/explain-risk.js"
  echo "  ✓ フックスクリプトをダウンロードしました"
fi

chmod +x "$HOOK_DIR/explain-risk.js"

# ============================================
# 3. settings.json にフック設定をマージ
# ============================================
node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';

// 既存の settings.json を読み込む（なければ空オブジェクト）
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {}

// hooks.PreToolUse を初期化
if (!settings.hooks) settings.hooks = {};
if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

// 既にインストール済みかチェック
const already = settings.hooks.PreToolUse.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes('explain-risk'))
);

if (already) {
  console.log('  ✓ settings.json は既に設定済みです（スキップ）');
} else {
  settings.hooks.PreToolUse.push({
    hooks: [{
      type: 'command',
      command: '$HOOK_DIR/explain-risk.js',
    }],
  });

  // ディレクトリが存在することを確認
  const dir = require('path').dirname(path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  console.log('  ✓ settings.json にフック設定を追加しました');
}
"

# ============================================
# 4. 完了メッセージ
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  インストール完了！"
echo ""
echo "  これから Claude Code を使うと、操作前に"
echo "  リスクの説明が日本語で表示されます。"
echo ""
echo "  🟢 低リスク → そのまま通ります"
echo "  🟡 中リスク → 説明付きで確認されます"
echo "  🔴 高リスク → 説明付きで確認されます"
echo ""
echo "  アンインストール:"
echo "    bash uninstall.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
