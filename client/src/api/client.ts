import type { AgentReply, PlanSummary, Progress, StudyPlan } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function startConversation(): Promise<AgentReply> {
  const res = await fetch(`${BASE}/api/agent/start`, { method: 'POST' });
  if (!res.ok) throw new Error('could not start conversation');
  return res.json();
}

export async function sendMessage(conversationId: string, text: string): Promise<AgentReply> {
  const res = await fetch(`${BASE}/api/agent/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, text }),
  });
  return json<AgentReply>(res);
}

// ── Saved plans + progress (M2) ───────────────────────────────────────────────

export async function listPlans(): Promise<PlanSummary[]> {
  return json<PlanSummary[]>(await fetch(`${BASE}/api/plans`));
}

export async function getPlan(id: string): Promise<StudyPlan> {
  return json<StudyPlan>(await fetch(`${BASE}/api/plans/${id}`));
}

export async function deletePlan(id: string): Promise<void> {
  await json<{ ok: boolean }>(await fetch(`${BASE}/api/plans/${id}`, { method: 'DELETE' }));
}

export async function getProgress(planId: string): Promise<Progress> {
  return json<Progress>(await fetch(`${BASE}/api/plans/${planId}/progress`));
}

export async function setDayDone(planId: string, day: number, done: boolean): Promise<Progress> {
  const res = await fetch(`${BASE}/api/plans/${planId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, done }),
  });
  return json<Progress>(res);
}
