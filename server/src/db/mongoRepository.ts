import mongoose from 'mongoose';

import { config } from '../config/env';
import { ConversationModel, CourseModel, PlanModel, ProgressModel, UserModel } from '../models';
import type { Conversation, Course, Progress, StudyPlan, User } from '../types';
import type { Repository } from './repository';

/** Mongo/Mongoose-backed repository, used when MONGODB_URI is a real value. */
export class MongoRepository implements Repository {
  async connect(): Promise<void> {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongodbUri);
  }

  // ── Users ────────────────────────────────────────────────────────────────────
  async getUser(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id).lean<User & { _id: string }>().exec();
    if (!doc) return null;
    const { _id, ...rest } = doc as unknown as Record<string, unknown>;
    void _id;
    return { id, ...(rest as Omit<User, 'id'>) };
  }
  async saveUser(u: User): Promise<void> {
    const { id, ...rest } = u;
    await UserModel.replaceOne({ _id: id }, { _id: id, ...rest }, { upsert: true });
  }

  // ── Conversations ──────────────────────────────────────────────────────────
  async saveConversation(c: Conversation): Promise<void> {
    await ConversationModel.replaceOne({ _id: c.id }, { _id: c.id, ...c }, { upsert: true });
  }
  async getConversation(id: string): Promise<Conversation | null> {
    const doc = await ConversationModel.findById(id).lean<Conversation>().exec();
    return doc ? strip(doc) : null;
  }

  // ── Plans ────────────────────────────────────────────────────────────────────
  async savePlan(p: StudyPlan): Promise<void> {
    await PlanModel.replaceOne({ _id: p.id }, { _id: p.id, ...p }, { upsert: true });
  }
  async getPlan(id: string): Promise<StudyPlan | null> {
    const doc = await PlanModel.findById(id).lean<StudyPlan>().exec();
    return doc ? strip(doc) : null;
  }
  async listPlans(userId?: string): Promise<StudyPlan[]> {
    const filter = userId ? { userId } : {};
    const docs = await PlanModel.find(filter).sort({ createdAt: -1 }).lean<StudyPlan[]>().exec();
    return docs.map(strip);
  }
  async deletePlan(id: string): Promise<void> {
    await PlanModel.deleteOne({ _id: id }).exec();
    await ProgressModel.deleteMany({ planId: id }).exec();
  }

  // ── Progress ─────────────────────────────────────────────────────────────────
  async getProgress(planId: string, userId: string): Promise<Progress | null> {
    const doc = await ProgressModel.findById(progressId(planId, userId))
      .lean<Progress>()
      .exec();
    return doc ? strip(doc) : null;
  }
  async saveProgress(p: Progress): Promise<void> {
    await ProgressModel.replaceOne(
      { _id: progressId(p.planId, p.userId) },
      { _id: progressId(p.planId, p.userId), ...p },
      { upsert: true },
    );
  }

  // ── Course cache ─────────────────────────────────────────────────────────────
  async getCourse(youtubeUrl: string): Promise<Course | null> {
    const doc = await CourseModel.findOne({ youtubeUrl }).lean<Course>().exec();
    return doc ? strip(doc) : null;
  }
  async saveCourse(c: Course): Promise<void> {
    await CourseModel.replaceOne({ youtubeUrl: c.youtubeUrl }, c, { upsert: true });
  }
}

function progressId(planId: string, userId: string): string {
  return `${planId}:${userId}`;
}

/** Drop Mongo bookkeeping fields (`_id`, `__v`) so callers see clean domain objects. */
function strip<T>(doc: T & { _id?: unknown; __v?: unknown }): T {
  const { _id, __v, ...rest } = doc as Record<string, unknown>;
  void _id;
  void __v;
  return rest as T;
}
