import type { AgentReply, AuthConfig, PlanSummary, Progress, StudyPlan, User } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'asp_token';

// ── Token storage ─────────────────────────────────────────────────────────────
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Fired when the server rejects our token (401) so the app can drop to login. */
export const onUnauthorized = new EventTarget();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    onUnauthorized.dispatchEvent(new Event('unauthorized'));
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export function getAuthConfig(): Promise<AuthConfig> {
  return request<AuthConfig>('/api/auth/config');
}

export async function devLogin(name?: string): Promise<User> {
  const { token, user } = await request<{ token: string; user: User }>('/api/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  setToken(token);
  return user;
}

export async function googleLogin(credential: string): Promise<User> {
  const { token, user } = await request<{ token: string; user: User }>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
  setToken(token);
  return user;
}

export async function getMe(): Promise<User> {
  const { user } = await request<{ user: User }>('/api/auth/me');
  return user;
}

// ── Agent ────────────────────────────────────────────────────────────────────
export function startConversation(): Promise<AgentReply> {
  return request<AgentReply>('/api/agent/start', { method: 'POST' });
}

export function sendMessage(conversationId: string, text: string): Promise<AgentReply> {
  return request<AgentReply>('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({ conversationId, text }),
  });
}

// ── Saved plans + progress ─────────────────────────────────────────────────────
export function listPlans(): Promise<PlanSummary[]> {
  return request<PlanSummary[]>('/api/plans');
}
export function getPlan(id: string): Promise<StudyPlan> {
  return request<StudyPlan>(`/api/plans/${id}`);
}
export async function deletePlan(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/plans/${id}`, { method: 'DELETE' });
}
export function getProgress(planId: string): Promise<Progress> {
  return request<Progress>(`/api/plans/${planId}/progress`);
}
export function setDayDone(planId: string, day: number, done: boolean): Promise<Progress> {
  return request<Progress>(`/api/plans/${planId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ day, done }),
  });
}
