import dotenv from 'dotenv';

dotenv.config();

function val(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

/** A value counts as "real" only if set and not an obvious placeholder. */
function isReal(v: string): boolean {
  if (!v) return false;
  const lower = v.toLowerCase();
  return !['your_', 'placeholder', 'changeme', 'xxxx'].some((p) => lower.includes(p));
}

const anthropicApiKey = val('ANTHROPIC_API_KEY');
const mongodbUri = val('MONGODB_URI');
const googleClientId = val('GOOGLE_CLIENT_ID');
const googleClientSecret = val('GOOGLE_CLIENT_SECRET');
const youtubeApiKey = val('YOUTUBE_API_KEY');

export const config = {
  port: Number(val('PORT', '4000')),
  clientUrl: val('CLIENT_URL', 'http://localhost:5173'),
  jwtSecret: val('JWT_SECRET', 'dev-insecure-secret'),

  anthropicApiKey,
  anthropicModel: val('ANTHROPIC_MODEL', 'claude-opus-4-8'),
  mongodbUri,
  googleClientId,
  googleClientSecret,
  youtubeApiKey,

  /** When true, that integration runs as a local stub (no real key needed). */
  stub: {
    claude: !isReal(anthropicApiKey),
    db: !isReal(mongodbUri),
    google: !(isReal(googleClientId) && isReal(googleClientSecret)),
    youtube: !isReal(youtubeApiKey),
  },
};

export function logStubStatus(): void {
  const s = config.stub;
  const mode = (on: boolean) => (on ? 'STUB' : 'real');
  // eslint-disable-next-line no-console
  console.log(
    `[config] claude=${mode(s.claude)} db=${mode(s.db)} google=${mode(s.google)} youtube=${mode(s.youtube)}`,
  );
}
