#!/usr/bin/env bash
# Vercel build entry point. Referenced by vercel.json, which caps buildCommand at
# 256 characters — hence a script rather than an inline command.
#
# Why this exists: Vercel's default build command is plain `next build`, which
# ships the Next.js frontend and nothing else. The Convex backend had to be
# deployed by hand, and on 2026-08-01 production was found running a new frontend
# against a stale backend — including an authorization fix that had never reached
# production while appearing merged and green.
set -euo pipefail

if [ "${VERCEL_ENV:-}" != "production" ]; then
  # Preview and development builds must NOT deploy Convex. buildCommand applies to
  # every deployment, so without this branch a preview branch would push its own
  # working tree to the PRODUCTION Convex backend.
  echo "vercel-build: VERCEL_ENV=${VERCEL_ENV:-unset} — building frontend only."
  exec npm run build
fi

if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
  # Fail loudly rather than falling back to a plain build. A silent fallback would
  # recreate the exact gap this script closes, and it would look green doing it.
  echo "vercel-build: CONVEX_DEPLOY_KEY is not set for Production." >&2
  echo "Add it from the Convex dashboard (Production deployment -> Settings -> Deploy Keys)," >&2
  echo "scoped to deployment:deploy only. Refusing to ship a frontend against a" >&2
  echo "backend that was never deployed." >&2
  exit 1
fi

echo "vercel-build: deploying Convex backend, then building frontend."
exec npx convex deploy --cmd 'npm run build'
