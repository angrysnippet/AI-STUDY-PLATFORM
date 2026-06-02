import { randomUUID } from 'crypto';

import { repo } from '../db/repository';
import { DEV_USER_ID } from '../types';
import type { Conversation, StudyPlan } from '../types';
import { generateStudyPlan } from './claude';
import { getCourseMeta } from './youtube';

const GREETING =
  "Hi! I'm your study planner. Paste a YouTube course/playlist link and tell me what you want to learn from it.";

export interface AgentReply {
  conversationId: string;
  reply: string;
  phase: Conversation['phase'];
  plan?: StudyPlan;
}

export async function startConversation(userId: string = DEV_USER_ID): Promise<AgentReply> {
  const convo: Conversation = {
    id: randomUUID(),
    userId,
    phase: 'intake',
    collected: {},
    history: [{ role: 'assistant', text: GREETING }],
  };
  await repo.saveConversation(convo);
  return { conversationId: convo.id, reply: GREETING, phase: convo.phase };
}

export async function handleMessage(
  conversationId: string,
  text: string,
  userId: string = DEV_USER_ID,
): Promise<AgentReply> {
  let convo = await repo.getConversation(conversationId);
  // Unknown id, or one owned by a different user → start a fresh conversation.
  if (!convo || convo.userId !== userId) {
    const started = await startConversation(userId);
    convo = (await repo.getConversation(started.conversationId))!;
  }
  // Some stores (Mongo's Mixed type) don't round-trip an empty object/array, so
  // these can come back undefined — normalize before use.
  convo.collected = convo.collected ?? {};
  convo.history = convo.history ?? [];

  convo.history.push({ role: 'user', text });
  const result = await advance(convo, text);
  convo.history.push({ role: 'assistant', text: result.text });
  await repo.saveConversation(convo);

  return { conversationId: convo.id, reply: result.text, phase: convo.phase, plan: result.plan };
}

async function advance(convo: Conversation, text: string): Promise<{ text: string; plan?: StudyPlan }> {
  switch (convo.phase) {
    case 'intake': {
      convo.collected.youtubeUrl = extractUrl(text) ?? convo.collected.youtubeUrl;
      convo.collected.goals = text.trim();
      convo.phase = 'questions';
      return { text: 'Great. A few quick questions:\n\n1) Are you a beginner, intermediate, or advanced with this topic?' };
    }

    case 'questions': {
      if (convo.collected.level === undefined) {
        convo.collected.level = parseLevel(text);
        return { text: '2) Roughly how many minutes can you study per day?' };
      }
      if (convo.collected.minutesPerDay === undefined) {
        convo.collected.minutesPerDay = parseMinutes(text);
        return { text: '3) Do you want hands-on projects/practice included? (yes/no)' };
      }
      if (convo.collected.includeProjects === undefined) {
        convo.collected.includeProjects = parseYesNo(text);
        return {
          text: '4) Any target deadline? e.g. "in 3 weeks" or "30 days" — or say "no" for no deadline.',
        };
      }
      // Final question answered: capture (optional) deadline, then generate.
      convo.collected.deadlineDays = parseDeadline(text);
      convo.phase = 'generate';
      return advance(convo, '');
    }

    case 'generate': {
      const meta = await getCourseMeta(convo.collected.youtubeUrl ?? '');
      const plan = await generateStudyPlan(convo.collected, meta, convo.userId);
      await repo.savePlan(plan);
      convo.planId = plan.id;
      convo.phase = 'done';
      const fb = plan.feasibility;
      const flag = fb.grade === 'FEASIBLE' ? '✅' : fb.grade === 'TIGHT' ? '⚠️' : '🛑';
      const summary =
        `Here's your ${plan.estimatedDays}-day plan for "${plan.courseTitle}" ` +
        `(~${plan.minutesPerDay} min/day, ${plan.level}).\n\n` +
        `${flag} ${fb.grade}: ${fb.note}\n\nReview it on the right — mark days done as you go.`;
      return { text: summary, plan };
    }

    case 'done':
    default:
      return { text: 'Your plan is ready. Start a new chat to plan another course.' };
  }
}

function extractUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : undefined;
}

function parseLevel(text: string): 'beginner' | 'intermediate' | 'advanced' {
  const t = text.toLowerCase();
  if (t.includes('adv')) return 'advanced';
  if (t.includes('inter')) return 'intermediate';
  return 'beginner';
}

function parseMinutes(text: string): number {
  const m = text.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : 45;
  return Math.min(Math.max(n, 10), 600);
}

function parseYesNo(text: string): boolean {
  const t = text.trim().toLowerCase();
  return !(t.startsWith('n') || t.includes('no'));
}

/** Parse a deadline answer into a day count, or undefined for "no deadline". */
function parseDeadline(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!t || /\b(no|none|nope|not|any\s*time|anytime|whenever|no rush)\b/.test(t)) return undefined;
  const m = t.match(/(\d+)\s*(day|week|month|wk|mo)?/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = m[2] ?? 'day';
  const days = unit.startsWith('week') || unit === 'wk' ? n * 7 : unit.startsWith('mo') ? n * 30 : n;
  return Math.min(Math.max(days, 1), 730);
}
