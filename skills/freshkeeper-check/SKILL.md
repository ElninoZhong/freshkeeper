---
name: freshkeeper-check
description: Check every installed Skill without changing it, recover missing GitHub provenance from verified catalogs and local evidence, compare whole Skill directories, and use upstream history to distinguish current, clean-old, incomplete, locally extended, diverged, locally ahead, and legacy Skills. Use when the user invokes `$freshkeeper-check`, says `freshkeeper check`, asks whether installed Skills are current, or asks for `freshkeeper check with details`, source coverage, untracked Skills, update safety, library ownership, or a per-Skill status report. Prefer the shared library and fall back to supported AI tools' user-level libraries.
---

# Freshkeeper Check

Inspect the user's installed Skills. Do not check or update Claude Code, Codex, OpenClaw, Hermes, Freshkeeper itself, plugins, schedules, or project toolchain locks.

## Discover the installed libraries

Use this order:

1. If the shared Universal library `~/.agents/skills` exists, treat it as canonical and check it.
2. Otherwise, discover the user-level Skill libraries for Claude Code, Codex, OpenClaw, and Hermes. Respect `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `HERMES_HOME`; also recognize OpenClaw's `.openclaw`, `.clawdbot`, and `.moltbot` homes.
3. Resolve real paths. Count one physical Skill once when multiple tools reach it through directory or Skill symlinks, while retaining every tool that can see it.
4. Treat distinct copied installations as distinct even when they share the same Skill name.

Read global source metadata from `$XDG_STATE_HOME/skills/.skill-lock.json` when `XDG_STATE_HOME` is set, otherwise `~/.agents/.skill-lock.json`. For missing metadata, accept a source only after the bundled catalog, an embedded Git remote, frontmatter, NOTICE, or README points to a repository and the official tree contains a comparable Skill path. A same-name search result alone is never proof.

## Choose the output mode

- `$freshkeeper-check` or `freshkeeper check`: return library mode, totals, confirmed updates, coverage gaps, and errors.
- `$freshkeeper-check with details` or “详细检查”: additionally list every installed Skill with status, visible tools, source, and reason.
- Treat `with details` as an output mode, not a Skills CLI argument.

## Run the read-only checker

Resolve the directory containing this `SKILL.md`, then run:

```text
node <skill-directory>/scripts/check-installed-skills.mjs
```

For detailed output, add `--details`. Use `--json` only when structured output helps analysis. History matching checks up to 200 relevant commits by default and uses a temporary bare clone only for divergent or removed paths. Use `--no-history` for a faster current-tree-only pass, or `--history-limit <0-200>` to set an explicit depth.

The checker:

1. Selects the shared library or agent-local fallback libraries.
2. Inventories top-level directories containing `SKILL.md` and deduplicates symlink aliases by real path.
3. Reads recorded sources from the global `.skill-lock.json`.
4. Recovers missing provenance from strong local evidence and the bundled verified catalog.
5. Compares normalized Git blob snapshots of the whole Skill directory, ignoring only runtime artifacts such as `.git`, `__pycache__`, `.DS_Store`, and `*.pyc`.
6. When current content differs, searches upstream history to prove whether the installed files match an older commit.
7. Never writes to a Skill library, lock file, or provenance cache. Temporary Git data is removed before exit.

## Interpret results honestly

Use these meanings:

- `current`: the recorded installed GitHub folder hash matches upstream.
- `update-available`: the upstream folder hash changed.
- `exact-current`: recovered source and entire installed directory match current upstream.
- `clean-old`: installed files match a historical upstream commit and can be three-way updated.
- `current-subset`: every installed file matches current upstream; only upstream resources are missing.
- `local-extension`: the upstream tree is current and additional local files must be preserved.
- `manual-merge`: local and upstream content both changed; never overwrite automatically.
- `local-ahead`: local source is newer than the published remote.
- `legacy-local`: installed files match upstream history, but the current branch removed the Skill.
- `unresolved`: no reliable public source was proven.
- `untracked`: the Skill exists locally but has no source entry and source recovery found nothing reliable.
- `uncheckable`: a source exists but lacks comparable version metadata.
- `local-only`: the recorded source is local.
- `missing-upstream`, `check-blocked`, or `check-failed`: report the problem; do not call the Skill current.

Say “no updates confirmed among checkable Skills,” not “all Skills are current,” when any installed Skill is uncheckable.

## Safety boundary

- Never run `skills update`, `skills add`, `skills remove`, or any Freshkeeper update command.
- Never modify, delete, reconcile, migrate, or prune any Skill library.
- Never write recovered provenance into `.skill-lock.json`; report the evidence and confidence only.
- Keep GitHub comparison read-only.

## Invocation examples

- `$freshkeeper-check`
- `$freshkeeper-check with details`
- `检查我安装的所有 Skill 有没有更新，不要安装`
