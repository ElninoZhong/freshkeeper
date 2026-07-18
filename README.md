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
| `skills-cli` | Skills CLI (`skills.sh`) | `npm i -g skills` or pinned `npx` fallback | Refresh GitHub skills listed by a valid `skills-lock.json`; missing or malformed locks fail closed |
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

`enabledAdapters` is authoritative: adapters omitted from this array are not detected or updated. Unknown adapter IDs fail visibly instead of being ignored.

### Skills safety

- Freshkeeper searches from the current directory upward for the nearest `skills-lock.json`. Set `FRESHKEEPER_SKILLS_CWD` to select one explicitly.
- A missing lock safely skips the skills update. A malformed lock reports a failure and never widens scope.
- A broad `skills update -y` runs only when `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1` is explicitly set.
- The automatic npx fallback uses a pinned Skills CLI package instead of whichever cached copy has the newest timestamp.

## Schedule
```bash
freshkeeper schedule "0 10 * * 1"   # every Monday 10am
freshkeeper schedule off            # remove
```

Freshkeeper validates a single-line cron expression, preserves unrelated entries, and writes the managed block to `crontab -` through stdin without constructing a shell command.

## FAQ
**Q: Does this replace `claude plugin update` or `npx skills update`?**  
A: No. It wraps and batches them.

**Q: How does Freshkeeper update project skills?**  
A: When it finds a valid `skills-lock.json`, it refreshes each GitHub-backed skill with `skills add <source> --skill <name> --agent universal -y`. No lock means no skills write; global refresh requires an explicit environment opt-in.

**Q: Is it safe to run automatically?**  
A: Configure `enabledAdapters` first and review every updater you enable. Freshkeeper now fails closed around skill locks and crontab writes, but enabled adapters still run real third-party update commands.

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
