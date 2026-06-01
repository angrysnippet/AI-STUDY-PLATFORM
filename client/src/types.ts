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
  userId?: string;
  courseTitle: string;
  source: { youtubeUrl?: string; videoCount?: number; totalMinutes?: number };
  level: string;
  minutesPerDay: number;
  includeProjects: boolean;
  estimatedDays: number;
  days: PlanDay[];
  createdAt: string;
}

/** Lightweight plan entry returned by the list endpoint. */
export interface PlanSummary {
  id: string;
  courseTitle: string;
  level: string;
  minutesPerDay: number;
  estimatedDays: number;
  createdAt: string;
}

/** Per-plan completion state (which day numbers are done). */
export interface Progress {
  planId: string;
  userId: string;
  completedDays: number[];
  updatedAt: string;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}
export interface AgentReply {
  conversationId: string;
  reply: string;
  phase: string;
  plan?: StudyPlan;
}
