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
  /** Tappable quick-reply options for the current question (server-computed). */
  suggestions?: string[];
}

interface Step {
  text: string;
  plan?: StudyPlan;
  suggestions?: string[];
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

  return {
    conversationId: convo.id,
    reply: result.text,
    phase: convo.phase,
    plan: result.plan,
    suggestions: result.suggestions,
  };
}

async function advance(convo: Conversation, text: string): Promise<Step> {
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

      // Analyze the playlist NOW so the follow-up questions are tailored to it.
      const meta = await getCourseMeta(url);
      convo.course = { title: meta.title, videoCount: meta.videoCount, totalMinutes: meta.totalMinutes };
      convo.phase = 'questions';
      return {
        text:
          `Nice — I went through **${meta.title}**: **${meta.videoCount} videos**, about ` +
          `**${humanizeHours(meta.totalMinutes)}** of content.\n\n` +
          `To shape your plan: how would you rate your experience with this topic?`,
        suggestions: LEVEL_OPTIONS,
      };
    }

    case 'questions': {
      const course = convo.course;
      // Each answer is validated; on invalid input we hint and re-ask the SAME
      // question (the field stays unset, so we re-enter this branch next turn).
      if (convo.collected.level === undefined) {
        const r = validateLevel(text);
        if (!r.ok) {
          return {
            text: "I didn't quite catch that — how would you rate your experience with this topic?",
            suggestions: LEVEL_OPTIONS,
          };
        }
        convo.collected.level = r.value;
        return {
          text: 'How much time can you realistically give this each day?',
          suggestions: timeOptions(course),
        };
      }
      if (convo.collected.minutesPerDay === undefined) {
        const r = validateMinutes(text);
        if (!r.ok) {
          return {
            text: 'How much time can you give this each day? Pick one, or tell me in your own words.',
            suggestions: timeOptions(course),
          };
        }
        convo.collected.minutesPerDay = r.value;
        return {
          text: 'Do you want hands-on projects and practice built in, or a watch-and-learn plan?',
          suggestions: PROJECT_OPTIONS,
        };
      }
      if (convo.collected.includeProjects === undefined) {
        const r = validateYesNo(text);
        if (!r.ok) {
          return {
            text: 'Would you like hands-on projects and practice included, or just the videos?',
            suggestions: PROJECT_OPTIONS,
          };
        }
        convo.collected.includeProjects = r.value;
        return {
          text: 'Last thing — do you have a target finish date in mind?',
          suggestions: deadlineOptions(course, convo.collected.minutesPerDay),
        };
      }
      // Final question: deadline (optional, but the answer must be understandable).
      const r = validateDeadline(text);
      if (!r.ok) {
        return {
          text: "I didn't get that — when would you like to finish? Pick one, or say there's no deadline.",
          suggestions: deadlineOptions(course, convo.collected.minutesPerDay),
        };
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

// ── Question options (suggestions), tailored to the analyzed playlist ───────────
const LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'];
const PROJECT_OPTIONS = ['Yes, include projects', 'No, just the videos'];

type CourseInfo = { totalMinutes: number } | undefined;

function humanizeHours(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.max(1, Math.round(totalMinutes))} minutes`;
  const hours = totalMinutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} hours` : `${Math.round(hours)} hours`;
}

/** Rough, planner-consistent estimate: ~70% of the daily budget is watching. */
function estimateDays(totalMinutes: number, dailyMinutes: number): number {
  const watchPerDay = Math.max(5, dailyMinutes * 0.7);
  return Math.max(1, Math.ceil(totalMinutes / watchPerDay));
}

function humanizeSpan(days: number): string {
  if (days <= 13) return `~${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks <= 10) return `~${weeks} wks`;
  return `~${Math.round(days / 30)} mo`;
}

function labelTime(min: number): string {
  if (min % 60 === 0) return `${min / 60} hr`;
  if (min > 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${min} min`;
}

/** Daily-time options scaled to course length, annotated with how long they'd take. */
function timeOptions(course: CourseInfo): string[] {
  if (!course) return ['30 min', '45 min', '1 hr'];
  const t = course.totalMinutes;
  const mins = t > 1500 ? [45, 90, 120] : t > 600 ? [30, 60, 90] : [20, 40, 60];
  return mins.map((m) => `${labelTime(m)}/day (${humanizeSpan(estimateDays(t, m))})`);
}

/** Deadline options derived from the course length + the user's chosen daily time. */
function deadlineOptions(course: CourseInfo, dailyMinutes?: number): string[] {
  const opts = ['No deadline'];
  if (!course || !dailyMinutes) return opts;
  const natural = estimateDays(course.totalMinutes, dailyMinutes);
  const comfWeeks = Math.max(1, Math.round(natural / 7));
  const pushWeeks = Math.max(1, Math.round((natural * 0.7) / 7));
  opts.push(`In ${comfWeeks} weeks`);
  if (pushWeeks < comfWeeks) opts.push(`In ${pushWeeks} weeks`);
  return opts;
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
