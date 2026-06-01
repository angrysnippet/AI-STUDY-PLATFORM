// Shared domain types for the AI Study Platform.

export type AgentPhase = 'intake' | 'questions' | 'generate' | 'done';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface CollectedInputs {
  youtubeUrl?: string;
  goals?: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  minutesPerDay?: number;
  includeProjects?: boolean;
}

export interface PlanTask {
  text: string;
  done?: boolean;
}

export interface PlanBlock {
  title: string;
  tasks: PlanTask[];
}

export interface PlanDay {
  day: number;
  title: string;
  blocks: PlanBlock[];
}

export interface StudyPlan {
  id: string;
  userId: string;
  courseTitle: string;
  source: { youtubeUrl?: string; videoCount?: number; totalMinutes?: number };
  level: string;
  minutesPerDay: number;
  includeProjects: boolean;
  estimatedDays: number;
  days: PlanDay[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  phase: AgentPhase;
  collected: CollectedInputs;
  history: ChatMessage[];
  planId?: string;
}

/** Per-user, per-plan completion tracking (which day numbers are done). */
export interface Progress {
  planId: string;
  userId: string;
  completedDays: number[];
  updatedAt: string;
}

/** Cached YouTube course metadata, keyed by playlist/video URL. */
export interface Course {
  youtubeUrl: string;
  title: string;
  videoCount: number;
  totalMinutes: number;
  cachedAt: string;
}

/** Placeholder user until M3 wires real auth; every M2 record is scoped to this. */
export const DEV_USER_ID = 'dev-user';
