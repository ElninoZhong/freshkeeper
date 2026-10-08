# Freshkeeper Source of Truth

Status: canonical path migration complete; Freshkeeper v1.5.0 was released and live-verified on 2026-10-08.

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

Verified on 2026-10-08:

- `package.json`, `package-lock.json`, Git tag `v1.5.0`, the non-draft GitHub Release, and official npm `latest` identify version `1.5.0`.
- Tag `v1.5.0` points to feature commit `1c900ce9e407c6373e22bc256c098503e1d5d741`.
- [Main CI](https://github.com/ElninoZhong/freshkeeper/actions/runs/37739486956) passed on Ubuntu/macOS with Node 20/22; lint, 106 tests and build passed. Local package dry run and Skill validation passed.
- The [release workflow](https://github.com/ElninoZhong/freshkeeper/actions/runs/37739576679) successfully published the [v1.5.0 Release](https://github.com/ElninoZhong/freshkeeper/releases/tag/v1.5.0) and npm package. npm initially reported processing; completion was claimed only after official `latest` became `1.5.0` and the package was downloadable.
- The downloaded official package has SHA-1 `2cc8a4d62798e4480c8ccafae9aba20f6fc777e5`. Its SHA-512 integrity and npm SLSA provenance subject match the package; provenance identifies the exact `v1.5.0` source commit.
- Every packaged Skill file matches the release tag. A temporary official npm execution returned CLI version `1.5.0`, without a global install or runtime update. The shared `freshkeeper-check` copy matches the canonical release source.

## Previous published state

Verified on 2026-09-03:

- `package.json`, Git tag `v1.4.1`, the non-draft GitHub Release, and npm `latest` all identify version `1.4.1`.
- Tag `v1.4.1` points to patch release commit `0b9badb0acfc9cadb7eda95bdad805a9cdbe5e8c`; v1.4.0 feature commit `68b7ffd663192c5aeee471a7120ebcd6cf1187e8` remains separately tagged.
- The GitHub Release workflow completed successfully and published the [v1.4.1 Release](https://github.com/ElninoZhong/freshkeeper/releases/tag/v1.4.1) and npm package.
- npm `latest`, the executable `freshkeeper` bin, SLSA provenance, integrity metadata, downloaded official tarball, and a clean-directory `npx freshkeeper@1.4.1 --version` smoke test all passed.

## Current development state

v1.5.0 behavior (released and verified on 2026-10-08): the check Skill compares official well-known file-list sources and provides explicit `--fill-metadata` / `--apply-metadata` modes. The checker completes every selected local version and content snapshot before requesting any upstream version and rejects local changes during comparison. Ordinary checks remain read-only. Metadata repair preserves install-time hashes and unrelated lock fields, records content revisions and evidenced sources by physical path, and revalidates a verified backup, lock and installed snapshots before atomic replacement. Personal/local and application-bundled evidence maps stay in user runtime records. No Skill contents, binaries or schedules are updated by this mode.

Verified on 2026-09-03:

- Codex updates resolve the target version from npm, call the PATH-effective CLI's own `codex update`, and verify the final active version. This preserves standalone-vs-npm ownership and avoids installing a newer npm copy behind an older standalone binary earlier on PATH.
- `freshkeeper init` asks for one primary agent (or accepts `--agent`), writes that agent’s adapter plan, and passes the selection through the list/check/update seam so MCP ownership follows the user instead of whichever plugin happens to be discovered first. With no config, the default enables no adapters and therefore fails closed.
- claude-mem inference is a separate user choice (`--memory-provider`); Codex-owned updates pass that provider to the official installer instead of inferring it from the primary agent.
- Provider selection copy distinguishes subscription OAuth plan usage from separately credentialed and potentially separately billed API providers.
- Before a Codex OAuth install is overwritten, Freshkeeper probes the target package's help contract and skips the update unless that exact target advertises the `codex` provider.
- A Codex-owned `claude-mem` installation is now discovered from `claude-mem@claude-mem-local`; updates run the official Codex CLI installer under `~/.codex/claude-mem-runtime`, use isolated npm/uv caches, verify the installed Codex plugin version, and perform an explicit stop/start with pinned `CLAUDE_CONFIG_DIR` and `CLAUDE_PLUGIN_ROOT` so the new worker cannot inherit a stale Claude-owned resolver environment.
- The Claude plugin path remains supported for users who select Claude. On the maintainer machine, `~/.freshkeeper/config.json` explicitly selects Codex for both MCP ownership and memory generation and enables `mcp-components`, `codex-plugins`, `skills-cli`, and `codex`; this local preference is not a product-wide Codex default.
- The public Adapter seam is covered by synthetic command/registry tests; no test starts, updates, or rewrites a real MCP server.
- Local lint, 99 tests, build, package dry run, main CI on Ubuntu/macOS with Node 20/22, and the release workflow passed for v1.4.1.
- The local Codex-provider claude-mem build was rebased onto upstream 13.24.0 and installed under `~/.codex/claude-mem-runtime`. Worker health reports version 13.24.0, `provider=codex`, and `authMethod=ChatGPT OAuth (Codex CLI)`; the Chroma deep probe passed, and a synthetic session generated and searched observations `#2312` and `#2313`. The pre-upgrade runtime and settings are backed up under `~/.claude-mem/backups/20260903T154500-v1324-upgrade/`. `mcp-remote` and `gbrain` remain explicit risk skips.
- The installed shared copies of `freshkeeper-check` and `freshkeeper-update` still match the repository Skill sources; the CLI adapter does not broaden either Skill's library-only scope.
- Component-scoped commands accept `all`, `agent`, `plugins`, `skills`, or `mcp` and can only narrow the adapters already authorized by `enabledAdapters`.
- `codex-plugins` support refreshes user-managed Git marketplaces, rematerializes installed plugins through idempotent `codex plugin add`, verifies version/cache state, reports Codex/ChatGPT host-managed plugins, and delegates `claude-mem` to the MCP adapter.
- Checks return explicit complete, partial, or unavailable coverage. The CLI claims no pending updates only for complete coverage; partial or unavailable adapters remain visible as unknown instead of being collapsed into an empty update list.
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
