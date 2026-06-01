# AI Study Platform

An AI agent that turns a YouTube course + your goals into a personalized, day-by-day study plan. React (client) + Node/Express (server) + Claude. Built to run **with zero real API keys** — every external integration (Claude, MongoDB, Google OAuth, YouTube) has a local stub that activates when its env var is still a placeholder. Swap in real keys later (see *Setup* below).

## Layout
```
ai-study-platform/
  client/   Vite + React + TypeScript
  server/   Node + Express + TypeScript
```

## Run locally (no keys needed)
Two terminals:

```bash
# 1) server
cd server
cp .env.example .env        # leave placeholders → stub mode
npm install
npm run dev                 # http://localhost:4000

# 2) client
cd client
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173, paste a YouTube link + what you want to learn, answer the
agent's questions, and it generates a study plan (deterministic stub until you add a real key).

## Milestones
- **M1 (done):** chat → agent (intake → questions → generate) → rendered plan, in-memory store, all stubbed.
- **M2 (done):** persistence — Mongoose models (User/Course/StudyPlan/Progress/Conversation) behind a
  `Repository` interface; Mongo when `MONGODB_URI` is real, in-memory fallback otherwise. Plans are
  saved/listed/opened/deleted, and each plan tracks day-by-day completion with sequential unlocking.
- **M3 (done):** auth + multi-user. JWT bearer tokens; `/api/agent` and `/api/plans` require auth and
  are scoped to the signed-in user. **Dev login** works with no keys (optionally name a user to test
  isolation); **Google sign-in** activates automatically once real Google credentials are set on the
  server (the client reads availability from `GET /api/auth/config`).
- **M4:** deploy (Vercel + Railway/Render + MongoDB Atlas).

### API
```
GET    /api/auth/config                 → { devLogin, google, googleClientId }
POST   /api/auth/dev-login   {name?}    → { token, user }          (always available)
POST   /api/auth/google      {credential} → { token, user }        (real Google creds only)
GET    /api/auth/me                      → { user }                 [auth]

POST   /api/agent/start                  → { conversationId, reply, phase }   [auth]
POST   /api/agent/message                → { conversationId, reply, phase, plan? }  [auth]
GET    /api/plans                        → PlanSummary[]            [auth, this user only]
GET    /api/plans/:id                    → StudyPlan                [auth]
DELETE /api/plans/:id                    → { ok }                   [auth]
GET    /api/plans/:id/progress           → { completedDays, ... }   [auth]
POST   /api/plans/:id/progress {day,done} → updated progress (409 if earlier days unfinished)  [auth]
```
`[auth]` = requires `Authorization: Bearer <jwt>`. The client stores the token in `localStorage`
and attaches it automatically; a 401 drops the user back to the login screen.

## Setup real services (do this after the app works in stub mode)
Each integration stays stubbed until its env var in `server/.env` is set to a real value.
Step-by-step setup guide for each (Anthropic key, MongoDB Atlas, Google OAuth, YouTube Data API)
will be added here as the milestones land.
