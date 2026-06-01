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
const isProduction = val('NODE_ENV') === 'production';
const jwtSecret = val('JWT_SECRET', 'dev-insecure-secret');

export const config = {
  port: Number(val('PORT', '4000')),
  clientUrl: val('CLIENT_URL', 'http://localhost:5173'),
  jwtSecret,
  devLoginEnabled: val('DEV_LOGIN_ENABLED', isProduction ? 'false' : 'true') === 'true',

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
    // Our sign-in flow verifies a Google ID token, which needs only the client
    // id. The secret is kept for potential future server-side OAuth flows.
    google: !isReal(googleClientId),
    youtube: !isReal(youtubeApiKey),
  },
};

/** Fail fast instead of serving publicly with the local-only JWT signing key. */
export function assertProductionConfig(): void {
  if (isProduction && (jwtSecret === 'dev-insecure-secret' || !isReal(jwtSecret))) {
    throw new Error('JWT_SECRET must be set to a private random value in production');
  }
}

export function logStubStatus(): void {
  const s = config.stub;
  const mode = (on: boolean) => (on ? 'STUB' : 'real');
  // eslint-disable-next-line no-console
  console.log(
    `[config] claude=${mode(s.claude)} db=${mode(s.db)} google=${mode(s.google)} youtube=${mode(s.youtube)}`,
  );
}
