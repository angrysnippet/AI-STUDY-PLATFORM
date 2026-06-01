import { Router } from 'express';

import { repo } from '../db/repository';
import { userId } from '../middleware/auth';
import { handleMessage, startConversation } from '../services/agent';

// Mounted behind requireAuth — req.user is always present.
export const agentRouter = Router();

// Start a fresh conversation (returns the greeting + a conversationId).
agentRouter.post('/start', async (req, res) => {
  const reply = await startConversation(userId(req));
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
    const reply = await handleMessage(String(conversationId ?? ''), text, userId(req));
    res.json(reply);
  } catch (err) {
    console.error('[agent] error:', err);
    res.status(500).json({ error: 'Failed to process message. Check the server logs.' });
  }
});

// Fetch a generated plan by id (must belong to the current user).
agentRouter.get('/plan/:id', async (req, res) => {
  const plan = await repo.getPlan(req.params.id);
  if (!plan || plan.userId !== userId(req)) {
    res.status(404).json({ error: 'plan not found' });
    return;
  }
  res.json(plan);
});
