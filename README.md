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
- **M3:** auth + multi-user (JWT + Google OAuth, dev-login stub).
- **M4:** deploy (Vercel + Railway/Render + MongoDB Atlas).

### API (M2)
```
POST   /api/agent/start                 → { conversationId, reply, phase }
POST   /api/agent/message               → { conversationId, reply, phase, plan? }
GET    /api/plans                       → PlanSummary[]            (current user's plans)
GET    /api/plans/:id                   → StudyPlan
DELETE /api/plans/:id                   → { ok }
GET    /api/plans/:id/progress          → { completedDays, ... }
POST   /api/plans/:id/progress {day,done} → updated progress (409 if earlier days unfinished)
```
Until M3, every request is scoped to a single `dev-user`.

## Setup real services (do this after the app works in stub mode)
Each integration stays stubbed until its env var in `server/.env` is set to a real value.
Step-by-step setup guide for each (Anthropic key, MongoDB Atlas, Google OAuth, YouTube Data API)
will be added here as the milestones land.
