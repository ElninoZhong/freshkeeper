---
name: freshkeeper-check
description: "Quickly check installed Skill sources and updates, then give actionable next steps; trace history only when requested."
---

# Freshkeeper Check

Check installed Skills and explain what to do next. Ordinary checks are read-only.
An explicit request to fill source/version tracking authorizes metadata repair only.
Keep AI tools, Freshkeeper application binaries, plugins, schedules and project locks outside this workflow.

## Default: quick and bounded

Resolve this Skill directory and run:

```text
node <skill-directory>/scripts/check-installed-skills.mjs
```

- Prefer `~/.agents/skills`; otherwise use existing supported agent-local libraries. Resolve physical paths and count aliases once, retaining visible tools.
- Default to current-directory comparison, six concurrent provenance checks and a 60-second upstream work budget. Repository responses are reused within the run. Ordinary checks never write a library, source lock or persistent cache.
- Use `--json` for analysis or `--details` for every row. “with details” changes reporting, not history depth.
- Read and validate local evidence before network calls. A missing evidence path or one failed Skill stays in the result and does not discard healthy results.
- Stop the whole run only when the library root or source lock cannot be read safely. Changed local files and timeouts invalidate only the affected results.
- Retry only affected names using repeated `--skill <name>`; do not rerun the full library to recover one failed item.

The global source lock is `$XDG_STATE_HOME/skills/.skill-lock.json` when configured,
otherwise `~/.agents/.skill-lock.json`. Reuse confirmed per-path provenance as well
as CLI source entries. A referenced repository must still contain a comparable
current or evidenced historical Skill path; a same-name search alone is not proof.

## History: only when needed

Use this when the user requests history/deep checking, or needs proof that a
particular divergent Skill is an unchanged old release:

```text
node <skill-directory>/scripts/check-installed-skills.mjs --history --skill <name>
```

`--history` checks up to 200 relevant commits, within a default 180-second budget.
`--history-limit <0-200>` controls the depth; `--no-history` explicitly selects quick mode.
Use `--timeout-ms <milliseconds>` only when the task needs a different budget.
Temporary bare clones are cleaned up. Do not start library-wide history merely
because a quick check found differences.

## Report actions, not just counts

Lead with mode, coverage and elapsed time, then use the script's `actions` groups:

- **Update candidates:** `clean-old`, `current-subset`, or a well-known `update-available` verified against its installed directory digest has a proven basis. Describe the proposed update; execute it only under an update request.
- **Review differences:** `needs-review` means current content differs and history has not established its base. It is not proof of local modification or a required manual merge. Deep-check only selected items if useful.
- **Preserve local adaptation:** `local-modified` means the recorded upstream base is current while local content differs. `local-extension` retains additional local files. Neither should trigger a wholesale replacement.
- **Repair sources:** identify missing provenance or the specific evidence pointer to repair, with the evidence still needed. Do not guess.
- **Retired/moved upstream:** keep the local Skill and report the missing path. Do not delete it.
- **Retry:** isolate network errors, unreadable items, changed files and timeouts. A failed check never means current.
- **No action:** whole-directory matches, verified local authorship and deliberately local-ahead Skills.

The concise response should name the small actionable sets and link or use detailed
output for large lists. Include source coverage gaps and errors. Never claim all
Skills are current when any source or check is unresolved. Do not suggest the same
full-library rerun as the next step.

## Explicit metadata repair

Only when requested, preview and then apply:

```text
node <skill-directory>/scripts/check-installed-skills.mjs --fill-metadata --json
node <skill-directory>/scripts/check-installed-skills.mjs --fill-metadata --apply-metadata --json
```

Limit scope with `--skill`. Failed or changed items are excluded from writes;
valid items retain their own results. The writer backs up and verifies the source
lock, revalidates local snapshots and commits atomically. Preserve existing
installation baselines and unrelated fields. Track actual root or `metadata.version`
values when present, otherwise content revisions; never assign today's upstream
release to a different local copy. Unknown Git installation baselines remain unknown
and must not become automatic CLI update entries.

For evidenced local or application-bundled origins, read
[references/version-tracking.md](references/version-tracking.md) and provide the
explicit source map described there. Personal evidence belongs in runtime metadata,
not the publishable catalog.

## Boundaries

Do not run `skills update`, `skills add`, `skills remove`, or another update command
under a check request. Do not delete, reconcile, migrate or prune Skill libraries.
Metadata repair never refreshes Skill content. Compare the whole normalized directory,
ignoring only runtime artifacts such as `.git`, `node_modules`, `__pycache__`, `.DS_Store`
and `*.pyc`. Source/index request failures remain visible; an index protocol version
is not a Skill release.
