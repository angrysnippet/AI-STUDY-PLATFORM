import cors from 'cors';
import express from 'express';

import { assertProductionConfig, config, logStubStatus } from './config/env';
import { initRepository } from './db/repository';
import { requireAuth } from './middleware/auth';
import { agentRouter } from './routes/agent';
import { authRouter } from './routes/auth';
import { plansRouter } from './routes/plans';

const app = express();
assertProductionConfig();
const repositoryReady = initRepository();

// Allow the configured client, any *.vercel.app alias (preview/prod), and localhost.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin, curl, server-to-server
      try {
        const host = new URL(origin).hostname;
        if (
          origin === config.clientUrl ||
          host === 'localhost' ||
          host.endsWith('.vercel.app')
        ) {
          return cb(null, true);
        }
      } catch {
        /* fall through to deny */
      }
      return cb(null, false);
    },
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(async (_req, _res, next) => {
  await repositoryReady;
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stub: config.stub });
});

app.use('/api/auth', authRouter);
app.use('/api/agent', requireAuth, agentRouter);
app.use('/api/plans', requireAuth, plansRouter);

async function main() {
  const backend = await repositoryReady;
  app.listen(config.port, () => {
    logStubStatus();
    // eslint-disable-next-line no-console
    console.log(`[server] storage=${backend} · listening on http://localhost:${config.port}`);
  });
}

if (!process.env.VERCEL) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

export default app;
