import cors from 'cors';
import express from 'express';

import { config, logStubStatus } from './config/env';
import { initRepository } from './db/repository';
import { requireAuth } from './middleware/auth';
import { agentRouter } from './routes/agent';
import { authRouter } from './routes/auth';
import { plansRouter } from './routes/plans';

const app = express();

app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stub: config.stub });
});

app.use('/api/auth', authRouter);
app.use('/api/agent', requireAuth, agentRouter);
app.use('/api/plans', requireAuth, plansRouter);

async function main() {
  const backend = await initRepository();
  app.listen(config.port, () => {
    logStubStatus();
    // eslint-disable-next-line no-console
    console.log(`[server] storage=${backend} · listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] failed to start:', err);
  process.exit(1);
});
