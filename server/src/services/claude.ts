import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

import { config } from '../config/env';
import type { CollectedInputs, PlanDay, StudyPlan } from '../types';
import { buildStudyPlan } from './planner';
import type { CourseMeta } from './youtube';

/**
 * Generate a StudyPlan. The structure (day count, packing, real video titles,
 * feasibility, project days) is built deterministically from the playlist by
 * `buildStudyPlan` — this is correct and free. When a real Anthropic key with
 * credit is configured, we additionally ask Claude to rewrite each day's
 * practice tasks into topic-specific questions; any failure falls back silently
 * to the deterministic practice text.
 */
export async function generateStudyPlan(
  inputs: CollectedInputs,
  meta: CourseMeta,
  userId: string,
): Promise<StudyPlan> {
  const minutesPerDay = inputs.minutesPerDay && inputs.minutesPerDay > 0 ? inputs.minutesPerDay : 45;
  const level = inputs.level ?? 'beginner';
  const includeProjects = inputs.includeProjects ?? true;

  const built = buildStudyPlan(inputs, meta);
  let days = built.days;

  if (!config.stub.claude) {
    try {
      days = await enrichPractice(days, level, inputs.goals);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[claude] practice enrichment skipped:', (err as Error).message);
    }
  }

  return {
    id: randomUUID(),
    userId,
    courseTitle: built.courseTitle,
    source: {
      youtubeUrl: inputs.youtubeUrl,
      videoCount: meta.videoCount,
      totalMinutes: meta.totalMinutes,
    },
    level,
    minutesPerDay,
    includeProjects,
    estimatedDays: days.length,
    feasibility: built.feasibility,
    days,
    createdAt: new Date().toISOString(),
  };
}

// ── Optional Claude enrichment of practice tasks ─────────────────────────────────

const SYSTEM_PROMPT = `You are an expert learning coach. You are given the day-by-day topics of a study plan (taken from real video titles). For each study day, write 1–3 concrete, topic-specific practice tasks that make the learner *apply* that day's material — never generic filler like "apply one concept". Tasks must reference the actual topics. Return them via the emit_practice tool.`;

const PRACTICE_TOOL: Anthropic.Tool = {
  name: 'emit_practice',
  description: "Return topic-specific practice tasks for each study day.",
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', description: 'The day number this applies to.' },
            tasks: { type: 'array', items: { type: 'string' }, description: '1-3 practice tasks.' },
          },
          required: ['day', 'tasks'],
        },
      },
    },
    required: ['days'],
  },
};

async function enrichPractice(days: PlanDay[], level: string, goals?: string): Promise<PlanDay[]> {
  // Only study days have a Practice block worth rewriting.
  const studyDays = days.filter((d) => d.kind === 'study' && d.blocks.some((b) => b.title.startsWith('Practice')));
  if (studyDays.length === 0) return days;

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const outline = studyDays
    .map((d) => `Day ${d.day}: ${d.title} — covers: ${watchTitles(d).join('; ')}`)
    .join('\n');

  const res = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [PRACTICE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_practice' },
    messages: [
      {
        role: 'user',
        content: `Learner level: ${level}. Goals: ${goals?.trim() || 'general mastery'}.\n\nDays:\n${outline}\n\nCall emit_practice with topic-specific tasks per day.`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return days;
  const data = block.input as { days?: Array<{ day?: number; tasks?: unknown[] }> };
  const byDay = new Map<number, string[]>();
  for (const d of data.days ?? []) {
    if (typeof d.day === 'number' && Array.isArray(d.tasks)) {
      byDay.set(d.day, d.tasks.map((t) => String(t)).slice(0, 3));
    }
  }

  // Merge: replace the Practice block's tasks where Claude returned some.
  return days.map((d) => {
    const tasks = byDay.get(d.day);
    if (!tasks || tasks.length === 0) return d;
    return {
      ...d,
      blocks: d.blocks.map((b) =>
        b.title.startsWith('Practice') ? { ...b, tasks: tasks.map((text) => ({ text })) } : b,
      ),
    };
  });
}

/** The cleaned video titles a day covers (from its Watch block). */
function watchTitles(day: PlanDay): string[] {
  const watch = day.blocks.find((b) => b.title.startsWith('Watch'));
  if (!watch) return [day.title];
  return watch.tasks.map((t) => t.text.replace(/^▶\s*/, '').replace(/\s*\([^)]*\)\s*$/, ''));
}
