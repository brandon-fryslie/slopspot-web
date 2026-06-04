# Prober image for the live prod liveness smoke suite. Runs the CANONICAL `pnpm smoke`
# (one-source-of-truth — not a reimplementation) and pushes a per-check gauge to
# VictoriaMetrics; the existing vmalert/Alertmanager/ntfy pipeline owns the alerting.
#
# Build context is the REPO ROOT (not services/smoke-prober/), so the Gitea workflow
# builds with `-f services/smoke-prober/Dockerfile .` — it needs the root manifest +
# the smoke suite. Image carries the full devDeps (vitest etc.); acceptable weight for
# a ~1.5s periodic job, and it avoids a duplicate dep manifest that would drift.
ARG NODE_BASE=registry.sanctuary.gdn/node:22-alpine
FROM ${NODE_BASE}
WORKDIR /app

# Pin pnpm to the repo's version (no packageManager field) so --frozen-lockfile is
# lockfile-compatible.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Only what `pnpm smoke` + the prober need: manifest + lockfile + workspace marker,
# the smoke vitest workspace, and the smoke suite (pure HTTP — no app source/build).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vitest.smoke.workspace.ts ./
COPY smoke/ ./smoke/

# --ignore-scripts skips the root postinstall (`wrangler types`) — the suite is pure
# HTTP and needs no Env typegen at runtime. --frozen-lockfile keeps the install reproducible.
RUN pnpm install --frozen-lockfile --ignore-scripts

# The prober runs the suite, translates the result to gauges, and pushes to VM.
# VICTORIA_METRICS_URL is injected by the Nomad job; SMOKE_BASE_URL defaults to
# https://slopspot.ai inside the suite, so the happy path needs no env at all.
CMD ["node", "smoke/prober.mjs"]
