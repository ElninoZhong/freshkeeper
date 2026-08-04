---
name: freshkeeper
description: Manage, inspect, lock, restore, and safely update AI coding toolchains with Freshkeeper. Use this skill whenever the user mentions Freshkeeper, freshkeeper.lock.json, skills-lock.json, AI coding-agent version drift, project toolchain reproducibility, restoring pinned Claude Code plugins or skills, checking updates for Claude Code/Codex/OpenClaw/Hermes, or scheduling Freshkeeper updates, even when they do not explicitly ask for a skill.
compatibility: Requires Node.js 20 or later and npm or an installed freshkeeper CLI. Mutating commands may invoke installed third-party agent CLIs and modify tool versions, skills, plugins, or crontab entries.
---

# Freshkeeper

Use Freshkeeper as the execution authority for supported AI coding-tool updates. This skill translates the user's intent into the smallest safe Freshkeeper command; it does not reimplement adapters, edit lock state to imitate success, or fall back to raw third-party update commands after a failure.

## Resolve the command

1. Work from the project directory the user placed in scope. Project lock discovery starts at the current directory and walks upward.
2. Check `freshkeeper --version` when the CLI is installed.
3. For `lock`, `restore`, or `update --respect-lock`, require Freshkeeper 1.1.0 or later. If the installed version is older, use `npx --yes freshkeeper@latest` when the user has asked to perform the Freshkeeper task; otherwise explain the required upgrade without changing the machine.
4. When the CLI is absent and the user explicitly asked to use Freshkeeper, prefer `npx --yes freshkeeper@latest <command>` so the package is temporary. Do not globally install it unless the user asks for a global installation.
5. If the configured npm mirror has not synchronized a known published version, retry only the Freshkeeper package through `https://registry.npmjs.org/`; preserve the user's normal registry configuration.

Use one resolved runner consistently for the operation:

```text
freshkeeper
```

or:

```text
npx --yes freshkeeper@latest
```

## Map intent to one operation

| User intent | Command | Boundary |
|---|---|---|
| Show supported installed agents and versions | `freshkeeper list` | Read-only inspection |
| Check for pending updates without applying them | `freshkeeper check` | Read-only except for network/cache effects of underlying checks |
| Snapshot this project's exact supported toolchain | `freshkeeper lock` | Writes `freshkeeper.lock.json` in the current project |
| Restore the nearest project toolchain lock | `freshkeeper restore` | May change enabled CLIs, plugins, Skills CLI, and locked skills |
| Update while preserving project pins | `freshkeeper update --respect-lock` | Uses the same exact, fail-closed restore path |
| Update all installed enabled adapters | `freshkeeper update` | Performs real global third-party updates |
| Run first-time interactive setup | `freshkeeper init` | Detects tools, performs an update, and may add a schedule |
| Add or remove a Freshkeeper schedule | `freshkeeper schedule <cron>` or `freshkeeper schedule off` | Modifies only Freshkeeper's managed crontab block |

Do not combine operations merely because they are available. For example, a request to lock the project does not authorize an update, and a request to check versions does not authorize installation or scheduling.

## Inspect before mutating

For `restore`, `update --respect-lock`, `update`, `init`, or `schedule`:

- Read `~/.freshkeeper/config.json` when it exists and name the enabled adapters that the command may affect.
- For project-locked operations, locate and inspect the nearest `freshkeeper.lock.json`. Stop if it is missing or malformed; never widen the task into an unlocked global update.
- Keep disabled adapters untouched.
- Treat the user's direct request to run the named operation as authorization for that operation. Ask only when the requested scope is genuinely ambiguous or would expand beyond it.

## Preserve lock integrity

- Generate `freshkeeper.lock.json` with `freshkeeper lock`; do not hand-edit versions, commits, or content hashes to claim a reproducible state.
- After `lock`, report the file path and summarize the captured adapter entries. Suggest committing the lockfile when the user wants the project state shared.
- After `restore` or `update --respect-lock`, rely on Freshkeeper's post-state verification. If a version, commit, enabled state, or content hash does not match, report the failure rather than describing the machine as restored.
- A Claude plugin that cannot be downgraded or is no longer available must fail visibly. Do not substitute the latest version.
- Do not prune unrelated global plugins or skills.

## Protect the shared skill library

- Never set `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1` unless the user explicitly requests a broad global skills refresh and understands that it widens mutation scope.
- A missing `skills-lock.json` means the skills adapter safely skips project skill writes. A malformed lock is an error, not permission to run `skills update` globally.
- Do not delete, reconcile, or broadly rewrite `~/.agents/skills` as part of diagnosis or tests.
- Never run real `freshkeeper update`, `freshkeeper init`, schedule mutations, `skills update`, or `skills add` in tests. Use mocks and isolated temporary directories.

## Report the result

Keep the handoff concise and evidence-based:

1. Name the command and project directory used.
2. List affected or inspected adapters.
3. Name files written, especially `freshkeeper.lock.json`.
4. Separate successful, skipped, and failed adapters.
5. For mutations, state the observed verification result; do not infer success from a zero exit code alone when Freshkeeper reports a failed adapter.

## Invocation examples

- `$freshkeeper 锁定这个项目的 Claude Code、plugins 和 skills 版本，不要升级。`
- `$freshkeeper 按当前项目的 freshkeeper.lock.json 恢复，恢复不了就明确告诉我。`
- `$freshkeeper 先检查这台电脑上的 AI coding 工具有没有更新，不要安装。`
- `用 Freshkeeper 更新所有已启用工具，但遵守这个项目的锁。`
