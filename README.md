# Voxandra

Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record.

It runs in production at [voxandra.com](https://voxandra.com). This repository is the full app: the Next.js frontend, the Convex backend, and the realtime media worker that carries translated calls.

## What it does

- **Live Voice Translation.** You call from the browser, Voxandra dials the other person, and each side hears the other in their own language. Before the conversation starts, a spoken disclosure plays to both people.
- **Live Guidance.** While you talk, you get private prompts that only you can see.
- **Call Records.** After the call you get a transcript with speakers labeled, an AI note, extracted details, contacts, and reminders. You review them before they're saved to your workspace.
- **Calls library.** Search past calls by meaning, ask questions across them, and get a brief before your next call.
- **Read-only MCP server.** AI clients can read a workspace's reviewed Call Records through `/api/mcp`, using personal API keys created in the app.
- **Billing.** Plans, prepaid calling credits, top-ups, and per-destination rates priced from Twilio's own rate data.

## Stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend and database | [Convex](https://convex.dev) (queries, mutations, actions, crons) |
| Auth | Convex Auth: email codes, password, and Google |
| Telephony | Twilio Voice (browser calling, Media Streams, two-leg bridge) |
| Speech and AI | OpenAI (transcription, extraction, embeddings, realtime guidance) and Palabra (speech-to-speech translation) |
| Realtime media | Standalone Node WebSocket worker (`scripts/realtime-media-worker.mjs`) |
| Billing | Stripe |
| Email | Resend |
| Analytics | PostHog EU, browser only, no session replay |

## Repository layout

```
src/app/          Next.js routes: public site, /app (signed-in), API routes, webhooks
src/components/   UI, grouped by area (landing, dashboard, calls, memory, dialer, ...)
src/lib/          Shared logic: pricing, billing, Twilio, AI prompts, MCP, rate tables
convex/           Backend: schema, functions, crons, auth, Stripe and Twilio flows
scripts/          Realtime media worker, test suite, smoke tests, rate sync
docs/             Supporting notes and evals
```

Longer-form docs are in the repo root:

- [`AGENTS.md`](AGENTS.md): the working guide for anyone, human or AI, changing this code. Covers architecture rules, product rules, and guardrails.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): background on auth, workspaces, and the data model.
- [`REALTIME_WORKER_RUNBOOK.md`](REALTIME_WORKER_RUNBOOK.md): how the translation worker is deployed and operated.

## Getting started

### Prerequisites

- Node.js 24
- A [Convex](https://convex.dev) account (the free tier is enough)
- An OpenAI API key
- A [Resend](https://resend.com) API key, or Google OAuth credentials, so you can sign in. Without one of them, sign-in codes are never delivered.

Twilio, Stripe, Palabra, and PostHog are optional for running the app locally.

### 1. Install

```bash
git clone https://github.com/areia-ai/voxandra.git
cd voxandra
npm install
cp .env.example .env.local
```

### 2. Create your Convex deployment

```bash
npx convex dev
```

On the first run you'll be asked to log in and create a project. This writes your own `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`, replacing the example values. Keep it running: it pushes backend changes as you edit `convex/`.

### 3. Set up auth

In a second terminal, generate the Convex Auth signing keys:

```bash
npx @convex-dev/auth
```

This sets `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` on your Convex deployment.

### 4. Set backend secrets

Convex functions read their secrets from the Convex deployment, not from `.env.local`:

```bash
npx convex env set OPENAI_API_KEY sk-...
```

```bash
npx convex env set RESEND_API_KEY re_...
```

For Google sign-in, also set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` the same way.

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, and a personal workspace is created for you.

## Configuration

[`.env.example`](.env.example) lists every variable with comments. They're read in three places, and several must match across them:

| Where | How it's set | Examples |
| --- | --- | --- |
| Next.js app (Vercel) | `.env.local` locally, project env in production | `NEXT_PUBLIC_*`, `TWILIO_*` for webhook validation, `STRIPE_SECRET_KEY`, `MCP_CONVEX_SECRET`, `REALTIME_STREAM_SIGNING_SECRET` |
| Convex | `npx convex env set NAME value` | `OPENAI_API_KEY`, `RESEND_API_KEY`, `AUTH_*`, `TWILIO_*` call limits and allowlists, `STRIPE_CONVEX_WEBHOOK_SECRET`, `MCP_CONVEX_SECRET` |
| Realtime worker | The worker host's environment | `OPENAI_*` realtime models, `PALABRA_API_KEY`, `REALTIME_*` tuning, `REALTIME_CONVEX_WORKER_SECRET`, `REALTIME_STREAM_SIGNING_SECRET` |

Optional features stay off until you configure them:

- **Phone calls:** fill in the `TWILIO_*` block and set `NEXT_PUBLIC_TWILIO_CALLING_ENABLED=true`. Calls only go to destinations in `TWILIO_ALLOWED_COUNTRIES` or `TWILIO_ALLOWED_NUMBERS` that have a rate row. Refresh rates with `npm run sync:twilio-rates`.
- **Translated calls:** need the realtime worker (`npm run realtime:worker`) reachable over a public WebSocket URL set as `REALTIME_MEDIA_STREAM_URL`, plus the bridge flags described in the runbook.
- **Billing:** use Stripe test-mode keys and point a Stripe webhook at `/api/stripe/webhook`.
- **Analytics:** set `NEXT_PUBLIC_POSTHOG_KEY`. Leave it blank and nothing is sent.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npx convex dev` | Sync and watch Convex functions |
| `npm test` | Run the full regression suite (no live calls or payments) |
| `npm run lint` | Lint |
| `npm run build` | Production build |
| `npm run realtime:worker` | Run the realtime media worker |
| `npx convex codegen` | Regenerate Convex types after schema or API changes |

The `test:*-smoke`, `probe:*`, `eval:*`, and `prewarm:*` scripts call paid provider APIs. Read the script before you run it.

## Contributing

Issues and pull requests are welcome. Read [`AGENTS.md`](AGENTS.md) before making a substantial change, since several of its rules are enforced by `npm test`. Before opening a PR, run `npm test`, `npm run lint`, and `npm run build`.

Never commit secrets, real phone numbers, or customer data. Use placeholder values in tests and docs.

## License

Voxandra is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your modified source available to its users.
