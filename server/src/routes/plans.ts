import { Router } from 'express';

import { repo } from '../db/repository';
import { userId } from '../middleware/auth';
import { answerDoubt } from '../services/doubt';
import type { DoubtThread, PlanDay, Progress, StudyPlan } from '../types';

// Mounted behind requireAuth, so req.user is always present here.
export const plansRouter = Router();

// List the current user's saved plans (newest first), trimmed for a list view.
plansRouter.get('/', async (req, res) => {
  const plans = await repo.listPlans(userId(req));
  res.json(
    plans.map((p) => ({
      id: p.id,
      courseTitle: p.courseTitle,
      level: p.level,
      minutesPerDay: p.minutesPerDay,
      estimatedDays: p.estimatedDays,
      createdAt: p.createdAt,
    })),
  );
});

// Fetch one full plan (must belong to the current user).
plansRouter.get('/:id', async (req, res) => {
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== userId(req)) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  res.json(plan);
});

// Delete a plan (and its progress).
plansRouter.delete('/:id', async (req, res) => {
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== userId(req)) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  await repo.deletePlan(req.params.id);
  res.json({ ok: true });
});

// Current completion state for a plan.
plansRouter.get('/:id/progress', async (req, res) => {
  const uid = userId(req);
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== uid) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  const progress = (await repo.getProgress(plan.id, uid)) ?? emptyProgress(plan.id, uid);
  res.json(progress);
});

// Toggle a day's completion. Days unlock sequentially: you can only complete
// day N once days 1..N-1 are done, and un-completing a day clears all later days.
plansRouter.post('/:id/progress', async (req, res) => {
  const uid = userId(req);
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== uid) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }

  const day = Number(req.body?.day);
  const done = Boolean(req.body?.done);
  const dayNumbers = plan.days.map((d) => d.day);
  if (!Number.isInteger(day) || !dayNumbers.includes(day)) {
    res.status(400).json({ error: 'invalid day' });
    return;
  }

  const progress = (await repo.getProgress(plan.id, uid)) ?? emptyProgress(plan.id, uid);
  const completed = new Set(progress.completedDays);
  const ordered = [...dayNumbers].sort((a, b) => a - b);

  if (done) {
    const prior = ordered.filter((d) => d < day);
    if (!prior.every((d) => completed.has(d))) {
      res.status(409).json({ error: 'finish earlier days first' });
      return;
    }
    completed.add(day);
  } else {
    // Un-completing a day also un-completes everything after it.
    for (const d of ordered) if (d >= day) completed.delete(d);
  }

  const updated: Progress = {
    planId: plan.id,
    userId: uid,
    completedDays: ordered.filter((d) => completed.has(d)),
    updatedAt: new Date().toISOString(),
  };
  await repo.saveProgress(updated);
  res.json(updated);
});

function emptyProgress(planId: string, userId: string): Progress {
  return { planId, userId, completedDays: [], updatedAt: new Date().toISOString() };
}

// ── Doubt solver (per-topic Q&A) ─────────────────────────────────────────────

// Fetch the doubt thread for one day of a plan.
plansRouter.get('/:id/doubts/:day', async (req, res) => {
  const uid = userId(req);
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== uid) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  const day = Number(req.params.day);
  const dayObj = plan.days.find((d) => d.day === day);
  if (!dayObj) {
    res.status(400).json({ error: 'invalid day' });
    return;
  }
  const thread = (await repo.getDoubtThread(plan.id, uid, day)) ?? emptyThread(plan, uid, dayObj);
  res.json(thread);
});

// Ask a question about one day's topic; appends Q + AI answer and returns the thread.
plansRouter.post('/:id/doubts/:day', async (req, res) => {
  const uid = userId(req);
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== uid) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  const day = Number(req.params.day);
  const dayObj = plan.days.find((d) => d.day === day);
  if (!dayObj) {
    res.status(400).json({ error: 'invalid day' });
    return;
  }
  const question = String(req.body?.question ?? '').trim();
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  const thread = (await repo.getDoubtThread(plan.id, uid, day)) ?? emptyThread(plan, uid, dayObj);
  const history = thread.messages.slice(); // prior turns, before this question
  const now = new Date().toISOString();
  thread.messages.push({ role: 'user', text: question, at: now });

  const answer = await answerDoubt(
    { courseTitle: plan.courseTitle, dayTitle: dayObj.title, topics: watchTopics(dayObj), level: plan.level },
    question,
    history,
  );
  thread.messages.push({ role: 'assistant', text: answer, at: new Date().toISOString() });
  thread.updatedAt = new Date().toISOString();
  await repo.saveDoubtThread(thread);
  res.json(thread);
});

function emptyThread(plan: StudyPlan, userId: string, dayObj: PlanDay): DoubtThread {
  return {
    planId: plan.id,
    userId,
    day: dayObj.day,
    topic: dayObj.title,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

/** The cleaned video titles a day covers (from its Watch block). */
function watchTopics(day: PlanDay): string[] {
  const watch = day.blocks.find((b) => b.title.startsWith('Watch'));
  if (!watch) return [day.title];
  return watch.tasks.map((t) => t.text.replace(/^▶\s*/, '').replace(/\s*\([^)]*\)\s*$/, ''));
}
