import { config } from '../config/env';
import type { Conversation, Course, DoubtThread, Progress, StudyPlan, User } from '../types';

/**
 * Storage interface used by the rest of the app. Two implementations sit behind
 * it: an in-memory one (the default / stub fallback) and a Mongo-backed one
 * (used when MONGODB_URI is real). `repo` is a stable proxy so modules can
 * `import { repo }` once and still pick up whichever backend is chosen at boot.
 */
export interface Repository {
  getUser(id: string): Promise<User | null>;
  saveUser(u: User): Promise<void>;

  saveConversation(c: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;

  savePlan(p: StudyPlan): Promise<void>;
  getPlan(id: string): Promise<StudyPlan | null>;
  listPlans(userId?: string): Promise<StudyPlan[]>;
  deletePlan(id: string): Promise<void>;

  getProgress(planId: string, userId: string): Promise<Progress | null>;
  saveProgress(p: Progress): Promise<void>;

  getDoubtThread(planId: string, userId: string, day: number): Promise<DoubtThread | null>;
  saveDoubtThread(t: DoubtThread): Promise<void>;

  getCourse(youtubeUrl: string): Promise<Course | null>;
  saveCourse(c: Course): Promise<void>;
}

class InMemoryRepository implements Repository {
  private users = new Map<string, User>();
  private conversations = new Map<string, Conversation>();
  private plans = new Map<string, StudyPlan>();
  private progress = new Map<string, Progress>(); // key: `${planId}:${userId}`
  private doubts = new Map<string, DoubtThread>(); // key: `${planId}:${userId}:${day}`
  private courses = new Map<string, Course>(); // key: youtubeUrl

  async getUser(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }
  async saveUser(u: User): Promise<void> {
    this.users.set(u.id, structuredClone(u));
  }

  async saveConversation(c: Conversation): Promise<void> {
    this.conversations.set(c.id, structuredClone(c));
  }
  async getConversation(id: string): Promise<Conversation | null> {
    const c = this.conversations.get(id);
    return c ? structuredClone(c) : null;
  }

  async savePlan(p: StudyPlan): Promise<void> {
    this.plans.set(p.id, structuredClone(p));
  }
  async getPlan(id: string): Promise<StudyPlan | null> {
    const p = this.plans.get(id);
    return p ? structuredClone(p) : null;
  }
  async listPlans(userId?: string): Promise<StudyPlan[]> {
    return [...this.plans.values()]
      .filter((p) => !userId || p.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => structuredClone(p));
  }
  async deletePlan(id: string): Promise<void> {
    this.plans.delete(id);
    for (const key of [...this.progress.keys()]) {
      if (key.startsWith(`${id}:`)) this.progress.delete(key);
    }
  }

  async getProgress(planId: string, userId: string): Promise<Progress | null> {
    const p = this.progress.get(`${planId}:${userId}`);
    return p ? structuredClone(p) : null;
  }
  async saveProgress(p: Progress): Promise<void> {
    this.progress.set(`${p.planId}:${p.userId}`, structuredClone(p));
  }

  async getDoubtThread(planId: string, userId: string, day: number): Promise<DoubtThread | null> {
    const t = this.doubts.get(`${planId}:${userId}:${day}`);
    return t ? structuredClone(t) : null;
  }
  async saveDoubtThread(t: DoubtThread): Promise<void> {
    this.doubts.set(`${t.planId}:${t.userId}:${t.day}`, structuredClone(t));
  }

  async getCourse(youtubeUrl: string): Promise<Course | null> {
    const c = this.courses.get(youtubeUrl);
    return c ? structuredClone(c) : null;
  }
  async saveCourse(c: Course): Promise<void> {
    this.courses.set(c.youtubeUrl, structuredClone(c));
  }
}

/**
 * Stable facade: forwards every call to whichever backend is active. The active
 * backend can be swapped once at startup (see `initRepository`) without breaking
 * the `import { repo }` references scattered across the app.
 */
class RepositoryProxy implements Repository {
  private backend: Repository = new InMemoryRepository();
  use(b: Repository): void {
    this.backend = b;
  }
  getUser = (id: string) => this.backend.getUser(id);
  saveUser = (u: User) => this.backend.saveUser(u);
  saveConversation = (c: Conversation) => this.backend.saveConversation(c);
  getConversation = (id: string) => this.backend.getConversation(id);
  savePlan = (p: StudyPlan) => this.backend.savePlan(p);
  getPlan = (id: string) => this.backend.getPlan(id);
  listPlans = (userId?: string) => this.backend.listPlans(userId);
  deletePlan = (id: string) => this.backend.deletePlan(id);
  getProgress = (planId: string, userId: string) => this.backend.getProgress(planId, userId);
  saveProgress = (p: Progress) => this.backend.saveProgress(p);
  getDoubtThread = (planId: string, userId: string, day: number) =>
    this.backend.getDoubtThread(planId, userId, day);
  saveDoubtThread = (t: DoubtThread) => this.backend.saveDoubtThread(t);
  getCourse = (youtubeUrl: string) => this.backend.getCourse(youtubeUrl);
  saveCourse = (c: Course) => this.backend.saveCourse(c);
}

export const repo = new RepositoryProxy();

/**
 * Choose and connect the backend at startup. In-memory unless MONGODB_URI is a
 * real value; if a Mongo connection fails we log and fall back to in-memory so
 * the app still runs (matching the stub-everywhere philosophy).
 */
export async function initRepository(): Promise<'mongo' | 'memory'> {
  if (config.stub.db) return 'memory';
  try {
    const { MongoRepository } = await import('./mongoRepository');
    const mongo = new MongoRepository();
    await mongo.connect();
    repo.use(mongo);
    return 'mongo';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] Mongo connection failed, using in-memory store:', err);
    return 'memory';
  }
}
