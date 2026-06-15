---
allowed-tools: Bash(security:*), Bash(pnpm:*), Bash(wrangler:*), Bash(curl:*), Bash(jq:*), Bash(timeout:*)
description: Read slopspot-web prod Worker logs — live tail or R2 logpush archive
argument-hint: [--filter=<text>] [--status=error|ok] [--window=<seconds>] [--source=tail|r2]
---

# read-worker-logs

Reads production `slopspot-web` Worker logs. Defaults to a 20-second error-only live tail.
Arguments: $ARGUMENTS

## How to interpret $ARGUMENTS

Parse key=value pairs from `$ARGUMENTS`:
- `--filter=<text>` → pass to `--search` on wrangler tail (substring match in console output)
- `--status=<value>` → `error` (default), `ok`, or omit for all
- `--window=<seconds>` → tail duration in seconds (default 20)
- `--source=tail` (default) or `--source=r2` (reads R2 logpush archive — see Tier 2 below)

## Auth

Cloudflare token is NOT in env this session unless injected by settings.local.json.
Always fetch from keychain first:

```
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w 2>/dev/null)
```

Verify it's non-empty before proceeding.

## Tier 1 — Live tail (default, works now)

```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w 2>/dev/null)

# Adjust --status and --search from $ARGUMENTS
timeout <window> pnpm exec wrangler tail slopspot-web \
  --format json \
  --status error \
  --search "<filter>" \
  2>/dev/null
```

The output is newline-delimited JSON. Each event has:
- `.outcome` — `ok` | `exception` | `exceededCpu` | `exceededMemory` | `canceled`
- `.exceptions[]` — JS exceptions with `.name` and `.message`
- `.logs[]` — console output lines, each with `.level` and `.message[]`
- `.event.request` — the HTTP request that triggered the invocation (method, url, headers)
- `.eventTimestamp` — Unix ms

**Parsing pattern** — extract error logs and exceptions:

```bash
# ... tail output piped through:
jq -c '
  {
    ts: (.eventTimestamp / 1000 | strftime("%H:%M:%S")),
    outcome: .outcome,
    url: .event.request.url,
    exceptions: [.exceptions[] | {name, message}],
    errors: [.logs[] | select(.level == "error") | .message | join(" ")]
  }
  | select(.outcome != "ok" or (.errors | length) > 0)
'
```

## Tier 2 — R2 logpush archive (historical, needs infra setup first)

**Status: NOT YET SET UP** — see ticket slopspot-observability-logs-r2 (or file it).

Once a Logpush job is configured (see plan below), log batches land in R2 at:
`slopspot-logs/YYYY/MM/DD/HH_MM_batch.json.gz`

Read recent batches:
```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w 2>/dev/null)
ACCOUNT_ID="6ed0f3d08bbb66917207f69a818fdab4"

# List objects in the last hour
PREFIX=$(date -u +"%Y/%m/%d/%H")
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/slopspot-logs/objects?prefix=$PREFIX" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result.objects[].key'

# Fetch and decompress a batch
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/slopspot-logs/objects/<key>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | gunzip | jq -c 'select(.Outcome != "ok")' | head -50
```

## Infrastructure plan for Tier 2 (file as ticket if not done)

### Step 1 — Create R2 bucket `slopspot-logs`
```bash
CLOUDFLARE_API_TOKEN=$(security find-generic-password -a "$USER" -s cloudflare-api-token -w)
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/6ed0f3d08bbb66917207f69a818fdab4/r2/buckets" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "slopspot-logs"}'
```

### Step 2 — Create Logpush job (Workers Trace Events → R2)
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/6ed0f3d08bbb66917207f69a818fdab4/logpush/jobs" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "slopspot-workers-logs",
    "dataset": "workers_trace_events",
    "logpull_options": "fields=EventTimestampMs,Outcome,Exceptions,Logs,ScriptName,Event",
    "destination_conf": "r2://slopspot-logs/{DATE}/{HOUR}_{MIN}_{FILENAME}?account-id=6ed0f3d08bbb66917207f69a818fdab4",
    "filter": "{\"where\":{\"key\":\"ScriptName\",\"operator\":\"eq\",\"value\":\"slopspot-web\"}}",
    "enabled": true
  }'
```

### Step 3 — Verify delivery (wait ~5 min after enabling)
```bash
wrangler r2 object list slopspot-logs --prefix "$(date -u +%Y/%m/%d)"
```

### Step 4 — Update this skill's Tier 2 section to mark it active

## Key log patterns to look for

| Pattern | Means |
|---------|-------|
| `fork.action: provider_failed` | fal.ai or Replicate returned non-2xx |
| `fork.action: budget_unavailable` | checkBudget threw — D1 read failure |
| `fork.action: unknown` | unexpected JS error — check `.exceptions` |
| `[metric] slopspot.fork.result` | every fork outcome (success or error) |
| `fork.action: parent_not_found` | post deleted between render and submit |

## What to report back

After running the tail or reading R2 objects, summarize:
1. Count of events captured in the window
2. Error events with: timestamp, outcome, URL, exception message (if any), console.error lines
3. Any `fork.action:` lines with their structured fields (postId, providerId, detail)
4. Overall: "the error is X, happening Y times, pattern is Z"
