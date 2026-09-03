# Freshkeeper Source of Truth

Status: canonical path migration complete; Freshkeeper v1.3.0 was released and live-verified on 2026-08-31, and the component-scoped Codex/Plugin/MCP update work is staged as the v1.4.0 release candidate.

## Authority map

| Concern | Authoritative location | Rule |
|---|---|---|
| Editable source | `/Users/elninozhong/Documents/Projects/freshkeeper` | All forward changes happen here. |
| Historical compatibility entry | `/Users/elninozhong/Documents/Claude/Projects/freshkeeper` | Symlink to the canonical source; never create a second checkout here. |
| Runtime config and logs | `FRESHKEEPER_HOME`, default `~/.freshkeeper` | Mutable local state; never commit it. |
| Shared user skills | `/Users/elninozhong/.agents/skills` | External canonical library; Freshkeeper may touch it only through an explicitly authorized, fail-closed update plan. |
| Project skill intent | The nearest valid `skills-lock.json`, or `FRESHKEEPER_SKILLS_CWD` | Missing or malformed lock never widens update scope. |
| Project toolchain intent | The nearest valid `freshkeeper.lock.json` | `restore` and `update --respect-lock` fail closed and verify exact post-state. |
| User runtime selection | `primaryAgent`, `memoryProvider`, and `enabledAdapters` in `FRESHKEEPER_HOME/config.json` | `primaryAgent` selects MCP ownership, `memoryProvider` selects claude-mem inference, and `enabledAdapters` is the hard mutation boundary. |
| Agent Skill sources | `skills/freshkeeper-check/` and `skills/freshkeeper-update/` | Prefer the shared user Skill library and fall back to supported tools' own user-level libraries when it is absent; recover untracked GitHub provenance through evidence and whole-tree comparison; they do not wrap Freshkeeper's agent-tool adapters. |
| Provenance seed | Each Skill's `references/provenance-catalog.json` | Verified source/path candidates only; current upstream content and local evidence must still validate every candidate before use. |
| MCP component policy | `src/adapters/mcp-components.ts` | Discover configured MCPs by owner; Codex-owned `claude-mem` updates through its pinned npm installer and Codex worker verification, with Claude plugin ownership retained only as a compatibility fallback; risky migrations and owner-managed servers remain explicit skips or report-only. |
| Codex plugin policy | `src/adapters/codex-plugins.ts` | Inventory installed plugins by owner; refresh and rematerialize only user-managed marketplaces through official Codex commands, report host-managed plugins, and delegate MCP plugins. |
| Project rules | `AGENTS.md` | Shared rules for all agents. |
| Domain language | `CONTEXT.md` | Names update concepts and safety invariants. |
| Claude compatibility | `CLAUDE.md` | Thin pointer only. |
| Product behavior | `src/`, verified by `tests/` | Documentation follows implemented and tested behavior. |
| Published release | `package.json`, the matching Git tag/GitHub Release, and npm `latest` | All published surfaces must agree before a release is called live. |

## Current published state

Verified on 2026-08-31:

- `package.json`, Git tag `v1.3.0`, the non-draft GitHub Release, and npm `latest` all identify version `1.3.0`.
- Tag `v1.3.0` points to release commit `fa97ea031d1b538e66cbfe99702c5a9138e01da8`.
- The GitHub Release workflow completed successfully and published both the [v1.3.0 Release](https://github.com/ElninoZhong/freshkeeper/releases/tag/v1.3.0) and npm package.
- npm exposes an SLSA provenance attestation for `freshkeeper@1.3.0`; the downloaded official tarball contains the ownership-aware MCP adapter and its update policies.

## Current development state

Verified on 2026-09-01:

- Unreleased changes after v1.3.0 replace the false Codex update route (`claude plugin update codex@openai-codex`) with a version-pinned `@openai/codex` npm update and exact post-update verification.
- `freshkeeper init` now asks for one primary agent (or accepts `--agent`), writes that agent’s adapter plan, and passes the selection through the list/check/update seam so MCP ownership follows the user instead of whichever plugin happens to be discovered first. With no config, the unreleased default enables no adapters and therefore fails closed.
- claude-mem inference is a separate user choice (`--memory-provider`); Codex-owned updates pass that provider to the official installer instead of inferring it from the primary agent.
- Provider selection copy distinguishes subscription OAuth plan usage from separately credentialed and potentially separately billed API providers.
- Before a Codex OAuth install is overwritten, Freshkeeper probes the target package's help contract and skips the update unless that exact target advertises the `codex` provider.
- A Codex-owned `claude-mem` installation is now discovered from `claude-mem@claude-mem-local`; updates run the official Codex CLI installer under `~/.codex/claude-mem-runtime`, use isolated npm/uv caches, verify the installed Codex plugin version, and perform an explicit stop/start with pinned `CLAUDE_CONFIG_DIR` and `CLAUDE_PLUGIN_ROOT` so the new worker cannot inherit a stale Claude-owned resolver environment.
- The Claude plugin path remains supported for users who select Claude. On the maintainer machine, `~/.freshkeeper/config.json` explicitly selects Codex for both MCP ownership and memory generation and enables only `mcp-components`, `skills-cli`, and `codex`; this local preference is not a product-wide Codex default.
- The public Adapter seam is covered by synthetic command/registry tests; no test starts, updates, or rewrites a real MCP server.
- Local lint, 88 tests, build, package dry run, and real read-only detection of the three installed versioned MCP components passed.
- On 2026-09-01, a local claude-mem 13.21.2 build added a Codex provider that runs isolated `codex exec` calls against the existing ChatGPT OAuth login. It is installed under `~/.codex/claude-mem-runtime`, the hooks are enabled, worker health reports `provider=codex` and `authMethod=ChatGPT OAuth (Codex CLI)`, Chroma passes a deep probe, and an end-to-end synthetic session stored and searched observation `#2311`. The pre-cutover settings and both SQLite databases are backed up under `~/.claude-mem/backups/20260901T101507-codex-provider/`. `mcp-remote` and `gbrain` remain explicit risk skips.
- The installed shared copies of `freshkeeper-check` and `freshkeeper-update` still match the repository Skill sources; the CLI adapter does not broaden either Skill's library-only scope.
- Unreleased component-scoped commands accept `all`, `agent`, `plugins`, `skills`, or `mcp` and can only narrow the adapters already authorized by `enabledAdapters`.
- Unreleased `codex-plugins` support refreshes user-managed Git marketplaces, rematerializes installed plugins through idempotent `codex plugin add`, verifies version/cache state, reports Codex/ChatGPT host-managed plugins, and delegates `claude-mem` to the MCP adapter.
- Unreleased checks now return explicit complete, partial, or unavailable coverage. The CLI claims no pending updates only for complete coverage; partial or unavailable adapters remain visible as unknown instead of being collapsed into an empty update list.
- Codex CLI and MCP adapters reuse their checked version plan during update. Update reporting separates verified state changes from already-current results; Claude plugins and agent CLIs compare post-update versions, while locked project Skills compare folder hashes.
- Confirmed newer versions carry an update-or-skip disposition. MCP risk-skip reasons are shared by check and update so a known candidate cannot appear actionable before being skipped later.

## Migration state

- The repository moved atomically from the Claude project root to the canonical path on the same volume.
- Git history, remote, working-tree inode, ignored dependencies, and build output moved together; no second repository was created.
- The old path is a symlink so historical Claude/Codex cwd references and recovery links continue to resolve.
- `Documents/Codex` remains historical runtime/archive material and is not a Freshkeeper project root.

## Maintenance rule

Never silently change the canonical path, broaden skill update scope, migrate agent-local Skills into a shared library, bypass `enabledAdapters`, rewrite unrelated crontab entries, prune plugins outside a project lock, treat an unavailable pin as restored, delete an installed Skill during an Agent Skill update, or publish from a tag whose package state has not been verified.

For recovered-source Skill updates, GitHub refs must be resolved through the commit object to `commit.tree.sha`. The plan and executor compare that Git tree identity with `HEAD^{tree}`; a commit SHA and a tree SHA are never interchangeable.
