#!/bin/bash
set -e

# ============================================
# Claude Code Safe Guide — アンインストーラー
# ============================================

HOOK_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo ""
echo "🗑️  Claude Code Safe Guide をアンインストールしています..."
echo ""

# ============================================
# 1. フックスクリプトを削除
# ============================================
if [ -f "$HOOK_DIR/explain-risk.js" ]; then
  rm "$HOOK_DIR/explain-risk.js"
  echo "  ✓ フックスクリプトを削除しました"
else
  echo "  - フックスクリプトは見つかりませんでした（スキップ）"
fi

# ============================================
# 2. settings.json からフック設定を削除
# ============================================
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';

try {
  const settings = JSON.parse(fs.readFileSync(path, 'utf8'));

  if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
    // explain-risk を含むエントリを除外
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry =>
      !(entry.hooks && entry.hooks.some(h => h.command && h.command.includes('explain-risk')))
    );

    // 空になったら配列ごと削除
    if (settings.hooks.PreToolUse.length === 0) {
      delete settings.hooks.PreToolUse;
    }

    // hooks 自体が空になったら削除
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
    console.log('  ✓ settings.json からフック設定を削除しました');
  } else {
    console.log('  - settings.json にフック設定はありませんでした（スキップ）');
  }
} catch (e) {
  console.error('  ⚠ settings.json の処理中にエラーが発生しました:', e.message);
}
"
else
  echo "  - settings.json が見つかりませんでした（スキップ）"
fi

# ============================================
# 3. 完了メッセージ
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  アンインストール完了！"
echo ""
echo "  Claude Code のリスク説明表示を無効にしました。"
echo "  通常の許可ダイアログに戻ります。"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
