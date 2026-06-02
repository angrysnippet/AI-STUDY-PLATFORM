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
  /** Optional target: finish within this many days (parsed from a date or "N weeks"). */
  deadlineDays?: number;
}

/** A single video in the source playlist (real title + real duration). */
export interface CourseVideo {
  position: number;
  title: string;
  seconds: number;
}

export type FeasibilityGrade = 'FEASIBLE' | 'TIGHT' | 'TOO_LONG';

export interface Feasibility {
  grade: FeasibilityGrade;
  note: string;
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
  /** 'study' = watch/review/practice; 'project' = a project checkpoint day. */
  kind: 'study' | 'project';
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
  feasibility: Feasibility;
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

/** Cached YouTube course metadata (incl. per-video list), keyed by playlist URL. */
export interface Course {
  youtubeUrl: string;
  title: string;
  videoCount: number;
  totalMinutes: number;
  videos: CourseVideo[];
  cachedAt: string;
}

/** An application user (dev-login or Google). `id` scopes plans/progress/conversations. */
export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  provider: 'dev' | 'google';
  createdAt: string;
}

/** Identity attached to a request after JWT verification. */
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

/** Fallback dev user (used by the dev-login stub when Google isn't configured). */
export const DEV_USER_ID = 'dev-user';
