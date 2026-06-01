import { Router } from 'express';

import { handleMessage, startConversation } from '../services/agent';
import { repo } from '../db/repository';

export const agentRouter = Router();

// Start a fresh conversation (returns the greeting + a conversationId).
agentRouter.post('/start', async (_req, res) => {
  const reply = await startConversation();
  res.json(reply);
});

// Send a user message; advances the agent and may return a generated plan.
agentRouter.post('/message', async (req, res) => {
  const { conversationId, text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  try {
    const reply = await handleMessage(String(conversationId ?? ''), text);
    res.json(reply);
  } catch (err) {
    console.error('[agent] error:', err);
    res.status(500).json({ error: 'Failed to process message. Check the server logs.' });
  }
});

// Fetch a generated plan by id.
agentRouter.get('/plan/:id', async (req, res) => {
  const plan = await repo.getPlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  res.json(plan);
});
