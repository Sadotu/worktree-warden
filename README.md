# worktree-warden

Watches merged/closed agent pull requests in the current repo and invokes a
configured terminal cleanup script (`<script> <pr> <issue>`) so finished
agent worktrees, branches, and issues reconcile automatically.

It only discovers, polls, and persists candidates — it never deletes a
worktree/branch, advances `main`, or retries automatically. All Git/GitHub
mutation stays in the cleanup script.

## Requirements

- Node.js >= 18, `git` and `gh` on `PATH`
- A GitHub App token helper (`GH_APP_TOKEN_HELPER`, default
  `/opt/agent-devcontainer/gh-app-token.sh`)
- A terminal cleanup script at `WARDEN_CLEANUP_SCRIPT` emitting the
  structured stdout JSON this daemon expects (`agent-skills#28`/`#41` or
  later). Canonical script: `github-pr-cleanup/scripts/cleanup.sh`
  (`agent-skills#47`) — agent-devcontainer sets `WARDEN_CLEANUP_SCRIPT` to it
  automatically; standalone installs must set it explicitly. The built-in
  default below is the old bundled path and isn't a working fallback.

## Install

```bash
npm install -g @nickysagan/worktree-warden
```

## Usage

```bash
worktree-warden          # start the watcher (foreground, polls every 60s)
worktree-warden status   # print tracked candidates and attention items
worktree-warden clear <branch>  # clear a blocked/retry entry after fixing the underlying condition
```

## How it works

Each poll: resume any interrupted `pending` candidate; discover
`agent/<issue>-<slug>` worktrees with no tracked candidate and resolve each
PR's terminal state and linked issue; once terminal, persist the candidate
*before* invoking the cleanup script (so a crash can't lose it); parse its
one stdout JSON record — `cleaned`/`already-clean` clears the candidate,
anything else writes a permanent attention item. Nothing retries
automatically.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WARDEN_POLL_INTERVAL_MS` | `60000` | Poll interval |
| `WARDEN_CLEANUP_SCRIPT` | `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh` | Terminal cleanup script (old built-in path — see Requirements) |
| `GH_APP_TOKEN_HELPER` | `/opt/agent-devcontainer/gh-app-token.sh` | Token helper |

## State, locks, and logs

Under `<git-common-dir>/worktree-warden/`: `state.json` (one entry per
candidate), `warden.pid` (self-healing single-instance lock), `warden.log`
(bounded).

## Recovering from an attention item

Nothing retries automatically. Fix the underlying condition (e.g. clean the
dirty primary worktree, restore the missing branch), then run:

```bash
worktree-warden clear <branch>
```

This removes the branch's `state.json` entry so it's rediscovered fresh on
the next poll. A whole-cycle failure lands under the reserved key
`__runOnce__` (shown as `daemon error: ...` in `status`) — also safe to
clear the same way, it holds no in-flight work.

`clear` always deletes the entry (it never edits `status` in place), so it
works the same regardless of whether a cleanup script invocation already
happened for that branch. Editing `state.json` by hand works too — `clear`
is a thin wrapper around deleting the branch's key.

## Releasing

Bump `version` in `package.json` and merge to `main`.
`.github/workflows/publish.yml` publishes via npm trusted publishing (OIDC)
if that version isn't already released, and tags the commit.
