---
allowed-tools: Bash(security:*), Bash(pnpm:*), Bash(timeout:*), Bash(jq:*)
description: Read slopspot-web prod Worker logs via live wrangler tail — errors, fork failures, console.error
argument-hint: [--filter=<text>] [--status=error|ok|all] [--window=<seconds>]
---

# read-worker-logs

Live-tails the production `slopspot-web` Worker and surfaces error events.
Zero cost — uses the free Workers Tail API.

Arguments: $ARGUMENTS

## Argument parsing

- `--filter=<text>` → passed as `--search` to wrangler tail (substring match in console output)
- `--status=error` (default) | `ok` | `all` (omit the flag)
- `--window=<seconds>` → how long to tail (default 20; use 60+ when reproducing an error)

## Auth — always fetch from keychain

```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w 2>/dev/null)
```

Abort with an explanation if the token is empty.

## Running the tail

```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w 2>/dev/null)

timeout <window> pnpm exec wrangler tail slopspot-web \
  --format json \
  --status error \
  [--search "<filter>"] \
  2>/dev/null
```

Remove `--status error` if `--status=all` was requested.
Remove `--search` if no `--filter` was given.

## Parsing the JSON stream

Each newline-delimited JSON event has:
- `.outcome` — `ok` | `exception` | `exceededCpu` | `exceededMemory` | `canceled`
- `.exceptions[]` — unhandled JS exceptions: `.name`, `.message`
- `.logs[]` — console output: `.level` (`log`|`warn`|`error`|`debug`) and `.message[]` (array of args)
- `.event.request.url` — the HTTP URL that triggered the invocation
- `.eventTimestamp` — Unix milliseconds

**Standard parse pipeline** — pipe tail output through:

```bash
jq -c '
  {
    ts: (.eventTimestamp / 1000 | strftime("%H:%M:%S")),
    outcome: .outcome,
    url: (try .event.request.url catch "scheduled"),
    exceptions: [.exceptions[]? | "\(.name): \(.message)"],
    errors: [.logs[]? | select(.level == "error") | .message | join(" ")]
  }
  | select(.outcome != "ok" or (.errors | length) > 0 or (.exceptions | length) > 0)
'
```

## Key patterns

| Console pattern | What it means |
|----------------|---------------|
| `fork.action: provider_failed` | fal.ai / Replicate returned non-2xx; check `upstreamStatus` field |
| `fork.action: budget_unavailable` | `checkBudget` threw — D1 read failed |
| `fork.action: unknown` | unexpected JS error — the `.exceptions` field has the detail |
| `fork.action: parent_not_found` | post deleted between render and submit |
| `fork.action: provider_unavailable` | mock provider selected in prod (crafted request) |
| `[metric] slopspot.fork.result` | every fork outcome; `reason` field is the slug |

## For historical error RATES (not individual events)

VictoriaMetrics already captures `slopspot.fork.result{outcome,reason}` via the `/metrics`
scrape every 5 min. Query in Grafana:

```promql
# Fork error rate by reason (last 24h)
increase(slopspot_fork_result{outcome="error"}[24h]) by (reason)

# Error ratio
rate(slopspot_fork_result{outcome="error"}[1h])
/ rate(slopspot_fork_result[1h])
```

Grafana is at http://grafana.sanctuary.gdn (or check homelab DNS).
The `slopspot-web` dashboard (if it exists) should have fork panels.
If not, add the promql above as a new panel — zero infra change needed.

## What to report after tailing

1. How many events arrived in the window (0 = prod is clean right now)
2. For each error event: `ts`, `url`, exception message, and every `console.error` line
3. Structured fields from fork errors: `postId`, `providerId`, `detail`
4. Conclusion: "the error is X, pattern is Y, next step is Z"
