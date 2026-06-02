import Anthropic from '@anthropic-ai/sdk';

import { config } from '../config/env';
import type { DoubtMessage } from '../types';

export interface DoubtContext {
  courseTitle: string;
  dayTitle: string;
  topics: string[];
  level: string;
}

/**
 * Answer a learner's doubt about a specific topic. Uses Claude as a tutor when a
 * real key with credit is configured; otherwise returns structured study-coach
 * guidance so the feature still works (and is honest that it's not a full answer).
 */
export async function answerDoubt(
  ctx: DoubtContext,
  question: string,
  history: DoubtMessage[],
): Promise<string> {
  if (config.stub.claude) return stubAnswer(ctx);
  try {
    return await claudeAnswer(ctx, question, history);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[doubt] Claude unavailable, using stub:', (err as Error).message);
    return stubAnswer(ctx);
  }
}

const SYSTEM = `You are a patient, expert tutor embedded in a study app. The learner is working through a specific topic of a video course and has a question. Answer clearly and concisely (a few short paragraphs or a tight list), with a small concrete example when it helps. Match their stated level. Stay on the current topic; if they drift, gently bring them back. Don't invent video timestamps.`;

async function claudeAnswer(
  ctx: DoubtContext,
  question: string,
  history: DoubtMessage[],
): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const context =
    `Course: ${ctx.courseTitle}\n` +
    `Current topic (day): ${ctx.dayTitle}\n` +
    `Videos in today's topic: ${ctx.topics.join('; ') || ctx.dayTitle}\n` +
    `Learner level: ${ctx.level}`;

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: 'user' as const, content: question },
  ];

  const res = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1200,
    system: [{ type: 'text', text: `${SYSTEM}\n\n${context}`, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || stubAnswer(ctx);
}

function stubAnswer(ctx: DoubtContext): string {
  const topic = ctx.dayTitle;
  const course = ctx.courseTitle.split('|')[0].trim();
  return [
    `Good question about **${topic}**. Here's how to work through it:`,
    '',
    `1. Re-watch the relevant clip — focus on "${ctx.topics[0] ?? topic}".`,
    `2. Write the confusing bit as one specific sentence ("why does X…?").`,
    `3. Try a tiny example by hand, then check it against the video.`,
    `4. Still stuck? Search the exact term plus "${course}" for another explanation.`,
    '',
    `_Full AI tutor answers turn on once an Anthropic API key with credit is set on the server. For now this is study-coach guidance rather than a direct answer._`,
  ].join('\n');
}
