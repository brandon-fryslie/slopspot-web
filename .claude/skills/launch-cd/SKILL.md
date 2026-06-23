---
name: launch-cd
description: Summon the SlopSpot Creative Director (CD) — launch a tmux window running the standalone `claude` CD instance (its own ~/.claude-creative config + Neuroweaving system prompt) so a CD verdict is never a hard blocker. Use when the user says "launch the CD", "start the CD", "summon the creative director", "spin up the CD", "I need a CD verdict and none is running", or when work is blocked waiting on the CD's cold creative judgement and you need to get the CD running to consult it.
---

# launch-cd — get the Creative Director running, on demand

Much SlopSpot work parks on the **CD's cold creative verdict** (render-fidelity image
judgements, embalm-vs-recede calls, gate flips). When no CD is running, that block is
unbreakable. This skill removes the block: it launches the CD as its own `claude`
instance in a dedicated tmux window, so you can consult it whenever you need a verdict.

## What it does

Runs `launch.sh`, which creates a tmux window named **`cd`** running the **verbatim** CD
launch command (`claude` under `CLAUDE_CONFIG_DIR=~/.claude-creative` with the Neuroweaving
system prompt). The skill is two parts with one seam `[LAW:decomposition]`:

- **`cd-command.sh`** — the CD's *identity*: a byte-for-byte copy of the launch command.
  This is the single durable source of truth for "what the CD is" `[LAW:one-source-of-truth]`
  (the original lived in `/tmp`, which is wiped on reboot). Edit this to change the CD's
  prompt/flags.
- **`launch.sh`** — the tmux *lifecycle*: preconditions, session resolution, one-CD dedup,
  window creation. Edit this to change *how* the CD is launched, never *what* it is.

## How to run it

```bash
bash .claude/skills/launch-cd/launch.sh            # launch CD and switch to its window
bash .claude/skills/launch-cd/launch.sh -d         # launch but KEEP your current pane focused
bash .claude/skills/launch-cd/launch.sh --restart  # kill the existing CD window and respawn
```

**If you are an agent launching this mid-task, use `-d`** so you don't lose your own pane's
focus. Then talk to the CD with the **tmux-talk** skill against pane `<session>:cd` — that
skill owns the conversation protocol; this one only gets the CD running `[LAW:one-source-of-truth]`.

## Guarantees (and how to verify)

- **Exactly one CD.** If a `cd` window already exists it is reused, not duplicated; only
  `--restart` respawns. `[LAW:no-ambient-temporal-coupling]`
- **Fails loud, never half-launches.** Missing `tmux`/`claude`/payload, or no tmux server,
  aborts with a clear FATAL message rather than spawning a window that flash-dies.
  `[LAW:no-silent-failure]`
- **Verifiable success.** On success it prints `CD launched at <session>:cd`. Confirm with
  `tmux list-windows | grep cd`. `[LAW:verifiable-goals]`

## Notes

- Targets the **current** tmux session when run inside tmux; otherwise uses (or creates) a
  detached `slopspot-web` session.
- The CD window runs in the repo root, so the CD can read `design-docs/` and artifacts when asked.
- Closing the CD: `tmux kill-window -t <session>:cd` (or just `--restart` next time).
