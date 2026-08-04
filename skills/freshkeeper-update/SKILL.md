---
name: freshkeeper-update
description: Safely update all updateable Skills installed in the user's shared/global Skill library while backing up the library, preserving local and untracked Skills, and reporting coverage gaps. Use when the user invokes `$freshkeeper-update`, says `freshkeeper update`, or explicitly asks to update all installed Skills. This Skill updates Skills, not Freshkeeper itself or AI coding tool binaries, plugins, or agents.
---

# Freshkeeper Update

Update installed Skills in the shared/global Skill library. Do not update Claude Code, Codex, OpenClaw, Hermes, Freshkeeper itself, plugins, crontab, or project toolchain locks.

## Confirm the scope

An explicit `$freshkeeper-update`, `freshkeeper update`, or request to update all installed Skills authorizes updates to source-tracked shared Skills. It does not authorize deleting obsolete Skills, inventing sources for untracked Skills, or installing newly discovered Skills.

Use the global/shared library reported by Skills CLI. On this Mac it is `/Users/elninozhong/.agents/skills`; Claude sees the same library through `/Users/elninozhong/.claude/skills`.

## Resolve Skills CLI

Prefer an installed `skills` command. Otherwise use `npx --yes skills@latest` temporarily. Do not globally install the CLI.

Use the global scope explicitly in every command. Never rely on current-directory auto-detection.

## Inventory and back up first

Before updating:

1. Run `skills list -g --json` and save the complete pre-update inventory.
2. Read `~/.agents/.skill-lock.json` and classify installed Skills as GitHub-tracked, well-known, local, or untracked.
3. Create a timestamped recovery copy under `~/.agents/skill-backups/` containing the shared Skill directories and `.skill-lock.json`.
4. Verify `/Users/elninozhong/.claude/skills` still resolves to the shared root when working on this Mac.

Stop before mutation if the inventory or backup cannot be verified.

## Update tracked Skills

Run:

```text
skills update -g -y
```

This checks and updates Skills with sufficient source and folder-hash metadata. Non-interactive mode must remain enabled so an upstream deletion is reported and skipped rather than removing the local copy.

For a `well-known` source that Skills CLI reports as uncheckable, derive the source base URL by removing `/.well-known/...` from its recorded `sourceUrl`. Refresh only the exact Skill names already present in the pre-update inventory, grouped by that base URL:

```text
skills add <recorded-base-url> --skill <installed-skill-names...> -g -y
```

Do not use `--all`. Do not add upstream Skills that were not installed before the run.

Skip local and untracked Skills. Do not guess where they came from.

## Verify after updating

1. Run `skills list -g --json` again.
2. Compare names and paths with the pre-update inventory.
3. Treat any missing pre-existing Skill as a failure. Restore only the missing Skill from the recovery copy and report it.
4. Verify the Claude-visible shared path still resolves.
5. Report updated, already-current, refreshed-without-version-proof, skipped, restored, and failed Skills separately.

Do not claim that every installed Skill was updated when source metadata made some Skills uncheckable.

## Safety boundary

- Never delete, prune, or broadly reconcile the shared library.
- Never overwrite a local or untracked Skill with a guessed remote source.
- Never update agent binaries, plugins, schedules, or project locks.
- Never remove the recovery copy during the same run.

## Invocation examples

- `$freshkeeper-update`
- `freshkeeper update，把我装的所有可更新 Skill 更新掉`
