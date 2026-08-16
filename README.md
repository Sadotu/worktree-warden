# worktree-warden

Watches merged or closed-unmerged agent pull requests in the current
repository and invokes the configured terminal cleanup script
(`<script> <pr> <issue>`) so terminal agent worktrees, branches, and issues
reconcile automatically.

It owns discovery, polling, candidate persistence, and diagnostics only.
It never deletes a worktree/branch, advances `main`, or retries a failure
automatically — all Git/GitHub mutation and safety logic stays in the
configured cleanup script.

## Requirements

- Node.js >= 18, `git` and `gh` on `PATH`
- A GitHub App token helper (`GH_APP_TOKEN_HELPER`, default
  `/opt/agent-devcontainer/gh-app-token.sh`)
- A terminal cleanup script at `WARDEN_CLEANUP_SCRIPT` emitting the
  structured stdout JSON this daemon expects (`agent-skills#28`/`#41` or
  later). The canonical script is `github-pr-cleanup/scripts/cleanup.sh`
  (`agent-skills#47`): agent-devcontainer supplies `WARDEN_CLEANUP_SCRIPT`
  pointing at it automatically (`agent-devcontainer#67`); standalone
  installations must set `WARDEN_CLEANUP_SCRIPT` to it explicitly. The
  built-in default below is the old bundled `github-issue` cleanup path and
  is not used by the supported agent-devcontainer integration after this
  migration — it is not a working fallback.

## Install

```bash
npm install -g @nickysagan/worktree-warden
```

## Usage

```bash
worktree-warden          # start the watcher (foreground, polls every 60s)
worktree-warden status   # print tracked candidates and attention items
```

No `watch` subcommand — bare `worktree-warden` starts the watcher.

## How it works

Each poll:

1. Resumes any `pending` candidate from an interrupted run, even if its
   worktree is gone — `cleanup-merged.sh`'s journal makes re-invocation
   converge safely.
2. Discovers `agent/<issue>-<slug>` worktrees with no tracked candidate.
   Resolves each PR and, once terminal, its GitHub-linked closing issue
   (never the branch name). `OPEN`/no PR → left alone, checked again next
   poll for free.
3. Once terminal (`MERGED`/`CLOSED`), persists the candidate (`pr`,
   `issue`, `branch`) *before* invoking the terminal cleanup script, so a
   crash mid-invocation can't lose it.
4. Parses the cleanup script's one stdout JSON record. `cleaned`/`already-clean`
   clears the candidate. Anything else — a failed mint, failed PR lookup,
   ambiguous PR/issue relationship (multiple terminal PRs, or zero/multiple
   linked issues), invalid cleanup-script output, or a whole-cycle crash —
   writes a permanent attention item immediately. Nothing is ever retried
   automatically.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WARDEN_POLL_INTERVAL_MS` | `60000` | Poll interval |
| `WARDEN_CLEANUP_SCRIPT` | `<repo>/.agents/skills/github-issue/scripts/cleanup-merged.sh` | Terminal cleanup script — old built-in path, not used by the supported agent-devcontainer integration after migration; see Requirements |
| `GH_APP_TOKEN_HELPER` | `/opt/agent-devcontainer/gh-app-token.sh` | Token helper |

## State, locks, and logs

Under `<git-common-dir>/worktree-warden/`:

- `state.json` — one entry per candidate: `pending`, or an attention item
  (`blocked`/`retry`/`waiting`, with `reason` + `diagnostic`)
- `warden.pid` — atomic single-instance lock, self-healing on a stale PID
- `warden.log` — bounded, oldest lines dropped first

## Recovering from an attention item

Never retried automatically — recovery is manual, and depends on whether
the terminal cleanup script was ever invoked:

- **`pr` set** (a real invocation happened): fix the problem, set that
  entry's `status` back to `"pending"`. Resumed next poll, even if the
  worktree is gone.
- **`pr: null`** (`token-mint-failed`/`pr-lookup-failed`/`pr-issue-ambiguous`
  — nothing was invoked): fix the problem, delete the entry. Rediscovered
  fresh next poll. Setting `status` to `"pending"` won't work here — there's
  no `pr` to resume, and the daemon refuses to invoke the cleanup script
  without one.

A whole-cycle failure not tied to any branch lands under the reserved key
`__runOnce__` (shown as `daemon error: ...` in `status`) — always safe to
delete, it holds no in-flight work.

## Releasing

Bump `version` in `package.json` and merge to `main`.
`.github/workflows/publish.yml` checks whether that version is already on
the npm registry; if not, it runs the test suite, publishes via npm's
trusted publishing (OIDC — no stored npm token), and tags the released
commit itself. Re-running the workflow on an already-released version, or
pushing a `v*` tag by hand, is a no-op.
