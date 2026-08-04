---
name: freshkeeper-update
description: Actually update all installed, enabled AI coding tools through Freshkeeper and report successes, skips, failures, and changelogs. Use when the user says `freshkeeper update`, invokes `$freshkeeper-update`, or explicitly asks Freshkeeper to upgrade Claude Code, Codex, OpenClaw, Hermes, plugins, or skills. This is a mutating operation; do not trigger it for check-only or details-only requests.
---

# Freshkeeper Update

Run Freshkeeper's real update operation. This Skill is intentionally separate from `freshkeeper-check`: an update request authorizes updates, while a check request never does.

## Confirm the requested operation

- `$freshkeeper-update`, `freshkeeper update`, “用 Freshkeeper 更新”, and equivalent direct requests authorize one `freshkeeper update` run.
- Do not pre-run `freshkeeper check` merely because it is available.
- Do not use this Skill for `freshkeeper check` or `freshkeeper check with details`.
- Do not widen the request into `init`, `lock`, `restore`, `update --respect-lock`, or a schedule change.

## Resolve the runner

1. Work from the directory the user placed in scope. This matters because the skills adapter discovers the nearest project `skills-lock.json` from that directory.
2. Use `freshkeeper` when installed, after checking `freshkeeper --version`.
3. When it is absent and the user explicitly invoked this Skill or asked to use Freshkeeper, use `npx --yes freshkeeper@latest` temporarily. Do not install it globally.
4. If the configured npm mirror has not synchronized a known published version, retry only the Freshkeeper package through `https://registry.npmjs.org/`; preserve the user's normal registry configuration.
5. Use the same resolved runner for the whole operation.

## Inspect the mutation boundary

Before updating:

1. Read `~/.freshkeeper/config.json` when it exists.
2. Name the enabled adapters that the run may affect. Disabled adapters stay untouched.
3. If `skills-cli` is enabled, inspect the nearest `skills-lock.json` when present. A missing lock means the adapter safely skips project skill writes; a malformed lock is an error, not permission for a global refresh.
4. Never set `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1` unless the user separately and explicitly requests a broad global skills refresh and accepts the wider scope.

## Run the update

Run exactly:

```text
freshkeeper update
```

Do not reimplement adapters or fall back to raw third-party update commands after a failure. Keep all update authority in Freshkeeper.

## Verify and report

Report:

1. The command and working directory used.
2. Enabled adapters inspected by the run.
3. Successful updates.
4. Safe skips, especially skills skipped because no valid project lock authorized them.
5. Failed adapters and their reported errors.
6. Changelog links or summaries emitted by Freshkeeper.

Do not infer complete success from a zero exit code when Freshkeeper reports a failed adapter. Do not claim that a skipped adapter was updated.

## Safety boundary

- Never run a real update during tests; use mocks and isolated temporary directories.
- Never delete, prune, reconcile, or broadly rewrite unrelated global plugins or `~/.agents/skills`.
- Never change crontab, project locks, or Freshkeeper configuration as a side effect.

## Invocation examples

- `$freshkeeper-update`
- `freshkeeper update`
- `用 Freshkeeper 更新所有已启用的 AI coding 工具`
