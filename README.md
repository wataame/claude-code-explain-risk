<p align="center">
  <img src="assets/header.png" alt="Claude Code Explain Risk" width="600">
</p>

# Claude Code Explain Risk

**Show risk explanations on Claude Code's permission dialogs**

[🇯🇵 日本語](README.ja.md)

---

When using Claude Code, you often see "Allow this command?" dialogs, but it's not always clear what will happen.

This tool adds risk-level labels (Low / Medium / High) and plain-language explanations to those dialogs, helping non-engineers understand what each command does before approving it. Supports both English and Japanese (auto-detected from your system locale).

## Example Output

```
||| Risk: High
Attempting to recursively delete files and folders.
Deleted files cannot be recovered.
```

```
|| Risk: Medium
Attempting to install npm packages.
Malicious software may be included.
```

Low-risk commands (`ls`, `cat`, `git status`, etc.) pass through silently with no extra dialogs.

## Installation

### One-liner (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main/install.sh | bash
```

### Local Install

```bash
git clone https://github.com/wataame/claude-code-explain-risk.git
cd claude-code-explain-risk
bash install.sh
```

Restart Claude Code after installation.

## Uninstall

```bash
# If you have the repo locally
bash uninstall.sh

# Without the repo
curl -fsSL https://raw.githubusercontent.com/wataame/claude-code-explain-risk/main/uninstall.sh | bash
```

## Risk Levels

| Level | Display | Behavior |
|---|---|---|
| Low | None | Passes through (Claude Code default behavior) |
| Medium | Yellow explanation | Shows description and risk, then asks for confirmation |
| High | Red explanation | Shows description and risk, then asks for confirmation |

## Supported Commands (150+)

### High Risk (Red)

| Category | Examples |
|---|---|
| File deletion | `rm -rf`, `find -delete`, `truncate` |
| Git irreversible | `git push`, `git reset --hard`, `git clean`, `git stash clear` |
| Admin privileges | `sudo`, `systemctl`, `launchctl` |
| Remote connections | `ssh`, `scp`, `rsync` |
| External scripts | `curl \| bash`, `wget \| sh` |
| Permission changes | `chmod`, `chown` |
| Process termination | `kill`, `killall` |

### Medium Risk (Yellow)

| Category | Examples |
|---|---|
| Package managers | `npm install`, `pip install`, `brew install`, `yarn add` |
| Git operations | `git add`, `git commit`, `git merge`, `git pull` |
| File operations | `mkdir`, `cp`, `mv`, `touch` |
| Program execution | `node`, `python3`, `ruby`, `bun` |
| Testing | `jest`, `pytest`, `playwright` |
| Build tools | `make`, `tsc`, `webpack` |
| Deployment | `firebase deploy`, `vercel`, `gcloud` |
| Databases | `psql`, `mysql`, `sqlite3` |

### Low Risk (No display)

| Category | Examples |
|---|---|
| Basic commands | `ls`, `pwd`, `cd`, `echo`, `cat` |
| Search | `find`, `grep`, `rg`, `diff` |
| Text processing | `jq`, `sort`, `cut` |
| Git read-only | `git status`, `git log`, `git diff` |
| Version/help | `--version`, `--help` |

## Settings Integration

### Allow List

Commands already allowed in Claude Code's `settings.json` are respected. The hook won't interfere with your existing permissions.

### Permission Mode

| Mode | Hook Behavior |
|---|---|
| `default` | Allow list match -> auto-approve / Otherwise -> risk explanation + confirm |
| `acceptEdits` | Same as default |
| `dontAsk` | Hook does not interfere (all auto-approved) |
| `bypassPermissions` | Hook does not interfere (all auto-approved) |

## Language

The display language switches automatically based on the `LANG` environment variable.

| `LANG` | Display Language |
|---|---|
| `ja_JP.UTF-8`, etc. (starts with `ja`) | Japanese |
| Anything else (`en_US.UTF-8`, etc.) | English |

No configuration needed.

## Requirements

- **Node.js** — Bundled with Claude Code, no extra installation needed
- **OS** — macOS, Linux
- **Dependencies** — None (uses only Node.js built-in modules)

## How It Works

Uses Claude Code's [PreToolUse hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). The hook is called before any Bash command executes, classifies the risk, and shows an explanation.

```
Claude Code is about to execute a command
  ↓
explain-risk.js is called
  ↓
Command risk is classified (Low / Medium / High)
  ↓
Low risk → passes through silently
Medium/High risk → shows explanation and asks for confirmation
```

### Supported Tools

Risk explanations are shown for **Bash commands only**. This is a Claude Code limitation — hook explanation text can only be displayed in Bash permission dialogs.

| Tool | Permission Dialog | Risk Explanation |
|---|---|---|
| **Bash** | Yes | Yes (shown by this tool) |
| Edit / Write | Yes (Claude Code built-in UI) | No |
| WebFetch / WebSearch | Yes (Claude Code built-in UI) | No |
| MCP tools | Yes (Claude Code built-in UI) | No |
| Read / Glob / Grep | No (auto-approved) | No |

For non-Bash tools (Edit, Write, WebFetch, MCP, etc.), Claude Code's built-in permission dialog is shown as-is. These tools use Claude Code's own UI to display content, so hook explanation text is not used.

> Bash accounts for ~38% of all tool usage and is the most confusing for non-engineers. Covering Bash alone provides significant practical value.

The hook internally includes classification logic for MCP tools, Edit, and Write as well. Once Claude Code adds support ([#17356](https://github.com/anthropics/claude-code/issues/17356)), risk explanations will automatically become available for these tools too.

## Contributing

Issues and PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
