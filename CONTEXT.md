# Freshkeeper Domain Context

## Terms

- **Adapter**: a tool-specific implementation that detects, checks, and updates one supported tool family.
- **Adapter catalog**: the known adapters plus the `enabledAdapters` selection policy used to build the runtime Registry.
- **Update run**: one orchestration pass across enabled, installed adapters, producing updated and failed outcomes.
- **Skills update plan**: the fail-closed decision that chooses a project-lock refresh, an explicitly opted-in global refresh, a safe skip, or an error.
- **Project skill lock**: the nearest valid `skills-lock.json`, or the lock selected by `FRESHKEEPER_SKILLS_CWD`.
- **Shared skill library**: the external Universal/user skill root that may be mutated by an authorized Skills update plan; on this Mac its canonical path is `/Users/elninozhong/.agents/skills`.
- **Schedule**: the single marker-delimited Freshkeeper block installed into a user's existing crontab while preserving all unrelated entries.
- **Runtime home**: external mutable configuration and logs selected by `FRESHKEEPER_HOME`.

## Invariants

1. A missing or invalid project skill lock never widens mutation scope.
2. Disabled adapters are not detected or updated.
3. Existing crontab content crosses the scheduler seam as data through stdin, never as constructed shell code.
4. Network-only changelog failure never changes the result of an already completed update run.
5. Tests cross process and filesystem seams only through mocks or isolated temporary directories.
