# Freshkeeper Project Rules

These rules apply to the entire repository.

## Authority and paths

- The only editable source of truth is `/Users/elninozhong/Documents/Projects/freshkeeper`.
- `/Users/elninozhong/Documents/Claude/Projects/freshkeeper` is a compatibility symlink for historical Claude tasks. Never replace it with a second checkout or edit through it as a separate project.
- Runtime configuration and logs belong under `FRESHKEEPER_HOME` (default `~/.freshkeeper`) and must not enter Git.
- Read `SOURCE_OF_TRUTH.md` and `CONTEXT.md` before changing update, scheduling, skill, or release behavior.

## Shared-skill safety

- The canonical shared user skill library on this Mac is `/Users/elninozhong/.agents/skills`.
- Never delete, move, prune, reconcile, or broadly rewrite shared skills as part of tests, migration, inspection, or cleanup.
- Tests must mock every updater and must not run `freshkeeper update`, `freshkeeper init`, `skills update`, `skills add`, or a real schedule mutation.
- Missing, empty, or malformed `skills-lock.json` must fail closed. A broader global skill update requires the explicit `FRESHKEEPER_ALLOW_GLOBAL_SKILLS_UPDATE=1` opt-in.
- Any future transactional skill updater must stage changes, verify its declared revision and inventory, preserve a recovery copy, and roll back partial failure before it may claim success.

## Engineering practice

- Keep adapter selection driven by `enabledAdapters`; disabled adapters must not be detected or updated.
- Keep external process execution behind `safeExec`. Pass arguments and stdin directly; do not construct shell command strings from user or existing-system data.
- Scheduling changes must validate cron input, preserve unrelated crontab entries, and surface read and write failures.
- Use synthetic temporary directories and mocked external commands in tests.
- Before handoff, run:

  ```bash
  npm run lint
  npm test
  npm run build
  npm pack --dry-run
  ```

- Do not publish npm packages, create tags, push commits, or alter real cron/update state without explicit user approval.

## Documentation and design

- `CONTEXT.md` defines domain language. `SOURCE_OF_TRUTH.md` defines authority. Update them with behavior changes.
- Use module, interface, implementation, depth, seam, adapter, leverage, and locality when documenting architecture.
- `CLAUDE.md` is a thin compatibility pointer only; it must not duplicate these rules.
