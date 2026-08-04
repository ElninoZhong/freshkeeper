---
name: freshkeeper-check
description: Check every Skill installed in the user's shared/global Skill library for upstream updates without changing any Skill. Use when the user invokes `$freshkeeper-check`, says `freshkeeper check`, asks whether their installed Skills are current, or asks for `freshkeeper check with details`, source coverage, update availability, untracked Skills, or a per-Skill status report. This Skill checks Skills, not Freshkeeper itself or AI coding tool binaries.
---

# Freshkeeper Check

Inspect the user's installed Skills. Do not check or update Claude Code, Codex, OpenClaw, Hermes, Freshkeeper itself, plugins, crontab, or project toolchain locks.

## Target the shared library

Use the global/shared Skill library reported by Skills CLI. On this Mac its canonical location is `/Users/elninozhong/.agents/skills`, and Claude sees the same library through `/Users/elninozhong/.claude/skills`.

Treat every top-level directory containing `SKILL.md` as an installed Skill. Use `/Users/elninozhong/.agents/.skill-lock.json` as source metadata when present. Never assume an untracked Skill has a particular upstream repository.

## Choose the output mode

- `$freshkeeper-check` or `freshkeeper check`: return totals, confirmed updates, coverage gaps, and errors.
- `$freshkeeper-check with details` or “详细检查”: additionally list every installed Skill with its status, source, and reason.
- `with details` is an output mode, not a Skills CLI argument.

## Run the read-only checker

Resolve the directory containing this `SKILL.md`, then run:

```text
node <skill-directory>/scripts/check-installed-skills.mjs
```

For detailed output, add `--details`. Use `--json` only when structured output helps analysis.

The checker:

1. Inventories the entire shared Skill library.
2. Reads recorded sources from `.skill-lock.json`.
3. Groups GitHub-tracked Skills by repository and compares recorded folder tree hashes with current upstream trees.
4. Marks local, well-known-without-hash, and untracked Skills as uncheckable instead of guessing.
5. Never writes to the Skill library or lock file.

## Interpret results honestly

Use these meanings:

- `current`: the recorded installed GitHub folder hash matches upstream.
- `update-available`: the upstream folder hash changed.
- `untracked`: the Skill exists locally but has no source entry.
- `uncheckable`: a source exists but lacks comparable version metadata.
- `local-only`: the recorded source is local.
- `missing-upstream` or `check-failed`: report the problem; do not call the Skill current.

Say “no updates confirmed among checkable Skills,” not “all Skills are current,” when any installed Skill is uncheckable.

## Safety boundary

- Never run `skills update`, `skills add`, `skills remove`, or any Freshkeeper update command.
- Never modify, delete, reconcile, or prune shared Skills.
- Never repair missing source metadata by inference.
- Network access for GitHub comparison is read-only.

## Invocation examples

- `$freshkeeper-check`
- `$freshkeeper-check with details`
- `检查我安装的所有 Skill 有没有更新，不要安装`
