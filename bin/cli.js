#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const hookDir = path.join(home, '.claude', 'hooks');
const hookFile = path.join(hookDir, 'explain-risk.js');
const settingsFile = path.join(home, '.claude', 'settings.json');

// npx で実行された場合、パッケージ内の hooks/explain-risk.js を参照
const sourceHook = path.join(__dirname, '..', 'hooks', 'explain-risk.js');

const isUninstall = process.argv.includes('--uninstall');

if (isUninstall) {
  uninstall();
} else {
  install();
}

// ============================================
// インストール
// ============================================
function install() {
  console.log('');
  console.log('  Installing Claude Code Explain Risk...');
  console.log('');

  // 1. ディレクトリ作成
  fs.mkdirSync(hookDir, { recursive: true });

  // 2. フックスクリプトを配置
  if (!fs.existsSync(sourceHook)) {
    console.error('  Error: hooks/explain-risk.js not found in package');
    process.exit(1);
  }
  fs.copyFileSync(sourceHook, hookFile);
  fs.chmodSync(hookFile, 0o755);
  console.log('  ✓ Hook script installed');

  // 3. settings.json にフック設定をマージ
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {}

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

  const already = settings.hooks.PreToolUse.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('explain-risk'))
  );

  if (already) {
    console.log('  ✓ settings.json already configured (skipped)');
  } else {
    settings.hooks.PreToolUse.push({
      hooks: [{
        type: 'command',
        command: hookFile,
      }],
    });

    const dir = path.dirname(settingsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    console.log('  ✓ Hook registered in settings.json');
  }

  // 4. 完了メッセージ
  console.log('');
  console.log('  ✅ Installation complete!');
  console.log('');
  console.log('  Restart Claude Code to activate.');
  console.log('');
  console.log('  🟢 Low risk  → passes through silently');
  console.log('  🟡 Medium    → shows explanation + confirmation');
  console.log('  🔴 High risk → shows explanation + confirmation');
  console.log('');
  console.log('  Uninstall:');
  console.log('    npx claude-code-explain-risk --uninstall');
  console.log('');
}

// ============================================
// アンインストール
// ============================================
function uninstall() {
  console.log('');
  console.log('  Uninstalling Claude Code Explain Risk...');
  console.log('');

  // 1. フックスクリプトを削除
  if (fs.existsSync(hookFile)) {
    fs.unlinkSync(hookFile);
    console.log('  ✓ Hook script removed');
  } else {
    console.log('  - Hook script not found (skipped)');
  }

  // 2. settings.json からフック設定を削除
  if (fs.existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

      if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry =>
          !(entry.hooks && entry.hooks.some(h => h.command && h.command.includes('explain-risk')))
        );

        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
        console.log('  ✓ Hook removed from settings.json');
      } else {
        console.log('  - No hook config found in settings.json (skipped)');
      }
    } catch (e) {
      console.error('  Warning: Error processing settings.json:', e.message);
    }
  } else {
    console.log('  - settings.json not found (skipped)');
  }

  // 3. 完了メッセージ
  console.log('');
  console.log('  ✅ Uninstall complete!');
  console.log('');
  console.log('  Risk explanations have been disabled.');
  console.log('  Claude Code will use its default permission dialogs.');
  console.log('');
}
