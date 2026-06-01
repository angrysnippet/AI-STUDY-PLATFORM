# AGENTS.md — orientation for AI coding agents

Read this first. It's a map so you don't have to crawl the whole tree. For the
human-facing overview and API list, see `README.md`.

## What this is
An AI study-planner. A user pastes a YouTube course link + goals; an agent
(intake → questions → generate) produces a day-by-day study plan they can save
and track. React client + Node/Express server + Claude.

**Core design rule:** the whole app runs with **zero real API keys**. Every
external dependency (Claude, MongoDB, Google OAuth, YouTube) has a stub that
activates when its env var is still a placeholder (see `server/src/config/env.ts`,
`isReal()`). Preserve this — never make a real key *required* to run or build.

## Layout & where things live
```
server/                         Node + Express + TypeScript (CommonJS, tsx dev, tsc build)
  src/
    config/env.ts               env loading + stub flags (isReal placeholder detection)
    types.ts                    shared domain types (StudyPlan, Progress, Conversation, …)
    db/
      repository.ts             Repository interface + InMemory impl + swappable proxy + initRepository()
      mongoRepository.ts        Mongo/Mongoose impl (used when MONGODB_URI is real)
    models/index.ts             Mongoose schemas (User, Course, StudyPlan, Progress, Conversation)
    services/
      agent.ts                  intake→questions→generate state machine
      claude.ts                 Claude plan generation (forced tool_use) + deterministic stub
      youtube.ts                YouTube Data API + deterministic stub + Course cache
    routes/agent.ts             POST /start, POST /message, GET /plan/:id  (behind requireAuth)
    routes/plans.ts             list/get/delete plans + get/POST progress (sequential gating, per-user)
    routes/auth.ts              GET /config, POST /dev-login, POST /google, GET /me
    services/auth.ts            JWT sign/verify, devLogin, googleLogin (Google ID-token verify)
    middleware/auth.ts          requireAuth (sets req.user) + userId(req) helper
    index.ts                    app bootstrap (initRepository, mount routers, listen)
client/                         Vite + React 18 + TypeScript
  src/
    api/client.ts               fetch wrapper to the server
    types.ts                    mirror of server domain types
    components/PlanView.tsx     renders a plan + per-day completion checkboxes (gated)
    App.tsx                     chat pane + plan pane + saved-plans rail
    styles.css                  dark theme
```

## How to run / verify
```
cd server && npm install && npm run dev      # :4000  (cp .env.example .env first)
cd client && npm install && npm run dev      # :5173  (cp .env.example .env first)
```
Verify before committing: `npm run typecheck` (or `tsc --noEmit`) **and** `npm run build`
must pass in **both** `server/` and `client/`. There is no test suite yet — adding one is welcome.

## Conventions
- TypeScript strict mode. Match the surrounding style; keep comments purposeful, not noisy.
- Server is CommonJS; client is ESM (`type: module`).
- All persistence goes through the `Repository` interface — don't call Mongoose models
  directly outside `db/` and `models/`. New storage needs go on the interface + both impls.
- Claude calls use the official `@anthropic-ai/sdk`, model `claude-opus-4-8`, structured
  output via **forced `tool_choice`** (not thinking). Keep the system prompt byte-stable
  (it's prompt-cached).

## Hard rules (do not violate)
- **Never commit secrets.** Only `.env.example` with placeholders. Real keys are added by
  the human later. Secrets are server-side only — never import them into `client/`.
- **Don't break stub mode.** The app must still run/build with all-placeholder env vars.
- `node_modules/`, `dist/`, and `.env` are gitignored — keep them out of commits.

## Milestone status
- **M1 done:** chat → agent → rendered plan (in-memory, stubbed).
- **M2 done:** persistence (Repository + Mongo/in-memory), saved plans, per-day progress with gating.
- **M3 done:** auth + multi-user — JWT bearer tokens, `requireAuth` on `/api/agent` + `/api/plans`,
  everything scoped to `req.user.id`. Dev-login is the zero-key path; Google sign-in turns on
  automatically when real Google creds are configured (client reads `GET /api/auth/config`).
- **M4 (next):** deploy (Vercel + Railway/Render + Atlas) + credential setup guide.

## Work split (when multiple agents collaborate)
To avoid editing the same files at once: **auth/server middleware + `routes/auth.ts`** is one
lane; **`client/` polish, `deploy/` config, and docs/tests** is another. Commit at each handoff.
