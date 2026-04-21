# OpenClaw Update Mechanism

## Install

OpenClaw is distributed as a global npm package plus a one-time onboarding step
that installs a local daemon/gateway:

```bash
npm install -g openclaw@latest
# or: pnpm add -g openclaw@latest

openclaw onboard --install-daemon
```

(Copied from the repo `README.md` / `docs.openclaw.ai`.)

## Version Detection

- Binary name: `openclaw`
- Version command: `openclaw --version` (also accepts `-V` and `-v`)
- Example output format: `openclaw x.y.z` (exact format not shown in docs —
  standard Node/Commander style; parsing should tolerate any `vX.Y.Z` substring
  in the output).
- Additional health check: `openclaw doctor` — surfaces risky or misconfigured
  settings and validates the installation (not a pure version probe, but useful
  as a "is it installed and working" signal).

## Self-Update

- Built-in update command: **YES**
- Exact command:

  ```bash
  openclaw update
  # or pin to a release channel:
  openclaw update --channel stable|beta|dev
  ```

  `--update` is also available as a global flag shorthand for `openclaw update`.
- Channels: `stable` (tagged releases), `beta` (prereleases), `dev` (HEAD of
  `main`). Freshkeeper's safe default should be `stable`.
- Because the package is installed via npm globally, `npm install -g openclaw@latest`
  or `pnpm add -g openclaw@latest` is an equivalent fallback if the subcommand
  ever fails.

## Skill / Plugin System

- Does OpenClaw have a skill/plugin system? **YES**
- Name of the system: **ClawHub** (the skills registry) — skills live on disk
  at `~/.openclaw/workspace/skills/<skill>/SKILL.md`.
- Top-level CLI group: `openclaw skills` (and a separate `openclaw plugins`
  group for non-skill extensions).
- Relevant subcommands (confirmed from the CLI reference index):
  - `openclaw skills search <query>` — browse/query ClawHub
  - `openclaw skills install <skill>` — add a skill to the workspace
  - `openclaw skills update` — upgrade existing skills (bulk; accepts
    `--all`)
  - `openclaw skills list` — display installed skills
  - `openclaw skills info <skill>` — view skill details
  - `openclaw skills check` — verify skill status / check for upstream updates
- Update model: **separate command** from the main CLI update. `openclaw update`
  upgrades the CLI binary itself; `openclaw skills update` upgrades installed
  skills. Freshkeeper should treat them as two distinct update actions (or
  chain them if we want a "full refresh").

## Proposed Freshkeeper Adapter Shape

```ts
export const openClawAdapter: Adapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  async detect() {
    // Look for the `openclaw` binary on PATH, then:
    //   openclaw --version
    // Parse any vX.Y.Z substring from stdout.
    return runVersion('openclaw', ['--version']);
  },
  async check() {
    // No dedicated "is-update-available" subcommand is documented.
    // Options:
    //   1. Return [] and rely on `update` to be idempotent.
    //   2. Compare `openclaw --version` against the latest npm dist-tag
    //      (`npm view openclaw@latest version`) if we want a preflight.
    return [];
  },
  async update() {
    // Preferred: built-in updater, stable channel.
    //   openclaw update --channel stable
    // Fallback if the subcommand exits non-zero:
    //   npm install -g openclaw@latest
    await run('openclaw', ['update', '--channel', 'stable']);
  }
};
```

Optional second adapter id `openclaw-skills` could wrap
`openclaw skills update --all` if we want to expose skill updates as a
separate Freshkeeper target.

## Gotchas / Notes

- Two distinct update surfaces: **CLI** (`openclaw update`) and **skills**
  (`openclaw skills update`). Freshkeeper's "one update button" should
  probably do both, in that order.
- The README pairs `npm install -g` with `openclaw onboard --install-daemon`.
  `onboard` installs a gateway/daemon; an update to the CLI does **not** imply
  a re-onboard, but major-version bumps may require re-running it. Worth
  surfacing a note in the UI.
- Profile/container isolation flags exist (`--dev`, `--profile <name>`,
  `--container <name>`). If a user runs multiple OpenClaw profiles, the
  adapter should probably not assume a single global install state.
- `openclaw doctor` is the closest thing to a health check; consider calling
  it post-update and showing the output if it reports issues.
- Version-string format is not documented verbatim — the adapter should use a
  tolerant regex (`/v?\d+\.\d+\.\d+/`) rather than exact-match parsing.
- `[UNKNOWN — need to verify]` the exact stdout of `openclaw --version` on a
  real install (docs only confirm the flag exists, not the format).

## Sources

- [openclaw/openclaw README (raw)](https://raw.githubusercontent.com/openclaw/openclaw/main/README.md)
- [docs.openclaw.ai landing / llms.txt index](https://docs.openclaw.ai/llms.txt)
- [docs.openclaw.ai CLI reference index](https://docs.openclaw.ai/cli/index.md)
- [docs.openclaw.ai skills CLI reference](https://docs.openclaw.ai/cli/skills.md)
