import { Schema, model } from 'mongoose';

/**
 * Mongoose schemas backing the Mongo repository (M2). They mirror the domain
 * types in `types.ts`. Free-form / generated structures (course source, plan
 * days, agent state) are stored as Mixed — we read/write whole objects rather
 * than query into them, so a strict nested schema would only get in the way.
 *
 * Schemas are intentionally untyped (no `Schema<T>` generic): several use a
 * custom string `_id`, which conflicts with Mongoose's default ObjectId typing.
 * Callers get their types back via explicit `.lean<DomainType>()` in the repo.
 */

// ── User ────────────────────────────────────────────────────────────────────
// Populated in M3 (Google OAuth / dev-login). Defined now so the data model is
// complete; plans/progress already carry the userId that points here.
const userSchema = new Schema({
  _id: { type: String, required: true }, // google "sub" or dev-user id
  email: { type: String, required: true, index: true },
  name: String,
  picture: String,
  provider: { type: String, enum: ['dev', 'google'], default: 'dev' },
  createdAt: String,
});
export const UserModel = model('User', userSchema);

// ── Course (cached YouTube metadata) ─────────────────────────────────────────
const courseSchema = new Schema({
  youtubeUrl: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  videoCount: { type: Number, required: true },
  totalMinutes: { type: Number, required: true },
  videos: { type: Schema.Types.Mixed, default: [] },
  cachedAt: { type: String, required: true },
});
export const CourseModel = model('Course', courseSchema);

// ── StudyPlan ────────────────────────────────────────────────────────────────
const planSchema = new Schema({
  _id: { type: String, required: true }, // plan.id (uuid)
  userId: { type: String, required: true, index: true },
  courseTitle: { type: String, required: true },
  source: { type: Schema.Types.Mixed, default: {} },
  level: String,
  minutesPerDay: Number,
  includeProjects: Boolean,
  estimatedDays: Number,
  feasibility: { type: Schema.Types.Mixed, default: null },
  days: { type: Schema.Types.Mixed, default: [] },
  createdAt: String,
});
export const PlanModel = model('StudyPlan', planSchema);

// ── Progress ─────────────────────────────────────────────────────────────────
const progressSchema = new Schema({
  _id: { type: String, required: true }, // `${planId}:${userId}`
  planId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  completedDays: { type: [Number], default: [] },
  updatedAt: String,
});
export const ProgressModel = model('Progress', progressSchema);

// ── Conversation (agent state) ───────────────────────────────────────────────
const conversationSchema = new Schema({
  _id: { type: String, required: true }, // conversation.id (uuid)
  userId: { type: String, required: true, index: true },
  phase: String,
  collected: { type: Schema.Types.Mixed, default: {} },
  history: { type: Schema.Types.Mixed, default: [] },
  planId: String,
});
export const ConversationModel = model('Conversation', conversationSchema);
