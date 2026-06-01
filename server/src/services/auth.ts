import { randomUUID } from 'crypto';

import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

import { config } from '../config/env';
import { repo } from '../db/repository';
import { DEV_USER_ID } from '../types';
import type { AuthUser, User } from '../types';

const TOKEN_TTL = '30d';

/** Mint an app JWT for a user. */
export function signToken(user: User): string {
  const payload: AuthUser = { id: user.id, email: user.email, name: user.name };
  return jwt.sign(payload, config.jwtSecret, { subject: user.id, expiresIn: TOKEN_TTL });
}

/** Verify an app JWT and return the identity, or null if invalid/expired. */
export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as Partial<AuthUser> & { sub?: string };
    const id = decoded.id ?? decoded.sub;
    if (!id || !decoded.email) return null;
    return { id, email: decoded.email, name: decoded.name };
  } catch {
    return null;
  }
}

/**
 * Dev login — the zero-key path. Always available; mints a token for a local
 * user. Defaults to the shared DEV_USER_ID so plans created in M2 (owned by
 * "dev-user") stay visible. A custom name creates a distinct local user so you
 * can test multi-user behaviour without Google.
 */
export async function devLogin(name?: string): Promise<{ token: string; user: User }> {
  const trimmed = name?.trim();
  const id = trimmed ? `dev:${slug(trimmed)}` : DEV_USER_ID;
  const user: User = (await repo.getUser(id)) ?? {
    id,
    email: trimmed ? `${slug(trimmed)}@dev.local` : 'dev@dev.local',
    name: trimmed || 'Dev User',
    provider: 'dev',
    createdAt: new Date().toISOString(),
  };
  await repo.saveUser(user);
  return { token: signToken(user), user };
}

/**
 * Google login — verifies a Google Identity Services ID token and upserts the
 * user. Only usable once real Google credentials are configured; otherwise the
 * route should steer the client to dev login.
 */
export async function googleLogin(credential: string): Promise<{ token: string; user: User }> {
  if (config.stub.google) {
    throw new Error('Google sign-in is not configured — use dev login.');
  }
  const client = new OAuth2Client(config.googleClientId);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error('Invalid Google token');

  const id = `google:${p.sub}`;
  const existing = await repo.getUser(id);
  const user: User = {
    id,
    email: p.email,
    name: p.name ?? existing?.name,
    picture: p.picture ?? existing?.picture,
    provider: 'google',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await repo.saveUser(user);
  return { token: signToken(user), user };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || randomUUID().slice(0, 8);
}
