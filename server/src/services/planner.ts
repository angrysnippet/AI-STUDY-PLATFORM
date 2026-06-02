import type { CollectedInputs, CourseVideo, Feasibility, PlanBlock, PlanDay } from '../types';
import { extractPlaylistId, type CourseMeta } from './youtube';

/**
 * Deterministic study-plan builder. Packs the playlist's real videos into days
 * by the daily watch budget, derives the day count from real durations (not a
 * guess), labels days with actual video topics, adds title-aware practice, and
 * schedules project checkpoints. Works with zero API credit; the practice text
 * can later be upgraded by an LLM (see claude.ts) without changing this shape.
 */

// ── Tunable constants ───────────────────────────────────────────────────────────
const GOAL_MULTIPLIER = { quick_revision: 0.55, full_learning: 1.0 } as const;
// Fraction of the daily budget spent watching; the rest is review/practice.
const PRACTICE_OVERHEAD = 0.4; // projects=yes → reserve ~40% for hands-on work
const REVIEW_OVERHEAD = 0.15; // projects=no → reserve ~15% for review
const BUFFER = 1.3; // schedule conservatively (used in the feasibility estimate)
const PROJECT_EVERY = 4; // a project checkpoint after every N study days

export interface BuiltPlan {
  courseTitle: string;
  days: PlanDay[];
  feasibility: Feasibility;
}

export function buildStudyPlan(inputs: CollectedInputs, meta: CourseMeta): BuiltPlan {
  const minutesPerDay = inputs.minutesPerDay && inputs.minutesPerDay > 0 ? inputs.minutesPerDay : 45;
  const includeProjects = inputs.includeProjects ?? true;
  const goalMult = inferGoalMultiplier(inputs.goals);

  const overhead = includeProjects ? PRACTICE_OVERHEAD : REVIEW_OVERHEAD;
  const dailySec = minutesPerDay * 60;
  const watchSecPerDay = dailySec / (1 + overhead); // time available to *watch* per day
  const playlistId = inputs.youtubeUrl ? extractPlaylistId(inputs.youtubeUrl) : null;

  // 1) Pack videos into day-groups by the daily watch budget.
  const groups = packVideos(meta.videos, watchSecPerDay, goalMult);

  // 2) Build days: study days, with a project checkpoint every PROJECT_EVERY days.
  const days: PlanDay[] = [];
  const coveredTitles: string[] = [];
  let studyCount = 0;

  for (const group of groups) {
    days.push(makeStudyDay(days.length + 1, group, minutesPerDay, includeProjects, goalMult, playlistId));
    coveredTitles.push(...group.map((v) => cleanTitle(v.title)));
    studyCount++;

    const isLast = group === groups[groups.length - 1];
    if (includeProjects && (studyCount % PROJECT_EVERY === 0 || isLast)) {
      days.push(makeProjectDay(days.length + 1, coveredTitles.slice()));
    }
  }

  const feasibility = gradeFeasibility(meta, minutesPerDay, overhead, goalMult, inputs.deadlineDays, days.length);
  return { courseTitle: meta.title, days, feasibility };
}

// ── Packing ───────────────────────────────────────────────────────────────────
function packVideos(videos: CourseVideo[], watchSecPerDay: number, goalMult: number): CourseVideo[][] {
  const groups: CourseVideo[][] = [];
  let cur: CourseVideo[] = [];
  let curSec = 0;
  for (const v of videos) {
    const eff = Math.max(v.seconds, 60) * goalMult;
    if (cur.length > 0 && curSec + eff > watchSecPerDay) {
      groups.push(cur);
      cur = [];
      curSec = 0;
    }
    cur.push(v);
    curSec += eff;
  }
  if (cur.length > 0) groups.push(cur);
  return groups.length > 0 ? groups : [[]];
}

// ── Day builders ────────────────────────────────────────────────────────────────
function makeStudyDay(
  day: number,
  group: CourseVideo[],
  minutesPerDay: number,
  includeProjects: boolean,
  goalMult: number,
  playlistId: string | null,
): PlanDay {
  const topics = group.map((v) => cleanTitle(v.title));
  const watchMin = Math.round((group.reduce((s, v) => s + Math.max(v.seconds, 60), 0) * goalMult) / 60);

  const blocks: PlanBlock[] = [
    {
      title: `Watch (~${watchMin} min)`,
      tasks: group.map((v) => ({
        text: `▶ ${cleanTitle(v.title)} (${fmt(v.seconds)})`,
        url: watchUrl(v.videoId, playlistId),
      })),
    },
    {
      title: 'Review (~10 min)',
      tasks: [
        { text: `From memory, write 3–5 bullet points on: ${topics.join('; ')}.` },
        { text: 'Note anything that was unclear and queue it for tomorrow.' },
      ],
    },
  ];

  if (includeProjects) {
    blocks.push({
      title: `Practice (~${Math.max(minutesPerDay - watchMin - 10, 10)} min)`,
      tasks: practiceTasks(topics, day),
    });
  }

  return {
    day,
    kind: 'study',
    title: dayTitle(topics),
    blocks,
  };
}

function makeProjectDay(day: number, coveredTitles: string[]): PlanDay {
  const recent = coveredTitles.slice(-4);
  return {
    day,
    kind: 'project',
    title: `Project checkpoint — apply ${recent[0] ?? 'what you learned'}`,
    blocks: [
      {
        title: 'Build (full session)',
        tasks: [
          {
            text: `Build a small project that combines recent topics: ${recent.join(', ')}.`,
          },
          { text: 'Start from a blank file — no copying from the videos.' },
          { text: 'Write down one thing that broke and how you fixed it.' },
        ],
      },
    ],
  };
}

// ── Practice (title-aware, deterministic) ────────────────────────────────────────
function practiceTasks(topics: string[], day: number): { text: string }[] {
  const primary = topics[0] ?? 'today’s topic';
  const templates = [
    (t: string) => `Without the video, re-implement an example that uses "${t}".`,
    (t: string) => `Explain "${t}" out loud in 60 seconds, as if teaching it.`,
    (t: string) => `Write 2 questions you still have about "${t}" and find the answers.`,
    (t: string) => `Modify a worked example of "${t}" to handle a new case.`,
  ];
  const pick = templates[day % templates.length];
  const tasks = [{ text: pick(primary) }];
  if (topics[1]) tasks.push({ text: `Then do the same for "${topics[1]}".` });
  return tasks;
}

// ── Feasibility ───────────────────────────────────────────────────────────────
function gradeFeasibility(
  meta: CourseMeta,
  minutesPerDay: number,
  overhead: number,
  goalMult: number,
  deadlineDays: number | undefined,
  scheduledDays: number,
): Feasibility {
  void overhead;
  void goalMult;
  const hrs = (meta.totalMinutes / 60).toFixed(1);

  if (deadlineDays && deadlineDays > 0) {
    if (scheduledDays <= deadlineDays) {
      return { grade: 'FEASIBLE', note: `~${scheduledDays} days needed, within your ${deadlineDays}-day target (${hrs}h of video).` };
    }
    if (scheduledDays <= deadlineDays * 1.25) {
      const extra = Math.ceil(((scheduledDays - deadlineDays) * minutesPerDay) / deadlineDays);
      return { grade: 'TIGHT', note: `~${scheduledDays} days vs your ${deadlineDays}-day target. Add ~${extra} min/day, or accept a few extra days.` };
    }
    const phases = Math.ceil(scheduledDays / deadlineDays);
    return { grade: 'TOO_LONG', note: `~${scheduledDays} days needed but only ${deadlineDays} available. Split into ${phases} phases, or raise your daily time.` };
  }

  // No deadline: grade on absolute length.
  if (scheduledDays <= 21) return { grade: 'FEASIBLE', note: `~${scheduledDays} days at ${minutesPerDay} min/day (${hrs}h of video).` };
  if (scheduledDays <= 45) return { grade: 'TIGHT', note: `~${scheduledDays} days at ${minutesPerDay} min/day (${hrs}h). Doable, but a longer haul — consider more time/day.` };
  const phases = Math.ceil(scheduledDays / 30);
  return { grade: 'TOO_LONG', note: `~${scheduledDays} days (${hrs}h). Consider splitting into ${phases} ~month-long phases or raising daily time.` };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function inferGoalMultiplier(goals?: string): number {
  const g = (goals ?? '').toLowerCase();
  if (/\b(revis|refresh|brush up|quick|review|recap)\b/.test(g)) return GOAL_MULTIPLIER.quick_revision;
  return GOAL_MULTIPLIER.full_learning;
}

/**
 * Tidy a raw video title: strip leading numbering ("12. ", "Lesson 3:", "#4 "),
 * and drop SEO keyword tails after the first " | " (common on course videos),
 * keeping the meaningful first segment.
 */
function cleanTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^\s*(?:#?\d+[).:\-]\s*)+/, ''); // leading "12. " / "#4 " / "3) "
  t = t.replace(/^(lesson|part|episode|ep|video|tutorial)\s*\d+\s*[:\-–]\s*/i, '');
  // "Real Title | SEO keyword | another | channel" → "Real Title" (if it's substantial).
  const firstSegment = t.split('|')[0].trim();
  if (firstSegment.length >= 8) t = firstSegment;
  return t.trim() || raw.trim();
}

function dayTitle(topics: string[]): string {
  if (topics.length === 0) return 'Study session';
  if (topics.length === 1) return topics[0];
  return `${topics[0]} (+${topics.length - 1} more)`;
}

/** Direct watch link, opened in playlist context when we know the playlist id. */
function watchUrl(videoId: string, playlistId: string | null): string | undefined {
  if (!videoId) return undefined;
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return playlistId ? `${base}&list=${playlistId}` : base;
}

function fmt(seconds: number): string {
  if (!seconds) return '~?';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}
