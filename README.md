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
  (`agent-skills#47`), which the skill can live at under either of two
  layouts: **installed**
  (`<repo>/.agents/skills/github-pr-cleanup/scripts/cleanup.sh`) or
  **source checkout** (`<repo>/skills/github-pr-cleanup/scripts/cleanup.sh`
  — no `.agents/` prefix). When `WARDEN_CLEANUP_SCRIPT` is unset, Warden
  checks the installed path first, then the source-checkout path, and uses
  whichever exists on disk — no env var needed for either layout by
  itself. An explicit `WARDEN_CLEANUP_SCRIPT` always wins over that
  discovery unconditionally, including when it's set to something that
  doesn't exist — an invalid explicit override is a configuration error,
  not silently replaced by the discovered path. Verify whatever it
  resolves to before trusting it:
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
| `WARDEN_CLEANUP_SCRIPT` | first of `.agents/skills/github-pr-cleanup/scripts/cleanup.sh` (installed) or `skills/github-pr-cleanup/scripts/cleanup.sh` (source checkout) found under `<repo>`, else the installed path | Terminal cleanup script |
| `GH_APP_TOKEN_HELPER` | `/opt/agent-devcontainer/gh-app-token.sh` | Token helper |

The two-layout auto-detection above only runs when `WARDEN_CLEANUP_SCRIPT`
is unset (see Requirements). Setting it — as agent-devcontainer's launcher
does — always wins, even if the value is wrong for this repo's layout.

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
path) — the resolved script doesn't exist at that path. Auto-detection (see
Requirements) already covers a repo where `WARDEN_CLEANUP_SCRIPT` is simply
unset — so if you're hitting this, either the skill isn't present under
either layout at all, or (most likely, e.g. an agent-devcontainer launcher)
something is setting `WARDEN_CLEANUP_SCRIPT` explicitly to a path that's
wrong for how this repo actually has the skill. An explicit value always
wins over auto-detection, wrong or not. Fix it:

1. Pick the path that matches how this repo actually has the skill —
   installed (`.agents/skills/github-pr-cleanup/scripts/cleanup.sh`) or
   source checkout (`skills/github-pr-cleanup/scripts/cleanup.sh`) — and
   confirm it with the `test -x` check from Requirements.
2. Set `WARDEN_CLEANUP_SCRIPT` to that path for the **daemon process**, not
   just your interactive shell. A launcher/wrapper that starts the daemon
   may export its own `WARDEN_CLEANUP_SCRIPT` on every start, silently
   overwriting a shell-level `export` — if cleanup keeps failing after
   fixing the shell env, check what the daemon's actual environment (and
   the launcher that set it) is passing instead. Unsetting the var
   entirely (instead of pointing it at the right path) also works, since
   auto-detection will then find it, unless the launcher always re-sets it.
3. Restart the daemon so it picks up the corrected value, then run
   `worktree-warden clear <branch>` or `clear --all` — correcting the path
   alone does not retroactively fix entries already stuck on the old one.

## Releasing

Bump `version` in `package.json` and merge to `main`.
`.github/workflows/publish.yml` publishes via npm trusted publishing (OIDC)
if that version isn't already released, and tags the commit.
