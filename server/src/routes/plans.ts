import { Router } from 'express';

import { repo } from '../db/repository';
import { userId } from '../middleware/auth';
import type { Progress } from '../types';

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
