# context-viewer

A Claude Code mod that draws the session's context window in the band above the prompt, in the
terminal and the desktop app:

```
✻ claude-opus-5-5 • 90k of 1M (9%) • compacts at 987k • 5h 24% (2h10m) • 7d 41% (3d4h) • spent $1.23
██▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
■ system prompt 4.2k 0% • ■ system tools 17k 2% • ■ mcp tools 52k 5% • ■ free 897k 90%
```

The bar and legend follow `/context`'s categories, each in its own colour. The band appears after the first
response and refreshes whenever the context fill changes. Collapse it with `ctrl+x ctrl+a`.

## Settings

Change them in `/config` (or the plugin's configure dialog); the band reloads with the new values.

| Setting | Default | Effect |
| --- | --- | --- |
| `legend` | `full` | `full`: name, tokens and percent per category; `tokens`: name and tokens; `compact`: name only; `off`: no legend and a single-colour bar |
| `numbers` | `round` | `round`: 4.2k, 76k, 1M and whole percents; `precise`: one decimal everywhere (348.1k, 1.0M, 4.7%, `<0.1%`) |
| `usage` | `both` | `both`, `limits`, `cost` or `off`. Limits are the plan windows the session reports (5h/7d on a subscription, a gateway's spend limit), with time to reset; cost is what this session has spent at API prices, as `/cost` shows |
| `hide_below_percent` | `0` | Keep the band hidden until the context window is at least this full |
| `separator` | `•` | Text between header parts and legend entries; empty for none |
| `show_buffer` | `true` | Show the autocompact buffer as its own category |

## Install

```
/plugin install context-viewer --marketplace joaomariok/ClaudeContextViewer
```

Answer `y` to add the marketplace, then pick a scope.

To run it from a local checkout instead, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env`
block of `~/.claude/settings.json` (or pass `claude --plugin-dir <folder>` in a terminal).

## Develop

```
claude plugin validate .
claude plugin test .
```
