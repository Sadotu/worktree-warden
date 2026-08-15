# worktree-warden

Watches merged (or closed-unmerged) agent pull requests in the current
repository and invokes the canonical `github-issue` Phase 7 cleanup
(`cleanup-merged.sh <pr> <issue>`) so terminal agent worktrees, branches,
and issues reconcile automatically — without a container restart-hook, an
AI/model process, or a database.

This package is a small terminal-PR detector and one-shot Phase 7 invoker.
It owns **discovery, polling, candidate persistence, and diagnostics**
only. It never deletes a worktree/branch or advances `main` itself, never
retries automatically, and never re-implements any part of Phase 7's
cleanup or safety logic — all of that stays in `cleanup-merged.sh` (from
`agent-skills`).

## Requirements

- Node.js >= 18
- `git` and `gh` on `PATH`
- A GitHub App installation token helper (defaults to
  `/opt/agent-devcontainer/gh-app-token.sh`, override with
  `GH_APP_TOKEN_HELPER`)
- The `github-issue` skill installed at
  `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh` (override
  with `WARDEN_CLEANUP_SCRIPT`) — must be a version that emits Phase 7's
  structured stdout JSON record (`agent-skills#28`/`#41` or later)

## Install

```bash
npm install -g @nickysagan/worktree-warden
```

## Usage

```bash
worktree-warden          # start the watcher (foreground; poll every 60s by default)
worktree-warden status   # print tracked candidates and attention items
```

There is no `watch` subcommand — running `worktree-warden` with no arguments
starts the watcher.

## How it works

Each poll cycle:

1. Resume any candidate still `pending` from an earlier, interrupted run —
   even if its worktree is no longer visible — by invoking Phase 7 for it
   again. `cleanup-merged.sh`'s own journal makes this converge safely.
2. Discover local `agent/<issue>-<slug>` worktrees with no tracked
   candidate yet. For each: resolve its PR and, once terminal, its
   GitHub-linked closing issue — never inferred from the branch name. An
   `OPEN` PR (or no PR at all) is left alone — nothing is written, the next
   poll checks again for free.
3. Once a PR reaches a terminal GitHub state (`MERGED` or `CLOSED`), the
   candidate (`pr`, `issue`, `branch`) is persisted *before* invoking Phase
   7, so a crash mid-invocation can't lose track of it.
4. Phase 7's exactly-one stdout JSON record decides the outcome:
   `cleaned`/`already-clean` clears the candidate. Anything else
   (`waiting`, `blocked`, `retry`, or the invocation itself failing to
   produce a parseable record) records a permanent attention item — the
   daemon never automatically retries it. Any failure anywhere in this
   process — minting a token, looking up a PR, an ambiguous PR/issue
   relationship (more than one terminal PR for a branch, or a PR with no
   or multiple linked closing issues), or Phase 7 itself — writes a
   permanent attention item immediately. None of it is retried
   automatically.

## Configuration

| Env var                             | Default                                                        | Purpose                                  |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------ |
| `WARDEN_POLL_INTERVAL_MS`            | `60000`                                                          | Poll interval                             |
| `WARDEN_CLEANUP_SCRIPT`              | `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh`   | Canonical Phase 7 script to invoke        |
| `GH_APP_TOKEN_HELPER`                | `/opt/agent-devcontainer/gh-app-token.sh`                        | GitHub App token minting helper           |

## State, locks, and logs

Everything durable lives under `<git-common-dir>/worktree-warden/`:

- `state.json` — one entry per tracked candidate: `pending` (Phase 7
  invoked, no result recorded yet) or an attention item (`blocked`,
  `retry`, `waiting`, with a `reason` and human `diagnostic`)
- `warden.pid` — single-instance lock, acquired atomically; self-healing on
  a stale PID
- `warden.log` — bounded append-only log (auto-truncated, oldest lines
  dropped first)

## Recovering from an attention item

`worktree-warden` never automatically retries a candidate once an
attention item is recorded for it — that is a deliberate design choice,
not a bug. Recovery differs depending on whether Phase 7 was ever
actually invoked for the entry:

- **`pr` is set** (the attention item followed a real Phase 7 invocation —
  status `blocked` or `retry` with a real PR number): fix the underlying
  problem (e.g. committing or stashing a dirty worktree, resolving a
  diverged `main`), then edit that branch's entry in `state.json` and set
  its `"status"` field back to `"pending"` — leave `pr`, `issue`, and
  `branch` as they are. The next poll's resume pass invokes Phase 7 for it
  again, even if the worktree has since been removed.
- **`pr` is `null`** (`token-mint-failed`, `pr-lookup-failed`, or
  `pr-issue-ambiguous` — nothing was ever invoked, there is no candidate
  identity to resume): fix the underlying problem (App token/`gh` auth,
  network access, or the PR/issue relationship on GitHub itself), then
  delete that branch's entry from `state.json` outright. The next poll
  rediscovers the branch from scratch and re-resolves its PR. Setting
  `status` back to `"pending"` on one of these does *not* work — there is
  no `pr` to resume, and the daemon refuses to invoke Phase 7 without one
  (see below).

A whole-cycle failure not tied to any specific branch (e.g. the daemon
can't resolve the repository at all) is recorded under the reserved
`state.json` key `__runOnce__` and shown in `status` as `daemon error:
...`. Like the `pr: null` case above, this key holds no in-flight Phase 7
work, so it is always safe to delete outright.

## Releasing

1. Bump `version` in `package.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/publish.yml` runs the test suite and publishes to npm
   using the `NPM_TOKEN` repository secret.
