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
      // Need a real YouTube playlist link before we can do anything.
      const url = extractUrl(text);
      if (!url || !isYouTubeUrl(url)) {
        return {
          text:
            "I need a YouTube link to build your plan. Paste the course **playlist** URL " +
            '(it has `list=` in it) and tell me what you want to learn — e.g. ' +
            '"https://youtube.com/playlist?list=… — learn Python".',
        };
      }
      if (!hasPlaylistId(url)) {
        return {
          text:
            'That looks like a single video, not a playlist. Paste the **playlist** URL ' +
            '(it contains `list=`) so I can build a full day-by-day plan.',
        };
      }
      convo.collected.youtubeUrl = url;
      convo.collected.goals = text.replace(url, '').trim() || 'general mastery of the material';
      convo.phase = 'questions';
      return {
        text: 'Great. A few quick questions:\n\n1) Are you a beginner, intermediate, or advanced with this topic?',
      };
    }

    case 'questions': {
      // Each answer is validated; on invalid input we hint and re-ask the SAME
      // question (the field stays unset, so we re-enter this branch next turn).
      if (convo.collected.level === undefined) {
        const r = validateLevel(text);
        if (!r.ok) {
          return { text: "I didn't catch that — are you a **beginner**, **intermediate**, or **advanced** with this topic?" };
        }
        convo.collected.level = r.value;
        return { text: '2) Roughly how many minutes can you study per day?' };
      }
      if (convo.collected.minutesPerDay === undefined) {
        const r = validateMinutes(text);
        if (!r.ok) {
          return { text: 'Please give me a number of **minutes per day** — e.g. "30", "45", or "1 hour".' };
        }
        convo.collected.minutesPerDay = r.value;
        return { text: '3) Do you want hands-on projects/practice included? (yes/no)' };
      }
      if (convo.collected.includeProjects === undefined) {
        const r = validateYesNo(text);
        if (!r.ok) {
          return { text: 'Just **yes** or **no** — should I include hands-on projects/practice?' };
        }
        convo.collected.includeProjects = r.value;
        return {
          text: '4) Any target deadline? e.g. "in 3 weeks" or "30 days" — or say "no" for no deadline.',
        };
      }
      // Final question: deadline (optional, but the answer must be understandable).
      const r = validateDeadline(text);
      if (!r.ok) {
        return { text: 'Tell me a target like "in 3 weeks" or "30 days", or say "no" if there\'s no deadline.' };
      }
      convo.collected.deadlineDays = r.value;
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

type Valid<T> = { ok: true; value: T } | { ok: false };

function extractUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : undefined;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function hasPlaylistId(url: string): boolean {
  return /[?&]list=[A-Za-z0-9_-]+/.test(url);
}

function validateLevel(text: string): Valid<'beginner' | 'intermediate' | 'advanced'> {
  const t = text.toLowerCase();
  if (/\b(advanced|expert|pro|experienced|senior)\b/.test(t)) return { ok: true, value: 'advanced' };
  if (/\b(intermediate|inter|some experience|some|moderate|medium|a bit)\b/.test(t)) {
    return { ok: true, value: 'intermediate' };
  }
  if (/\b(beginner|begin|new|newbie|novice|starter|start|basic|basics|zero|none|fresh|scratch)\b/.test(t)) {
    return { ok: true, value: 'beginner' };
  }
  return { ok: false };
}

function validateMinutes(text: string): Valid<number> {
  const t = text.toLowerCase();
  let mins = 0;
  if (/\bhalf(?:\s+an?)?\s*hour\b/.test(t)) {
    mins = 30;
  } else if (/\ban?\s*hour\b/.test(t)) {
    mins = 60;
  } else {
    const hr = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
    const mn = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
    if (hr) mins += Math.round(parseFloat(hr[1]) * 60);
    if (mn) mins += parseInt(mn[1], 10);
    if (!hr && !mn) {
      const bare = t.match(/\b(\d{1,3})\b/);
      if (!bare) return { ok: false };
      mins = parseInt(bare[1], 10);
    }
  }
  if (!Number.isFinite(mins) || mins < 5 || mins > 600) return { ok: false };
  return { ok: true, value: mins };
}

function validateYesNo(text: string): Valid<boolean> {
  const t = text.trim().toLowerCase();
  if (/^(y|yes|yeah|yep|yup|sure|ok|okay|please|definitely|absolutely)\b/.test(t) || /\byes\b/.test(t)) {
    return { ok: true, value: true };
  }
  if (/^(n|no|nope|nah)\b/.test(t) || /\b(no|don'?t|without|skip)\b/.test(t)) {
    return { ok: true, value: false };
  }
  return { ok: false };
}

/** Valid result of `undefined` means "no deadline" (a legitimate answer). */
function validateDeadline(text: string): Valid<number | undefined> {
  const t = text.trim().toLowerCase();
  if (!t) return { ok: false };
  if (/\b(no|none|nope|not|any\s*time|anytime|whenever|no rush|no deadline|flexible)\b/.test(t)) {
    return { ok: true, value: undefined };
  }
  const m = t.match(/(\d+)\s*(day|days|week|weeks|wk|month|months|mo)?/);
  if (!m) return { ok: false };
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  const unit = m[2] ?? 'day';
  const days =
    unit.startsWith('week') || unit === 'wk' ? n * 7 : unit.startsWith('mo') ? n * 30 : n;
  return { ok: true, value: Math.min(Math.max(days, 1), 730) };
}
