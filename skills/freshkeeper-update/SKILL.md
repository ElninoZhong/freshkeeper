---
name: freshkeeper-update
description: "Run bounded, resumable installed-Skill updates with verified recovery copies and preservation of local adaptations."
---

# Freshkeeper Update

Use the bundled Node.js workflow. An explicit `$freshkeeper-update` or request to
update installed Skills authorizes its safe update path. Keep agent binaries,
Freshkeeper application binaries, plugins, schedules and project locks outside scope.

## One entry point

For an authorized update, resolve this Skill directory and run:

```text
node <skill-directory>/scripts/update-skills.mjs --apply --json
```

For a preview, omit `--apply`. It writes only a private job, response cache and staged
payloads, not Skill contents or source metadata. Do not replace this workflow with
new temporary installers, `skills update -g`, `skills add --all`, or a library-wide
copy. No Skills CLI or global dependency installation is needed.

The workflow performs **one quick check → one reusable recovery set → verified
updates → local verification**. It is self-contained; a separate check Skill install
is not required. Shared helper copies are synchronized and tested in the repository.

## Reuse rather than repeat

- Default overall work budget: 180 seconds, including checking, staging and writes.
  The current atomic operation or recovery may finish after the budget; no new item
  starts once the budget expires. Use `--timeout-ms` only when a different budget is needed.
- Default check is current-tree only. HTTP responses and pinned payloads are reused
  within the job. Do not start library-wide historical matching.
- To reuse a recent check, pass `--from-check <report.json>`. The source-metadata
  fingerprint and local content identities must still match. The report is a frozen
  observation with a displayed check time, not a promise about later upstream changes.
- Use repeated `--skill <name>` to narrow scope. Use `--history --skill <name>` only
  when historical proof is actually requested or needed for that item.
- `--write-plan <path.json>` saves a plan locator outside Skill libraries. Mutable
  execution state stays in its private checkpoint. The plan cannot change scope on resume.

Apply a prepared plan without checking or staging the whole library again:

```text
node <skill-directory>/scripts/update-skills.mjs --plan <path.json> --apply --json
```

Retry only failed writes, reusing their existing stages and recovery copies:

```text
node <skill-directory>/scripts/update-skills.mjs --plan <path.json> --apply --retry-failed --json
```

A failed check, changed local file or interrupted staging needs a fresh **targeted**
run with `--skill <name> --apply`; do not rerun every Skill. Do not repeat the same
failure without new evidence. A metadata/scope conflict stops writes and leaves
successful results and recovery material available.

## What may update

The shared Universal library is canonical when present; otherwise use the existing
supported agent-local libraries. Resolve physical paths, update each once, preserve
aliases, and keep distinct copied installations independent. Never migrate libraries.

The engine accepts only:

- An evidenced `clean-old` directory with a verified historical base on the selected
  publisher history, or a `current-subset` whose existing files already match upstream.
- A recorded Git installation base that matches every local managed file except an
  existing description adaptation. It preserves that description and custom file
  permissions while updating the remaining upstream content.
- A well-known source whose actual complete local bytes match its recorded installed
  digest and whose official file-list payload is validated.

A source entry alone is not proof of safe replacement. Local body/script changes,
extra or missing local files, unsupported source layouts, unresolved origins and
manual-merge policies remain protected. Never guess a source, reset a first baseline,
install newly discovered Skills, overwrite a local customization, or delete a Skill
because its upstream path disappeared. No `--force` bypass exists.

## Recovery and verification

Only directories about to be written are copied, once per job, into a recovery set
under `~/.agents/skill-backups/`, along with the original source metadata and inventory.
Copies preserve literal symlink targets and are content-verified before use. No
backup is needed for a no-op run. Existing copies are verified and reused on retry.

Each item checks local/staged identities again, writes only its declared managed
paths, verifies the payload, and atomically commits only its successful version
metadata. The first tracking baseline and unrelated records stay intact. New origin
candidates are not automatically registered in the global source lock.

A write or metadata failure restores that item while preserving successful peers.
An interruption is recovered from the owned checkpoint; a completed metadata commit
is recognized instead of installing twice. Unexpected concurrent edits are left for
review. Final verification preserves all pre-existing names, physical paths and tool
aliases. Do not remove recovery copies during the same run.

## Report the outcome

Use the structured result: actual updates this run, previous completed updates reused,
protected differences, source problems, upstream removals, failed items, preserved
adaptations, check time and recovery path. `updated: 0` must not be described as an
update. Distinguish a verified local adaptation from an unverified old version.
Do not claim every Skill was updated when items were protected or uncheckable.

`prepare-skill-update.mjs` and `apply-provenance-updates.mjs` remain compatibility
interfaces. They are not the default workflow and their capability labels do not
authorize an unchecked overwrite.
