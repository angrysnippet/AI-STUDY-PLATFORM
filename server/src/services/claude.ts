import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

import { config } from '../config/env';
import type { CollectedInputs, PlanDay, StudyPlan } from '../types';
import type { CourseMeta } from './youtube';

// Stable system prompt — kept byte-identical so prompt caching can reuse it.
const SYSTEM_PROMPT = `You are an expert learning coach. Given a course (usually a YouTube playlist) plus a learner's level, daily time budget, and goals, you design a realistic day-by-day study plan.

Principles:
- Pace the plan to the learner's available minutes per day; don't cram.
- Each day has a short, descriptive title and 2-4 blocks; each block has a few concrete, actionable tasks.
- Map work to the source material (e.g. which videos to watch) and add review.
- If hands-on practice is requested, include small exercises/projects that apply the day's concepts.
- Be specific and motivating, not generic.

Always return the plan by calling the emit_study_plan tool — never as prose.`;

/** Generate a StudyPlan from collected inputs + course metadata, owned by `userId`. */
export async function generateStudyPlan(
  inputs: CollectedInputs,
  meta: CourseMeta,
  userId: string,
): Promise<StudyPlan> {
  const minutesPerDay = inputs.minutesPerDay && inputs.minutesPerDay > 0 ? inputs.minutesPerDay : 45;
  const level = inputs.level ?? 'beginner';
  const includeProjects = inputs.includeProjects ?? true;
  const estimatedDays = Math.max(1, Math.ceil(meta.totalMinutes / minutesPerDay));

  const { courseTitle, days } = config.stub.claude
    ? stubPlan(meta, minutesPerDay, includeProjects, estimatedDays)
    : await claudePlan(inputs, meta, minutesPerDay, level, includeProjects, estimatedDays);

  return {
    id: randomUUID(),
    userId,
    courseTitle,
    source: { youtubeUrl: inputs.youtubeUrl, videoCount: meta.videoCount, totalMinutes: meta.totalMinutes },
    level,
    minutesPerDay,
    includeProjects,
    estimatedDays: days.length,
    days,
    createdAt: new Date().toISOString(),
  };
}

// JSON schema for the structured plan the model must emit.
const PLAN_TOOL: Anthropic.Tool = {
  name: 'emit_study_plan',
  description: 'Return the structured day-by-day study plan.',
  input_schema: {
    type: 'object',
    properties: {
      courseTitle: { type: 'string', description: 'A clean title for the course.' },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', description: '1-based day number.' },
            title: { type: 'string', description: 'Short title for the day.' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  tasks: { type: 'array', items: { type: 'string' } },
                },
                required: ['title', 'tasks'],
              },
            },
          },
          required: ['day', 'title', 'blocks'],
        },
      },
    },
    required: ['courseTitle', 'days'],
  },
};

async function claudePlan(
  inputs: CollectedInputs,
  meta: CourseMeta,
  minutesPerDay: number,
  level: string,
  includeProjects: boolean,
  estimatedDays: number,
): Promise<{ courseTitle: string; days: PlanDay[] }> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const userMessage = [
    `Course: "${meta.title}"`,
    `YouTube: ${inputs.youtubeUrl ?? 'n/a'}`,
    `Size: ~${meta.videoCount} videos, ~${meta.totalMinutes} minutes total.`,
    `Learner level: ${level}`,
    `Time available: ${minutesPerDay} minutes/day`,
    `Include hands-on projects/practice: ${includeProjects ? 'yes' : 'no'}`,
    `Goals: ${inputs.goals?.trim() || 'general mastery of the material'}`,
    '',
    `Design a day-by-day plan of about ${estimatedDays} day(s). Call emit_study_plan with the result.`,
  ].join('\n');

  // Forced tool use → reliable structured output. (No thinking: forced
  // tool_choice + thinking is rejected; structured emission doesn't need it.)
  const res = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'emit_study_plan' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('Claude did not return a study plan');
  }
  const data = block.input as { courseTitle?: string; days?: unknown[] };
  const days = normalizeDays(data.days);
  if (days.length === 0) throw new Error('Claude returned an empty plan');
  return { courseTitle: data.courseTitle?.trim() || meta.title, days };
}

/** Defensively coerce the model's tool input into PlanDay[]. */
function normalizeDays(raw: unknown[] | undefined): PlanDay[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d, i) => {
    const day = d as { day?: number; title?: string; blocks?: unknown[] };
    return {
      day: typeof day.day === 'number' ? day.day : i + 1,
      title: String(day.title ?? `Day ${i + 1}`),
      blocks: Array.isArray(day.blocks)
        ? day.blocks.map((b) => {
            const block = b as { title?: string; tasks?: unknown[] };
            return {
              title: String(block.title ?? 'Block'),
              tasks: Array.isArray(block.tasks)
                ? block.tasks.map((t) => ({ text: String(t) }))
                : [],
            };
          })
        : [],
    };
  });
}

/** Deterministic offline plan used when no real API key is configured. */
function stubPlan(
  meta: CourseMeta,
  minutesPerDay: number,
  includeProjects: boolean,
  estimatedDays: number,
): { courseTitle: string; days: PlanDay[] } {
  const totalDays = Math.min(Math.max(estimatedDays, 1), 30);
  const perDay = Math.max(1, Math.round(meta.videoCount / totalDays));
  const days: PlanDay[] = [];

  for (let i = 0; i < totalDays; i++) {
    const startV = i * perDay + 1;
    const endV = Math.min((i + 1) * perDay, meta.videoCount);
    const blocks = [
      {
        title: `Watch (~${Math.max(minutesPerDay - 20, 15)} min)`,
        tasks: [
          { text: `Watch videos ${startV}–${endV} of "${meta.title}".` },
          { text: 'Pause to take notes on each key idea — don’t just play it through.' },
        ],
      },
      {
        title: 'Review (~10 min)',
        tasks: [{ text: 'Summarize today’s videos in 3–5 bullet points from memory.' }],
      },
    ];
    if (includeProjects) {
      blocks.push({
        title: 'Practice (~15 min)',
        tasks: [{ text: 'Apply one concept from today in a small exercise or code snippet.' }],
      });
    }
    days.push({ day: i + 1, title: `Day ${i + 1} — Videos ${startV}–${endV}`, blocks });
  }

  return { courseTitle: meta.title, days };
}
