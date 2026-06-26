#!/usr/bin/env bash
# launch.sh — summon the Creative Director (CD) into a tmux window.
#
# Two parts, one seam: this file owns the tmux LIFECYCLE (where the CD lives,
# exactly one of it, fail-loud preconditions). cd-command.sh owns the CD's
# IDENTITY (the verbatim `claude` invocation + Neuroweaving system prompt).
# Edit one without touching the other. [LAW:decomposition] [LAW:locality-or-seam]
#
# Usage:  launch.sh [-d|--detach] [--restart]
#   (default)        create the CD window AND switch to it
#   -d, --detach     create it but DON'T steal focus (use this mid-task so an
#                    agent keeps its own pane current, then talk via tmux-talk)
#   --restart        kill an existing CD window and respawn a fresh one
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$SCRIPT_DIR/cd-command.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WINDOW_NAME="cd"

SELECT=1   # default: switch to the CD window
RESTART=0
for arg in "$@"; do
  case "$arg" in
    -d|--detach) SELECT=0 ;;
    --restart)   RESTART=1 ;;
    -h|--help)   sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "[launch-cd] unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# --- Preconditions: fail LOUD; never spawn a window that will silently die. [LAW:no-silent-failure]
command -v tmux   >/dev/null || { echo "[launch-cd] FATAL: tmux not on PATH." >&2; exit 1; }
command -v claude >/dev/null || { echo "[launch-cd] FATAL: 'claude' not on PATH — the CD window would die instantly." >&2; exit 1; }
[ -s "$PAYLOAD" ]            || { echo "[launch-cd] FATAL: CD payload missing/empty at $PAYLOAD" >&2; exit 1; }
tmux info >/dev/null 2>&1    || { echo "[launch-cd] FATAL: no tmux server reachable — start tmux first." >&2; exit 1; }

# --- The CD's own config dir is informational, not fatal: claude creates it fresh if absent.
[ -d "$HOME/.claude-creative" ] || echo "[launch-cd] note: ~/.claude-creative does not exist yet — claude will create a FRESH CD config (no prior history)."

# --- Resolve the one session that owns the CD window. [LAW:no-ambient-temporal-coupling]
if [ -n "${TMUX:-}" ]; then
  SESSION="$(tmux display-message -p '#{session_name}')"
elif tmux has-session -t slopspot-web 2>/dev/null; then
  SESSION="slopspot-web"
else
  SESSION="slopspot-web"
  tmux new-session -d -s "$SESSION" -c "$REPO_ROOT"
  echo "[launch-cd] created detached tmux session '$SESSION'."
fi
TARGET="$SESSION:$WINDOW_NAME"

# --- Dedup: exactly one CD. Reuse it, or respawn on explicit --restart — never two. [LAW:no-ambient-temporal-coupling]
if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx "$WINDOW_NAME"; then
  if [ "$RESTART" -eq 1 ]; then
    echo "[launch-cd] --restart: killing existing CD window $TARGET"
    tmux kill-window -t "$TARGET"
  else
    echo "[launch-cd] CD already running at $TARGET (use --restart to respawn)."
    [ "$SELECT" -eq 1 ] && tmux select-window -t "$TARGET"
    exit 0
  fi
fi

# --- Act at the boundary: create the window running the verbatim CD payload. [LAW:effects-at-boundaries]
tmux new-window -d -t "$SESSION" -n "$WINDOW_NAME" -c "$REPO_ROOT" "exec bash '$PAYLOAD'"

# --- Verify creation deterministically (synchronous; no sleeps). [LAW:verifiable-goals]
if tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -qx "$WINDOW_NAME"; then
  echo "[launch-cd] CD launched at $TARGET (config: ~/.claude-creative, cwd: $REPO_ROOT)."
  echo "[launch-cd] jump to it:  tmux select-window -t $TARGET"
  echo "[launch-cd] talk to it:  use the tmux-talk skill against pane $TARGET"
  [ "$SELECT" -eq 1 ] && tmux select-window -t "$TARGET"
else
  echo "[launch-cd] FATAL: window $TARGET was not created." >&2
  exit 1
fi
