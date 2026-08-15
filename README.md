# worktree-warden

Watches merged agent pull requests in the current repository and invokes the
canonical `github-issue` Phase 7 cleanup (`cleanup-merged.sh <pr> <issue>`) so
merged agent worktrees, branches, and issues reconcile automatically —
without a container restart-hook, an AI/model process, or a database.

This package owns **discovery, scheduling, retry state, and diagnostics**
only. It never deletes a worktree/branch or advances `main` itself — all Git
and GitHub mutation stays in `cleanup-merged.sh` (from `agent-skills`).

## Requirements

- Node.js >= 18
- `git` and `gh` on `PATH`
- A GitHub App installation token helper (defaults to
  `/opt/agent-devcontainer/gh-app-token.sh`, override with
  `GH_APP_TOKEN_HELPER`)
- The `github-issue` skill installed at
  `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh` (override
  with `WARDEN_CLEANUP_SCRIPT`)

## Install

```bash
npm install -g @nickysagan/worktree-warden
```

## Usage

```bash
worktree-warden          # start the watcher (foreground; poll every 60s by default)
worktree-warden status   # print tracked branches, retry counts, and attention items
```

There is no `watch` subcommand — running `worktree-warden` with no arguments
starts the watcher.

## Configuration

| Env var                             | Default                                                        | Purpose                                  |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| `WARDEN_POLL_INTERVAL_MS`            | `60000`                                                          | Poll interval                             |
| `WARDEN_MAX_CONSECUTIVE_RETRIES`     | `5`                                                              | Consecutive `retry` outcomes before `blocked` |
| `WARDEN_CLEANUP_SCRIPT`              | `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh`   | Canonical Phase 7 script to invoke        |
| `GH_APP_TOKEN_HELPER`                | `/opt/agent-devcontainer/gh-app-token.sh`                        | GitHub App token minting helper           |

## State, locks, and logs

Everything durable lives under `<git-common-dir>/worktree-warden/`:

- `state.json` — per-branch outcome, retry count, attention flag
- `warden.pid` — single-instance lock (liveness-checked, self-healing on a stale PID)
- `warden.log` — bounded append-only log (auto-truncated, oldest lines dropped first)

## Cleanup outcome adapter

`cleanup-merged.sh` does not yet emit a structured, machine-readable result
(tracked in `agent-skills#28`). Until it does, `src/cleanup.js` classifies
its exit code and stderr into `cleaned` / `blocked` / `retry` by
pattern-matching today's known guard-refusal messages, escalating repeated
`retry`s to `blocked` after `WARDEN_MAX_CONSECUTIVE_RETRIES` consecutive
failures. This adapter is isolated to one file so it can be swapped for real
structured-output parsing once `agent-skills#28` ships.

## Releasing

1. Bump `version` in `package.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/publish.yml` runs the test suite and publishes to npm
   using the `NPM_TOKEN` repository secret.
