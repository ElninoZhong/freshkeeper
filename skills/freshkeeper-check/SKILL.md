---
name: freshkeeper-check
description: Check Freshkeeper-supported AI coding tools for pending updates without installing or changing anything. Use when the user says `freshkeeper check`, invokes `$freshkeeper-check`, asks whether Claude Code, Codex, OpenClaw, Hermes, plugins, or skills have updates, or asks for `freshkeeper check with details`, a detailed version report, current-versus-latest versions, skipped adapters, or check limitations.
---

# Freshkeeper Check

Run only Freshkeeper's read-only inspection path. Never turn a check into an update, initialization, restore, lock, or schedule change.

## Choose the output mode

- For `freshkeeper check`, `$freshkeeper-check`, “检查更新”, or equivalent: run `freshkeeper check` and return a short result.
- For `freshkeeper check with details`, `$freshkeeper-check with details`, “详细检查”, “完整版本明细”, or equivalent: run `freshkeeper list` followed by `freshkeeper check`, then return an adapter-by-adapter report.
- Treat `with details` as a Skill output mode. Do not pass those words to the CLI; the CLI has no `with details` argument.

Both modes are read-only apart from network and command-cache effects of the underlying checks.

## Resolve the runner

1. Work from the directory the user placed in scope.
2. Use `freshkeeper` when installed, after checking `freshkeeper --version`.
3. When it is absent and the user explicitly invoked this Skill or asked to use Freshkeeper, use `npx --yes freshkeeper@latest` temporarily. Do not install it globally.
4. If the configured npm mirror has not synchronized a known published version, retry only the Freshkeeper package through `https://registry.npmjs.org/`; preserve the user's normal registry configuration.
5. Use the same resolved runner for every command in one check.

## Report a normal check

Run:

```text
freshkeeper check
```

Report one of these outcomes concisely:

- updates available, with the affected items and current-to-latest versions;
- no pending updates detected;
- checks that failed.

State Freshkeeper's limitation when relevant: some adapters expose changes only during `update`, so an empty dry-run is not proof that every third-party tool is current.

## Report a detailed check

Run, in order:

```text
freshkeeper list
freshkeeper check
```

Report:

1. Every configured adapter shown by `list`, including installed status and detected version.
2. Every pending update shown by `check`, including item, current version, and latest version.
3. Adapters that are absent, skipped, unsupported for dry-run, or failed, without inventing a latest version.
4. The exact commands and working directory used.

Do not claim “all up to date” for an adapter that cannot expose a dry-run result. Say that no pending update was reported and name the limitation.

## Safety boundary

- Never run `freshkeeper update`, `freshkeeper init`, `freshkeeper restore`, `freshkeeper lock`, or `freshkeeper schedule` from this Skill.
- Never set `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1`.
- Never run raw third-party update commands as a fallback.
- Never modify `~/.agents/skills`, plugins, versions, lockfiles, configuration, or crontab.

## Invocation examples

- `$freshkeeper-check`
- `$freshkeeper-check with details`
- `freshkeeper check，看看有没有更新，不要安装`
- `freshkeeper check with details，逐项告诉我当前版本和可更新版本`
