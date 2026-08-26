# Freshkeeper Source of Truth

Status: canonical path migration complete; Freshkeeper v1.2.0 remains the published release, while `main` contains the unreleased Git tree-SHA fix at `7950c94189382b8b1eec5d6b75b434e3c5226c29` and its shared Agent Skills were synced on 2026-08-26.

## Authority map

| Concern | Authoritative location | Rule |
|---|---|---|
| Editable source | `/Users/elninozhong/Documents/Projects/freshkeeper` | All forward changes happen here. |
| Historical compatibility entry | `/Users/elninozhong/Documents/Claude/Projects/freshkeeper` | Symlink to the canonical source; never create a second checkout here. |
| Runtime config and logs | `FRESHKEEPER_HOME`, default `~/.freshkeeper` | Mutable local state; never commit it. |
| Shared user skills | `/Users/elninozhong/.agents/skills` | External canonical library; Freshkeeper may touch it only through an explicitly authorized, fail-closed update plan. |
| Project skill intent | The nearest valid `skills-lock.json`, or `FRESHKEEPER_SKILLS_CWD` | Missing or malformed lock never widens update scope. |
| Project toolchain intent | The nearest valid `freshkeeper.lock.json` | `restore` and `update --respect-lock` fail closed and verify exact post-state. |
| Agent Skill sources | `skills/freshkeeper-check/` and `skills/freshkeeper-update/` | Prefer the shared user Skill library and fall back to supported tools' own user-level libraries when it is absent; recover untracked GitHub provenance through evidence and whole-tree comparison; they do not wrap Freshkeeper's agent-tool adapters. |
| Provenance seed | Each Skill's `references/provenance-catalog.json` | Verified source/path candidates only; current upstream content and local evidence must still validate every candidate before use. |
| Project rules | `AGENTS.md` | Shared rules for all agents. |
| Domain language | `CONTEXT.md` | Names update concepts and safety invariants. |
| Claude compatibility | `CLAUDE.md` | Thin pointer only. |
| Product behavior | `src/`, verified by `tests/` | Documentation follows implemented and tested behavior. |
| Published release | `package.json`, the matching Git tag/GitHub Release, and npm `latest` | All published surfaces must agree before a release is called live. |

## Current published state

Verified on 2026-08-26:

- `package.json`, Git tag `v1.2.0`, the non-draft GitHub Release, and npm `latest` all identify version `1.2.0`.
- Tag `v1.2.0` points to merged commit `6699c293cf9ee6a93dd6e3e5db1efe10f4703892`.
- npm exposes an SLSA provenance attestation for `freshkeeper@1.2.0`.

## Current development state

Verified on 2026-08-26:

- Local `main`, `origin/main`, and GitHub `main` point to `7950c94189382b8b1eec5d6b75b434e3c5226c29` (`fix: compare recovered skills by Git tree SHA`).
- GitHub CI passed for that commit; local lint, 76 tests, build, package dry run, and both Skill validators also passed.
- The installed shared copies of `freshkeeper-check` and `freshkeeper-update` exactly match the repository Skill sources at `main`.
- The fix has not been released: `package.json`, the latest tag/Release, and npm `latest` remain `1.2.0`. A `1.2.1` patch release is pending explicit publication authorization.

## Migration state

- The repository moved atomically from the Claude project root to the canonical path on the same volume.
- Git history, remote, working-tree inode, ignored dependencies, and build output moved together; no second repository was created.
- The old path is a symlink so historical Claude/Codex cwd references and recovery links continue to resolve.
- `Documents/Codex` remains historical runtime/archive material and is not a Freshkeeper project root.

## Maintenance rule

Never silently change the canonical path, broaden skill update scope, migrate agent-local Skills into a shared library, bypass `enabledAdapters`, rewrite unrelated crontab entries, prune plugins outside a project lock, treat an unavailable pin as restored, delete an installed Skill during an Agent Skill update, or publish from a tag whose package state has not been verified.

For recovered-source Skill updates, GitHub refs must be resolved through the commit object to `commit.tree.sha`. The plan and executor compare that Git tree identity with `HEAD^{tree}`; a commit SHA and a tree SHA are never interchangeable.
