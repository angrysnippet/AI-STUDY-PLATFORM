import { Router } from 'express';

import { config } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { devLogin, googleLogin } from '../services/auth';

export const authRouter = Router();

// Tells the client which sign-in methods are available right now. The client
// uses this to show/hide the Google button (it's only real once creds exist).
authRouter.get('/config', (_req, res) => {
  res.json({
    devLogin: true,
    google: !config.stub.google,
    googleClientId: config.stub.google ? null : config.googleClientId,
  });
});

// Dev login — zero-key path. Optional { name } creates a distinct local user.
authRouter.post('/dev-login', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
  const { token, user } = await devLogin(name);
  res.json({ token, user: publicUser(user) });
});

// Google login — verifies a GIS ID token. 400s in stub mode (no creds yet).
authRouter.post('/google', async (req, res) => {
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || !credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }
  try {
    const { token, user } = await googleLogin(credential);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Who am I? (used by the client to restore a session from a stored token.)
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

function publicUser(u: { id: string; email: string; name?: string; picture?: string }) {
  return { id: u.id, email: u.email, name: u.name, picture: u.picture };
}
