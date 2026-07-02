# 🦞 Freshkeeper
🌏 [中文版](README.zh-CN.md)

The unified update keeper for OpenClaw, Hermes, Claude Code, and Codex users.

![npm](https://img.shields.io/npm/v/freshkeeper)
![CI](https://img.shields.io/github/actions/workflow/status/ElninoZhong/freshkeeper/ci.yml)
![License](https://img.shields.io/github/license/ElninoZhong/freshkeeper)
![Node](https://img.shields.io/node/v/freshkeeper)

> 📹 Demo GIF coming soon

## Why Freshkeeper?
If you use multiple AI coding agents and their extensions, updates get scattered fast. Freshkeeper gives you one command to update Claude Code, Codex, OpenClaw, Hermes, plugins, and skills in one pass, then prints the changelogs so you can see what changed without checking each tool manually.

## Install & First Run
Use the zero-config path:

```bash
npx freshkeeper@latest init
```

Freshkeeper detects which supported agents are already installed on your machine, runs the first update for what it finds, and then offers to set up a weekly schedule so you do not have to remember it later.

## Commands
| Command | What it does |
|---|---|
| `freshkeeper init` | Interactive setup: detect agents, run first update, install weekly schedule |
| `freshkeeper list` | Show which supported agents are installed + their versions |
| `freshkeeper check` | Show pending updates (dry-run where supported) |
| `freshkeeper update` | Update everything installed, then print changelog for updated tools |
| `freshkeeper schedule <cron>` | Install a crontab entry; `schedule off` to remove |

## Supported Agents
| Adapter ID | Display name | Install | What gets updated |
|---|---|---|---|
| `claude-code` | Claude Code CLI | official installer | `claude update` |
| `claude-plugins` | Claude Code Plugins | via `claude plugin install` | each plugin via `claude plugin update <name>` |
| `skills-cli` | Skills CLI (`skills.sh`) | `npm i -g skills` or `npx skills` | Refresh GitHub skills from `skills-lock.json` into the Universal/shared skills library; falls back to `skills update -y` when no lockfile is found |
| `codex` | OpenAI Codex CLI | Claude plugin `codex@openai-codex` | `claude plugin update codex@openai-codex` |
| `openclaw` | OpenClaw | `npm install -g openclaw@latest` | `openclaw update --channel stable` + `openclaw skills update` |
| `hermes` | Hermes Agent | `curl` install script | `hermes update` + `hermes skills update` |

## Config File
Location: `~/.freshkeeper/config.json`

```json
{
  "enabledAdapters": ["claude-code", "claude-plugins", "skills-cli", "codex", "openclaw", "hermes"],
  "schedule": { "enabled": true, "cron": "0 10 * * 1" },
  "notify": { "enabled": true, "macNotification": false }
}
```

## Schedule
```bash
freshkeeper schedule "0 10 * * 1"   # every Monday 10am
freshkeeper schedule off            # remove
```

## FAQ
**Q: Does this replace `claude plugin update` or `npx skills update`?**  
A: No. It wraps and batches them.

**Q: How does Freshkeeper update project skills?**  
A: When it finds a `skills-lock.json`, it refreshes each GitHub-backed skill with `skills add <source> --skill <name> --agent universal -y`. This keeps shared skills scoped to the Universal library and avoids accidentally updating every agent-specific skills directory.

**Q: Is it safe to run automatically?**  
A: Yes. Every update command shown is the same one you would run manually; Freshkeeper just runs them in sequence and logs the output.

**Q: What about Cursor / Windsurf / Aider?**  
A: On the roadmap for v1.1.

## Roadmap
Actively planned, open to co-design — drop thoughts in the linked issues.

- [ ] [#1 Per-project lockfile support](https://github.com/ElninoZhong/freshkeeper/issues/1) — pin CLI + plugin + skill versions per project so version drift stops surfacing as mystery model failures
- [ ] Cursor / Windsurf / Aider / Gemini CLI adapters (v1.1)
- [ ] macOS native notifications on update complete
- [ ] Windows support via Task Scheduler
- [ ] Trusted Publisher auto-release via GitHub Actions OIDC

## Contributing
See [`docs/`](docs/) for architecture notes and implementation context. If you want to add a new adapter, start with [`docs/plan.md`](docs/plan.md).

## License
MIT
