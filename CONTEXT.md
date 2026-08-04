# Freshkeeper Domain Context

## Terms

- **Adapter**: a tool-specific implementation that detects, checks, and updates one supported tool family.
- **Adapter catalog**: the known adapters plus the `enabledAdapters` selection policy used to build the runtime Registry.
- **Update run**: one orchestration pass across enabled, installed adapters, producing updated and failed outcomes.
- **Skills update plan**: the fail-closed decision that chooses a project-lock refresh, an explicitly opted-in global refresh, a safe skip, or an error.
- **Project skill lock**: the nearest valid `skills-lock.json`, or the lock selected by `FRESHKEEPER_SKILLS_CWD`.
- **Project toolchain lock**: the nearest valid `freshkeeper.lock.json`; it records exact adapter state that `restore` and `update --respect-lock` must verify before claiming success.
- **Freshkeeper check Skill**: the repository-owned `skills/freshkeeper-check/SKILL.md` read-only wrapper; its detailed mode combines `list` and `check` without inventing a third CLI command.
- **Freshkeeper update Skill**: the repository-owned `skills/freshkeeper-update/SKILL.md` mutating wrapper that delegates one authorized update run to the CLI.
- **Locked restore**: a fail-closed reconciliation pass that operates only on enabled adapters and never substitutes a newer version for an unavailable pin.
- **Shared skill library**: the external Universal/user skill root that may be mutated by an authorized Skills update plan; on this Mac its canonical path is `/Users/elninozhong/.agents/skills`.
- **Schedule**: the single marker-delimited Freshkeeper block installed into a user's existing crontab while preserving all unrelated entries.
- **Runtime home**: external mutable configuration and logs selected by `FRESHKEEPER_HOME`.

## Invariants

1. A missing or invalid project skill lock never widens mutation scope.
2. Disabled adapters are not detected or updated.
3. Existing crontab content crosses the scheduler seam as data through stdin, never as constructed shell code.
4. Network-only changelog failure never changes the result of an already completed update run.
5. Tests cross process and filesystem seams only through mocks or isolated temporary directories.
6. A locked restore succeeds only after the observed post-restore state matches the declared version, commit, enabled state, and content hash that apply to that adapter.
7. Locked project skills cross the mutation seam only after staging and verification; partial application restores the recovery copy and prior `skills-lock.json`.
8. A project lock never authorizes pruning unrelated global plugins or mutating disabled adapters.
9. The check Skill never mutates, and the update Skill never substitutes its own update logic for the CLI or widens into initialization, locking, restoration, or scheduling.
