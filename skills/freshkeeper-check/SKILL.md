---
name: freshkeeper-check
description: Audit installed Skill versions, provenance and whole-directory drift; optionally fill missing version and
  source tracking on explicit request. Use for update readiness or source coverage; prefer the shared library.
---

# Freshkeeper Check

Inspect the user's installed Skills. Ordinary checks are read-only. An explicit request to fill versions or source tracking authorizes metadata repair only. Do not check or update Claude Code, Codex, OpenClaw, Hermes, Freshkeeper itself, plugins, schedules, or project toolchain locks.

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
3. Reads recorded sources from the global `.skill-lock.json` and completes the local version/whole-directory snapshot preflight for every selected Skill before making any upstream request. A local read failure stops the check.
4. Recovers missing provenance from strong local evidence and the bundled verified catalog.
5. Compares normalized Git blob snapshots of the whole Skill directory, ignoring only runtime artifacts such as `.git`, `__pycache__`, `.DS_Store`, and `*.pyc`.
6. When current content differs, searches upstream history to prove whether the installed files match an older commit. Revalidates the local snapshots before reporting or filling metadata; a local change during the check stops the run.
7. In ordinary check mode, never writes to a Skill library, lock file, or provenance cache. Temporary Git data is removed before exit.

For official `.well-known/skills` or `.well-known/agent-skills` file-list indexes, compare the whole directory and the install-time `wellKnownDigest`. Check errors remain visible; a failed request never means current. An index protocol version is not a Skill release version.

## Fill missing version and source tracking

Use this mode only when the user explicitly requests it. Preview first:

```text
node <skill-directory>/scripts/check-installed-skills.mjs --fill-metadata --json
```

Then apply the authorized metadata repair:

```text
node <skill-directory>/scripts/check-installed-skills.mjs --fill-metadata --apply-metadata --json
```

Use repeated `--skill <installed-name>` to limit the repair to named existing Skills. `--fill-metadata` without `--apply-metadata` never writes.

- Record an actual frontmatter version when present, an evidenced Git revision when matched, or a SHA-256 content revision otherwise. Never invent a semantic version or assign the current upstream release to a different installed copy.
- Keep installed content identity, the first tracking baseline, and observed upstream version separate. Do not replace the installation-time Git folder hash or `wellKnownDigest` with the latest upstream hash.
- Store per-physical-path records in the global lock's `freshkeeperTracking` field; aliases share a record, separate copies retain separate records. Preserve other lock fields. Confirmed recovered GitHub sources can also become ordinary source entries without pretending their installed revision is known.
- Before writing, revalidate the lock and installed snapshots, create and verify a recovery copy, then atomically replace only the metadata file. No Skill content is refreshed.
- Report unknown origins honestly, even when a local content revision has been recorded. A tracked unknown origin is still a coverage gap.
- For locally authored or application-bundled Skills, read [references/version-tracking.md](references/version-tracking.md) to supply an explicit evidence map. Personal evidence paths belong to runtime metadata, not the publishable catalog.

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
- `local-tracked`: local authorship is evidenced and its content revision is tracked; there is no public upstream release to compare.
- `bundled-current`: the directory matches its evidenced application-bundled source.
- `missing-upstream`, `check-blocked`, or `check-failed`: report the problem; do not call the Skill current.

Say “no updates confirmed among checkable Skills,” not “all Skills are current,” when any installed Skill is uncheckable.

## Safety boundary

- Never run `skills update`, `skills add`, `skills remove`, or any Freshkeeper update command.
- Never modify, delete, reconcile, migrate, or prune any Skill library.
- Ordinary checks never write recovered provenance into `.skill-lock.json`. Explicit metadata-fill mode may write only evidenced sources and content tracking after backup and revalidation.
- Keep GitHub comparison read-only.

## Invocation examples

- `$freshkeeper-check`
- `$freshkeeper-check with details`
- `检查我安装的所有 Skill 有没有更新，不要安装`
- `补全缺失版本号和来源追踪，只补元数据，不更新 Skill 内容`
