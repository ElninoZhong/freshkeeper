# Freshkeeper Domain Context

## Terms

- **Adapter**: a tool-specific implementation that detects, checks, and updates one supported tool family.
- **Adapter catalog**: the known adapters plus the `enabledAdapters` selection policy used to build the runtime Registry.
- **Primary agent**: the user-selected owner (`claude`, `codex`, `openclaw`, or `hermes`) that determines the generated adapter plan and resolves shared ownership choices such as the `claude-mem` mutation route.
- **Memory provider**: the independent user selection (`claude`, `codex`, `gemini`, or `openrouter`) that determines which inference path generates claude-mem observations; it never changes MCP ownership.
- **Update run**: one orchestration pass across enabled, installed adapters, separating verified changes, already-current items, skips, and failures.
- **Check coverage**: an adapter's declared preflight certainty: `complete` when all updateable items can be compared read-only, `partial` when only some can, and `unavailable` when the upstream exposes no reliable non-mutating query.
- **Already current**: an update command or deterministic plan completed without a verified version or content-hash change; it is never counted as updated.
- **Update disposition**: the checked action for a confirmed newer version: `update` when Freshkeeper has a safe mutation path, or `skip` when the same update run will preserve it behind an explicit safety reason.
- **Skills update plan**: the fail-closed decision that chooses a project-lock refresh, an explicitly opted-in global refresh, a safe skip, or an error.
- **Project skill lock**: the nearest valid `skills-lock.json`, or the lock selected by `FRESHKEEPER_SKILLS_CWD`.
- **Project toolchain lock**: the nearest valid `freshkeeper.lock.json`; it records exact adapter state that `restore` and `update --respect-lock` must verify before claiming success.
- **Freshkeeper check Skill**: the repository-owned read-only inventory and upstream-comparison workflow that prefers the shared user library and falls back to supported agent-local libraries when needed.
- **Freshkeeper update Skill**: the repository-owned backup-first workflow for updating recorded or evidence-recovered Skills in the selected shared or agent-local libraries while preserving local, untracked, symlinked, and upstream-deleted entries.
- **Provenance recovery**: the read-only evidence chain that maps an untracked installed Skill to a confirmed repository and path through a verified catalog, embedded Git remote, explicit metadata, NOTICE, or README plus official-tree comparison.
- **Installed snapshot**: the normalized map of relative file paths to Git blob SHA values for one physical Skill, excluding only runtime artifacts.
- **Upstream tree identity**: the Git tree SHA referenced by an upstream commit's `commit.tree.sha`; it is distinct from the commit SHA and is the only identity compared with a cloned repository's `HEAD^{tree}` during recovered updates.
- **MCP component**: a versioned local executable or plugin that provides an MCP server; remote HTTP servers and binaries bundled with a host application are owner-managed MCP surfaces, not locally updateable components.
- **MCP ownership**: the update route that controls a configured MCP server: Codex plugin, Claude plugin, versioned npm bridge, Bun global package, host application/plugin, remote service, or unmanaged local command.
- **MCP risk skip**: an available MCP component update that Freshkeeper reports but intentionally does not execute because backup, migration, live protocol verification, config switching, or rollback is not yet deterministic.
- **Component selection**: the explicit `all`, `agent`, `plugins`, `skills`, or `mcp` scope passed to `list`, `check`, or `update`; it filters only adapters already authorized by `enabledAdapters`.
- **Codex plugin ownership**: the update boundary between user-managed marketplace plugins, Codex/ChatGPT host-managed plugins, and plugins delegated to a deeper adapter such as MCP.
- **Plugin rematerialization**: the supported, idempotent `codex plugin add` operation that rebuilds an installed plugin cache from its configured marketplace after a marketplace refresh or cache-integrity failure.
- **Clean-old Skill**: an installed snapshot that matches a historical upstream tree and therefore has a proven three-way update base.
- **Current subset**: an installation whose files all match current upstream but which lacks upstream resources that can be added without overwriting local work.
- **Manual merge**: a recovered source where local and upstream content both differ and no clean historical base proves a safe automatic update.
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
9. The check Skill never mutates any Skill library; the update Skill never targets agent binaries, guesses missing sources, installs newly discovered Skills, deletes pre-existing Skills, or migrates agent-local libraries into a shared library.
10. Recovered provenance remains evidence, not authority: it is never written into the global lock without explicit confirmation.
11. A recovered-source update crosses the mutation seam only after backup, installed-snapshot, upstream-tree, and historical-base verification; a partial failure restores the affected Skill.
12. A recovered update plan stores the upstream commit's Git tree SHA, not the commit SHA; the executor revalidates that value against the cloned repository's `HEAD^{tree}` before applying any file action.
13. MCP discovery is ownership-aware: remote HTTP servers and host/plugin-bundled servers are report-only and are never overwritten as local packages.
14. A Codex-owned `claude-mem` installation crosses the MCP mutation seam only through its version-pinned npm installer with an isolated Freshkeeper npm cache, followed by Codex plugin-version verification, an explicit stop/start under the Codex-owned runtime environment, and worker path/version health checks. A disabled Codex plugin is skipped because the upstream installer would re-enable its hooks; the Claude plugin manager remains a compatibility fallback only when no Codex-owned installation is present.
15. `mcp-remote` and `gbrain` updates remain explicit risk skips until their staged install or data-migration flows have deterministic verification and rollback.
16. An explicit primary agent is authoritative: Freshkeeper does not substitute another installed agent merely because its executable or plugin is also discoverable.
17. An uninitialized runtime enables no agent adapters; mutation starts only after an explicit user selection creates an adapter plan.
18. Primary-agent ownership and memory-provider inference are independent selections; Freshkeeper never derives one from the other.
19. A Codex OAuth claude-mem installation is never overwritten by an npm target unless that target's own help surface advertises the `codex` provider.
20. Provider selection copy states the credential and billing boundary; subscription OAuth is never presented as equivalent to separately billed API access.
21. Component selection may narrow `enabledAdapters` but never enables an adapter absent from the saved execution plan.
22. Codex plugin updates cross the mutation seam only through official Codex marketplace and install commands; Freshkeeper never writes plugin cache payloads directly.
23. Codex/ChatGPT host-managed plugins are report-only, and MCP-owned plugins are updated only by the MCP adapter that can perform their runtime health checks.
24. `check` may claim no pending updates only when every installed, enabled adapter reports complete coverage with no candidate and no error.
25. Empty update candidates from a partial or unavailable check mean unknown, not current; the CLI must surface that distinction.
26. An update is counted only after a version or content hash changes and passes post-update verification; successful no-change commands are already current.
27. A confirmed newer version that update policy will skip must be labeled as a skip, with the same reason, during check.
