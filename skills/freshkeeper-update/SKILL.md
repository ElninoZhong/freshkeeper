---
name: freshkeeper-update
description: Safely update installed Skills from both recorded and evidence-recovered sources. Back up selected libraries, compare whole directories, prove clean historical bases, add missing upstream resources, preserve local extensions, require manual merges for diverged content, and retain locally ahead or upstream-deleted Skills. Use when the user invokes `$freshkeeper-update`, says `freshkeeper update`, or explicitly asks to update all installed Skills. Prefer the shared library and fall back to supported AI tools' user-level libraries; never update Freshkeeper itself, AI tool binaries, plugins, or agents.
---

# Freshkeeper Update

Update installed Skills without changing Claude Code, Codex, OpenClaw, Hermes, Freshkeeper itself, plugins, schedules, or project toolchain locks.

## Confirm the scope

An explicit `$freshkeeper-update`, `freshkeeper update`, or request to update all installed Skills authorizes recorded updates plus evidence-recovered `clean-old` and `current-subset` updates. It does not authorize guessing sources, overwriting `manual-merge` Skills, deleting `legacy-local` Skills, installing newly discovered Skills, or migrating agent-local libraries into a shared library.

Use this order:

1. If `~/.agents/skills` exists, update that canonical shared library.
2. Otherwise, fall back to the existing user-level Skill libraries for Claude Code, Codex, OpenClaw, and Hermes. Respect `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `HERMES_HOME`; recognize OpenClaw's legacy homes.
3. Resolve real paths. Update one physical Skill once when multiple tools reach it through symlinks, and leave those symlinks intact.
4. Treat distinct copied installations independently and update them in their original tool libraries.

## Resolve Skills CLI

Prefer an installed `skills` command. Otherwise use `npx --yes skills@latest` temporarily. Do not globally install the CLI.

## Inventory and back up first

Resolve this Skill's directory. Choose a temporary plan path and run the bundled planner read-only first:

```text
node <skill-directory>/scripts/prepare-skill-update.mjs --write-plan <temporary-plan.json> --json
```

Stop if it reports `libraryMode: none`, an unreadable library, or malformed lock metadata. Then create and verify the recovery copy:

```text
node <skill-directory>/scripts/prepare-skill-update.mjs --backup --write-plan <temporary-plan.json> --json
```

The plan includes recorded sources, recovered evidence, whole-directory snapshot hashes, current upstream tree hashes, and historical base commits. The backup contains every selected physical library, the global lock when present, and a manifest under `~/.agents/skill-backups/`. Do not mutate anything unless the returned backup paths exist and the manifest matches the pre-update inventory.

Historical matching checks up to 200 relevant commits by default. Use `--no-history` only for a quick preview that cannot prove older clean versions, or `--history-limit <0-200>` to set an explicit depth.

## Update a shared library

When the planner reports `libraryMode: shared`, run:

```text
skills update -g -y
```

This updates global source-tracked Skills. Non-interactive mode must remain enabled so an upstream deletion is reported and skipped rather than removing the local copy.

For a `well-known` entry that cannot be version-compared, remove `/.well-known/...` from its recorded `sourceUrl` and refresh only the exact Skill names already present:

```text
skills add <recorded-base-url> --skill <installed-skill-names...> -g -y
```

Do not use `--all` or install names absent from the pre-update inventory.

## Update agent-local fallback libraries

When the planner reports `libraryMode: agent-local`, do not run `skills update -g`: that can create `~/.agents/skills` and silently migrate the installation model.

For every planner item marked `updateable` or `refreshable`, use its exact `installSource`, `name`, and `writeAgents`:

```text
skills add <installSource> --skill <name> -g --copy --agent <writeAgents...> -y
```

Add `--full-depth` only when the planner sets `fullDepth: true`. `writeAgents` contains one owning directory for each physical installation, so symlink aliases remain intact. Run items separately when copied installations with the same name have different physical paths.

Skip `local-only`, `untracked`, and `uncheckable` items. Never guess their sources. If an item has only symlink aliases and no safe owning directory, report it instead of replacing a symlink.

## Apply recovered-source updates

Only planner items marked `recoverable-update` may cross this seam. First preview the file actions:

```text
node <skill-directory>/scripts/apply-provenance-updates.mjs --plan <temporary-plan.json> --json
```

Then apply them:

```text
node <skill-directory>/scripts/apply-provenance-updates.mjs --plan <temporary-plan.json> --apply --json
```

The executor:

1. Revalidates the backup, installed snapshot, upstream tree, and historical base.
2. For `current-subset`, adds only missing upstream files.
3. For `clean-old`, performs a three-way update: replace files still equal to the historical base, remove only files proven to have been upstream-managed and deleted upstream, and preserve unrelated local files.
4. Stops on any local conflict and restores the affected Skill from the verified backup after a partial failure.

Do not pass `manual-merge`, `local-ahead`, `legacy-local`, `local-extension`, `unresolved`, or `check-blocked` items to the executor. Report them separately.

## Verify after updating

1. Run the planner again without `--backup`.
2. Compare every pre-update Skill name, physical path, and visible-tool set with the backup manifest.
3. Treat any missing pre-existing Skill or broken symlink as failure. Restore only the affected physical Skill from the recovery copy and report it.
4. In shared mode, verify each pre-existing tool alias still resolves to the shared physical Skill.
5. In fallback mode, verify `~/.agents/skills` was not created.
6. Report recorded updates, recovered safe updates, already-current, local extensions, manual merges, local-ahead, legacy-local, unresolved, restored, and failed Skills separately.

Do not claim every installed Skill was updated when source metadata made some Skills uncheckable.

## Safety boundary

- Never delete, prune, broadly reconcile, or silently migrate a Skill library.
- Never overwrite a local or untracked Skill with a guessed remote source.
- Never treat a name match as provenance or write recovered candidates into the global lock automatically.
- Never update AI tool binaries, plugins, schedules, or project locks.
- Never remove the recovery copy during the same run.

## Invocation examples

- `$freshkeeper-update`
- `freshkeeper update，把我装的所有可更新 Skill 更新掉`
