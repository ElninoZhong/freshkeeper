# 🦞 Freshkeeper
🌏 [中文版](README.zh-CN.md)

The unified update keeper for OpenClaw, Hermes, Claude Code, and Codex users.

![npm](https://img.shields.io/npm/v/freshkeeper)
![CI](https://img.shields.io/github/actions/workflow/status/ElninoZhong/freshkeeper/ci.yml)
![License](https://img.shields.io/github/license/ElninoZhong/freshkeeper)
![Node](https://img.shields.io/node/v/freshkeeper)

> 📹 Demo GIF coming soon

## Why Freshkeeper?
If you use multiple AI coding agents and their extensions, updates get scattered fast. Freshkeeper gives you one command to update Claude Code, Codex, OpenClaw, Hermes, plugins, skills, and safely managed local MCP components in one pass, then prints the changelogs so you can see what changed without checking each tool manually.

## Install & First Run
Use the zero-config path:

```bash
npx freshkeeper@latest init
```

Freshkeeper detects which supported agents are already installed on your machine, runs the first update for what it finds, and then offers to set up a weekly schedule so you do not have to remember it later.

## Agent Skill

Install the two focused Freshkeeper Skills from this repository:

```bash
npx skills add ElninoZhong/freshkeeper --skill freshkeeper-check -g -y
npx skills add ElninoZhong/freshkeeper --skill freshkeeper-update -g -y
```

These Agent Skills manage the user's installed Skill libraries, not the Freshkeeper CLI or AI coding tool binaries. They prefer the shared Universal library and fall back to Claude Code, Codex, OpenClaw, and Hermes user-level libraries when no shared library exists. In v1.2, `$freshkeeper-check` can recover missing GitHub provenance from verified evidence, compare whole Skill directories, and search upstream history to distinguish clean old versions from local customizations. `$freshkeeper-update` backs up every selected library and automatically applies only proven clean-old or current-subset updates through a three-way safety check. Local extensions, manual merges, locally ahead Skills, and upstream-deleted legacy Skills are preserved and reported.

## Commands
| Command | What it does |
|---|---|
| `freshkeeper init` | Choose the primary agent and independent claude-mem provider, save the adapter plan, run the first update, and optionally install a weekly schedule (`--agent ... --memory-provider codex|claude|gemini|openrouter`) |
| `freshkeeper list [component]` | Show installed state for `all`, `agent`, `plugins`, `skills`, or `mcp`; defaults to `all` |
| `freshkeeper check [component]` | Run non-mutating checks and label every installed adapter as complete, partial, or unavailable; incomplete coverage never claims everything is current |
| `freshkeeper update [component]` | Update one component and report explicit skips; for example `freshkeeper update plugins` |
| `freshkeeper lock` | Snapshot exact project versions into `freshkeeper.lock.json` |
| `freshkeeper restore` | Restore and verify the nearest project lock |
| `freshkeeper update --respect-lock` | Enforce the nearest lock instead of moving past pinned versions |
| `freshkeeper schedule <cron>` | Install a crontab entry; `schedule off` to remove |

## Supported Agents
| Adapter ID | Display name | Install | What gets updated |
|---|---|---|---|
| `mcp-components` | MCP Components | discovered through the user-selected owner | Checks `claude-mem`, `mcp-remote`, and `gbrain`; automatically updates and verifies only the selected owner’s `claude-mem` |
| `claude-code` | Claude Code CLI | official installer | `claude update` |
| `claude-plugins` | Claude Code Plugins | via `claude plugin install` | each plugin via `claude plugin update <name>` |
| `codex-plugins` | Codex Plugins | Codex plugin marketplaces | Refresh user-managed Git marketplaces and update or repair installed plugins through idempotent `codex plugin add`; host-managed plugins are report-only and MCP plugins stay delegated to the MCP adapter |
| `skills-cli` | Skills CLI (`skills.sh`) | `npm i -g skills` or pinned `npx` fallback | Refresh GitHub skills listed by a valid `skills-lock.json`; missing or malformed locks fail closed |
| `codex` | OpenAI Codex CLI | standalone or npm installation | resolves the exact latest npm version, runs the active CLI's own `codex update`, and verifies the PATH-effective `codex --version` |
| `openclaw` | OpenClaw | `npm install -g openclaw@latest` | `openclaw update --channel stable` + `openclaw skills update` |
| `hermes` | Hermes Agent | `curl` install script | `hermes update` + `hermes skills update` |

## Config File
Location: `~/.freshkeeper/config.json`

```json
{
  "primaryAgent": "codex",
  "memoryProvider": "codex",
  "enabledAdapters": ["mcp-components", "codex-plugins", "skills-cli", "codex"],
  "schedule": { "enabled": true, "cron": "0 10 * * 1" },
  "notify": { "enabled": true, "macNotification": false }
}
```

`freshkeeper init` asks which agent Freshkeeper should manage and, independently, which provider should generate claude-mem observations. `primaryAgent` controls MCP ownership; `memoryProvider` is passed to the managed claude-mem installer; `enabledAdapters` remains the hard execution boundary. Unknown adapter IDs fail visibly instead of being ignored.

Before initialization, no agent adapter is enabled. This fail-closed default prevents Freshkeeper from choosing Claude, Codex, or another installed tool on the user's behalf.

Existing configs are never widened silently. After upgrading to a release that contains `codex-plugins`, rerun `freshkeeper init --agent codex --memory-provider <provider>` and confirm before the plugin adapter is added to the execution plan.

### Check and update contract

- `check` labels every installed, enabled adapter as `complete`, `partial`, or `unavailable` and prints coverage totals.
- Confirmed newer versions are also labeled `update` or `skip`, so risky MCP migrations disclose their eventual update behavior during the check.
- Freshkeeper says there are no pending updates only when every adapter is fully checkable and no candidate exists.
- Incomplete coverage says no updates were confirmed; it never claims the whole environment is current.
- Deterministically checkable adapters execute the same version decision during `update`; an already-current Codex install is not reinstalled.
- `update` counts only verified version or content-hash changes as `updated`. Successful commands with unchanged state are reported separately as `already current`.

Memory-provider cost boundary:

| Provider | Authentication and billing |
|---|---|
| `codex` | Reuses ChatGPT OAuth; no separate API key or API bill, but consumes ChatGPT/Codex plan quota |
| `claude` | Subscription OAuth consumes the Claude plan; optional API-key/gateway modes have their own billing |
| `gemini` | Requires a Gemini API key; provider billing or free-tier limits apply |
| `openrouter` | Requires an OpenRouter key and credits unless the chosen model is free |

## Project locks

Run `freshkeeper lock` from a project root to create a reviewable `freshkeeper.lock.json`. The first lock schema covers exact Claude Code versions, the installed Claude plugin inventory, the exact Skills CLI version, and GitHub skills pinned to both a 40-character commit and a SHA-256 content hash.

`freshkeeper restore` searches upward for the nearest lock. `freshkeeper update --respect-lock` uses the same restore path, so an explicitly lock-respecting update cannot silently move a project past its declared versions. Adapters disabled in `enabledAdapters` remain untouched. Normal global `freshkeeper update` remains unchanged.

Skills are installed into a temporary project first, checked against the declared commit and content hash, backed up, applied, and verified again. A partial failure restores the previous project skill copies and `skills-lock.json`.

Claude Code supports exact-version installs. Claude plugins do not expose a general downgrade command: Freshkeeper installs or upgrades when the locked version is available, verifies the final version and enabled state, and fails loudly rather than claiming success when a downgrade or unavailable marketplace revision would be required. Extra global plugins are not pruned.

### Skills safety

- Freshkeeper searches from the current directory upward for the nearest `skills-lock.json`. Set `FRESHKEEPER_SKILLS_CWD` to select one explicitly.
- A missing lock safely skips the skills update. A malformed lock reports a failure and never widens scope.
- A broad `skills update -y` runs only when `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1` is explicitly set.
- The automatic npx fallback uses a pinned Skills CLI package instead of whichever cached copy has the newest timestamp.

### MCP component safety

- Freshkeeper classifies configured MCP servers by owner instead of treating every server as an npm package.
- `claude-mem` follows `primaryAgent`: Codex uses the official version-pinned npm installer and a Codex-owned worker; Claude uses the Claude plugin manager. Both paths verify the installed version and runtime health.
- `mcp-remote` is reported but skipped until a staged install, real `initialize`/`tools/list` verification, config switch, and rollback are available.
- `gbrain` is reported but skipped until its data and configuration are backed up, migrations run, and both `doctor` and an MCP probe pass.
- Remote HTTP MCPs and MCPs bundled with apps or plugins are owner-managed and are never locally overwritten by this adapter.

### Codex plugin safety

- Freshkeeper treats a plugin as a complete component that may contain Skills, MCP, hooks, browser extensions, and task templates; it never edits plugin cache files directly.
- User-managed Git marketplaces are refreshed with `codex plugin marketplace upgrade`, then installed plugins are rematerialized through idempotent `codex plugin add` and verified by version and cache manifest.
- User-managed local marketplaces are reinstalled only when the source version changes or the cache is damaged.
- `openai-bundled`, `openai-primary-runtime`, official remote plugins, and other Codex/ChatGPT host-managed surfaces remain report-only.
- Plugins such as `claude-mem` that require MCP restart and health verification remain delegated to the MCP adapter.

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
A: Run `freshkeeper init --agent <name>` first and review the resulting `enabledAdapters`. Freshkeeper fails closed around skill locks and crontab writes, but enabled adapters still run real third-party update commands.

**Q: Does Freshkeeper update every configured MCP server?**
A: No. It checks ownership first. Only `claude-mem` currently has an automatic update-and-verify path; risky local migrations are explicit skips, and remote or host-managed MCPs remain report-only.

**Q: Can I update plugins without touching other components?**

A: Yes. Use `freshkeeper check plugins` and `freshkeeper update plugins`. The same command shape accepts `agent`, `skills`, or `mcp`.

**Q: Why are some components marked preflight unavailable?**

A: Their upstream tool exposes only a mutating update command, not a reliable read-only latest-version query. Freshkeeper preserves that unknown state and verifies the version or content hash after `update` instead of guessing.

**Q: What about Cursor / Windsurf / Aider?**  
A: Still on the roadmap.

## Roadmap
Actively planned, open to co-design — drop thoughts in the linked issues.

- [x] [#1 Per-project lockfile support](https://github.com/ElninoZhong/freshkeeper/issues/1) — lock, restore, and respect exact Claude Code, plugin, Skills CLI, and GitHub skill revisions per project
- [x] Separate `freshkeeper-check` and `freshkeeper-update` Agent Skills for the user's installed Skill library, with provenance recovery, history matching, three-way updates, backup, and non-destructive boundaries
- [x] Ownership-aware MCP component inventory with automatic `claude-mem` update verification and explicit risk skips
- [x] Codex plugin ownership inventory, user-marketplace refresh, cache repair, and component-scoped commands
- [ ] Cursor / Windsurf / Aider / Gemini CLI adapters
- [ ] macOS native notifications on update complete
- [ ] Windows support via Task Scheduler
- [x] Trusted Publisher auto-release via GitHub Actions OIDC

## Contributing
Read [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) and [`CONTEXT.md`](CONTEXT.md) for the current authority and safety model. To add an adapter, start with [`src/adapters/types.ts`](src/adapters/types.ts), [`src/adapters/catalog.ts`](src/adapters/catalog.ts), and the adapter tests under [`tests/adapters/`](tests/adapters/). [`docs/plan.md`](docs/plan.md) is the historical initial implementation plan, not current guidance.

## License
MIT
