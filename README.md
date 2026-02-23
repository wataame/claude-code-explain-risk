<p align="center">
  <img src="assets/header.png" alt="Claude Code Explain Risk">
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

```bash
npx claude-code-explain-risk
```

Restart Claude Code after installation.

## Uninstall

```bash
npx claude-code-explain-risk --uninstall
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

### Unsupported Tools

The following tools cannot show risk explanations due to Claude Code limitations. Claude Code's built-in permission dialog is shown instead.

| Tool | Description |
|---|---|
| Edit / Write | File editing/creation. Claude Code shows the diff in its own UI |
| WebFetch / WebSearch | Web access. The target URL is shown in Claude Code's own UI |
| MCP tools | External service integrations. Shown in Claude Code's own UI |
| Read / Glob / Grep | File reading/searching. Auto-approved as read-only |

> Once Claude Code adds support ([#17356](https://github.com/anthropics/claude-code/issues/17356)), risk explanations will automatically become available for these tools too.

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


## Contributing

Issues and PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
