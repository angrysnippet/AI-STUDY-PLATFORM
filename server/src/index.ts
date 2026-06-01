import cors from 'cors';
import express from 'express';

import { config, logStubStatus } from './config/env';
import { initRepository } from './db/repository';
import { agentRouter } from './routes/agent';
import { plansRouter } from './routes/plans';

const app = express();

app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stub: config.stub });
});

app.use('/api/agent', agentRouter);
app.use('/api/plans', plansRouter);

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
