# Hermes Agent Update Mechanism

## Install

Hermes uses a curl-piped install script (Linux, macOS, WSL2, Android/Termux):

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

After install, reload the shell and run `hermes` to start the interactive CLI.
(Copied from the repo `README.md`.)

## Version Detection

- Binary name: `hermes`
- Version command: **`hermes version`** (subcommand, not a `--version` flag —
  explicit in the Hermes CLI reference: "Display version details").
- Example output format: `[UNKNOWN — need to verify]` — docs describe it as
  "version details" so it may be multi-line (version + build metadata).
  Adapter should parse with a tolerant regex (`/v?\d+\.\d+\.\d+/`) rather
  than exact-match.
- Additional health signal: `hermes doctor [--fix]` ("diagnose and repair
  config issues") and `hermes dump` (copy-pasteable setup summary) for
  debugging.

## Self-Update

- Built-in update command: **YES**
- Exact command:

  ```bash
  hermes update
  ```

  From the CLI reference: "Pull latest code and reinstall dependencies."
  Because the installer is a curl|bash script that clones/pulls a repo (not an
  npm/brew package), `hermes update` is the official path — there's no
  package-manager equivalent to fall back to. The fallback, if the subcommand
  fails, is to re-run the install script above.

## Skill / Plugin System

- Does Hermes have a skill/plugin system? **YES**
- Name of the system: **Skills Hub** — Hermes is compatible with the open
  standard at **agentskills.io**. Skills live at `~/.hermes/skills/`.
- Hermes also *autonomously creates and improves* skills from experience
  ("agent-curated memory with periodic nudges"). That's an agent-side
  behavior, not a CLI concern.
- Relevant subcommands (confirmed from the CLI reference):
  - `hermes skills browse` — paginated registry browse
  - `hermes skills search <query>` — search registries
  - `hermes skills install <skill-id>` — add a skill
  - `hermes skills update` — "Reinstall hub skills with upstream changes"
  - `hermes skills check` — check installed hub skills for upstream updates
    (preflight, read-only)
  - `hermes skills list` — display installed skills
  - `hermes skills inspect <skill-id>` — preview without installing
  - `hermes skills uninstall <skill>` — remove a hub-installed skill
  - Flags: `--source <registry>` (`official`, `skills-sh`, `well-known`),
    `--force`.
- Update model: **separate command**. `hermes update` updates the Hermes CLI
  itself; `hermes skills update` updates installed hub skills. Pair them if
  we want a "full refresh" action.
- Bonus: `hermes skills check` is a true non-mutating "is update available?"
  probe — nicer than OpenClaw here.

## Proposed Freshkeeper Adapter Shape

```ts
export const hermesAdapter: Adapter = {
  id: 'hermes',
  displayName: 'Hermes Agent',
  async detect() {
    // Look for `hermes` on PATH, then:
    //   hermes version
    // Parse any vX.Y.Z substring from stdout.
    return runVersion('hermes', ['version']);
  },
  async check() {
    // Hermes has no documented CLI-update preflight for the binary itself,
    // but `hermes skills check` works for skills. For the binary, return []
    // (rely on `hermes update` being idempotent) or git-ls-remote the repo
    // if we want a preflight.
    return [];
  },
  async update() {
    // Built-in updater. Falls back to re-running the install script.
    await run('hermes', ['update']);
  }
};
```

Optional second adapter id `hermes-skills` could wrap
`hermes skills update` (preflight with `hermes skills check`) if we expose
skill updates as a separate target.

## Gotchas / Notes

- Version flag is **`hermes version` (subcommand), not `--version`**. This is
  the opposite of OpenClaw and an easy footgun if we share detection code.
- Update is a git-pull-and-reinstall, not an npm/brew upgrade. It will touch
  the install directory and dependencies; it may take noticeably longer than
  an npm bump. Freshkeeper should probably stream progress output rather than
  silently wait.
- Two distinct update surfaces (CLI + skills), same as OpenClaw — consider a
  unified "update everything" flow if both agents are installed.
- `hermes uninstall [--full] [--yes]` exists — not directly relevant to
  updates, but useful context for adapter symmetry later.
- Hermes docs explicitly reference an **OpenClaw migration path**
  (`hermes claw migrate`). Users may have both installed simultaneously;
  adapters should be independent and not assume exclusivity.
- Version-string format is `[UNKNOWN — need to verify]` against a real
  install — use a tolerant regex.

## Sources

- [NousResearch/hermes-agent README (raw)](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md)
- [hermes-agent.nousresearch.com CLI commands reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
- [hermes-agent.nousresearch.com docs landing](https://hermes-agent.nousresearch.com/docs/)
- [agentskills.io (Skills Hub open standard)](https://agentskills.io)
