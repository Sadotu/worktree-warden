# worktree-warden

Watches merged/closed agent pull requests in the current repo and invokes a
configured terminal cleanup script (`<script> <pr> <issue>`) so finished
agent worktrees, branches, and issues reconcile automatically.

It only discovers, polls, and persists candidates — it never deletes a
worktree/branch or advances `main`. All Git/GitHub mutation stays in the
cleanup script. A transient token-mint or PR-lookup failure retries itself
with backoff; anything else (an ambiguous PR/issue relationship, a failing
cleanup script) is a permanent attention item that needs a human.

## Requirements

- Node.js >= 18, `git` and `gh` on `PATH`
- A GitHub App token helper (`GH_APP_TOKEN_HELPER`, default
  `/opt/agent-devcontainer/gh-app-token.sh`)
- A terminal cleanup script at `WARDEN_CLEANUP_SCRIPT` emitting the
  structured stdout JSON this daemon expects (`agent-skills#28`/`#41` or
  later). Canonical script: `github-pr-cleanup/scripts/cleanup.sh`
  (`agent-skills#47`) — this is also the built-in default below, so
  agent-devcontainer and any repo with that skill **installed** work
  without setting the env var explicitly. A **source checkout** of the
  skill (executable at `<repo>/skills/github-pr-cleanup/scripts/cleanup.sh`
  — no `.agents/` prefix, no `.agents/skills/github-pr-cleanup` directory)
  does not match that default and must set `WARDEN_CLEANUP_SCRIPT`
  explicitly to its own path. Verify whatever it resolves to before
  trusting it:
  ```bash
  test -x "${WARDEN_CLEANUP_SCRIPT:-<repo>/.agents/skills/github-pr-cleanup/scripts/cleanup.sh}" \
    && echo ok || echo "missing or not executable"
  ```

## Install

```bash
npm install -g @nickysagan/worktree-warden
```

## Usage

```bash
worktree-warden          # start the watcher (foreground, polls every 60s)
worktree-warden status   # print tracked candidates and attention items
worktree-warden clear <branch>  # retry cleanup for one blocked/retry entry now
worktree-warden clear --all     # retry cleanup for every blocked/retry entry now
```

## How it works

Each poll: resume any interrupted `pending` candidate; discover
`agent/<issue>-<slug>` worktrees and resolve each PR's terminal state and
linked issue; once terminal, persist the candidate *before* invoking the
cleanup script (so a crash can't lose it); parse its one stdout JSON record —
`cleaned`/`already-clean` clears the candidate, anything else writes an
attention item.

A worktree whose token mint or PR lookup itself failed (network error, `401`,
or similar) is tracked as a `retry` entry with a bounded exponential backoff
(1m, 2m, 4m, ... capped at 30m) and looked up again automatically once that
backoff elapses — no manual state edits needed. If the PR later turns out to
still be open, the retry entry is cleared automatically. Every other failure
— an ambiguous PR/issue relationship, a failing cleanup invocation — writes
a permanent attention item; nothing retries it automatically.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `WARDEN_POLL_INTERVAL_MS` | `60000` | Poll interval |
| `WARDEN_CLEANUP_SCRIPT` | `<repo>/.agents/skills/github-pr-cleanup/scripts/cleanup.sh` | Terminal cleanup script |
| `GH_APP_TOKEN_HELPER` | `/opt/agent-devcontainer/gh-app-token.sh` | Token helper |

The default assumes the **installed-skill layout**. A **source checkout**
(see Requirements) must set `WARDEN_CLEANUP_SCRIPT` explicitly to its own
`skills/github-pr-cleanup/scripts/cleanup.sh` path — the built-in default is
not a working fallback there.

## State, locks, and logs

Under `<git-common-dir>/worktree-warden/`: `state.json` (one entry per
candidate), `warden.pid` (self-healing single-instance lock), `warden.log`
(bounded).

## Recovering from an attention item

A `retry` entry with no `pr` on record (token mint or PR lookup itself
failed) resumes on its own once its backoff elapses — `worktree-warden
status` shows its attempt count and next retry time. Everything else needs a
human: fix the underlying condition, then run `worktree-warden clear
<branch>` or `clear --all` (every `blocked`/`retry` entry; `pending` ones are
already resumed every poll regardless). `clear` on a still-backing-off
`retry` entry with no `pr` just deletes it for immediate rediscovery next
poll, same as any other no-`pr` entry below.

If the entry has a `pr` on record, `clear` re-invokes the cleanup script
with it — same call the daemon makes, bound by the same safety checks
(e.g. still won't fast-forward `main` over a dirty worktree). Success
removes the entry and exits `0`; still-failing entries are updated in
place and `clear` exits `1`. Entries with no `pr` (nothing was ever
invoked, or the `__runOnce__` whole-cycle key) are just deleted and
rediscovered next poll. Editing `state.json` by hand still works too.

### Recovering from an invalid `WARDEN_CLEANUP_SCRIPT`

Recognize this case by an attention item's `reason: cleanup-script-not-found`
(or an `invocation-failed` diagnostic naming an `ENOENT` on the configured
path) — the resolved script doesn't exist at that path. This is usually a
layout mismatch: the built-in default and most explicit overrides assume the
**installed-skill layout**, but a **source checkout** ships the script at a
different path (see Requirements). Fix it:

1. Pick the path that matches how this repo actually has the skill —
   installed (`.agents/skills/github-pr-cleanup/scripts/cleanup.sh`) or
   source checkout (`skills/github-pr-cleanup/scripts/cleanup.sh`) — and
   confirm it with the `test -x` check from Requirements.
2. Set `WARDEN_CLEANUP_SCRIPT` to that path for the **daemon process**, not
   just your interactive shell. A launcher/wrapper that starts the daemon
   may export its own `WARDEN_CLEANUP_SCRIPT` on every start, silently
   overwriting a shell-level `export` — if cleanup keeps failing after
   fixing the shell env, check what the daemon's actual environment (and
   the launcher that set it) is passing instead.
3. Restart the daemon so it picks up the corrected value, then run
   `worktree-warden clear <branch>` or `clear --all` — correcting the path
   alone does not retroactively fix entries already stuck on the old one.

## Releasing

Bump `version` in `package.json` and merge to `main`.
`.github/workflows/publish.yml` publishes via npm trusted publishing (OIDC)
if that version isn't already released, and tags the commit.
