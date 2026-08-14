import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { requireAiEnabledMiddleware } from '../utils/aiEnabled.js';
import { helpAssistantLimiter } from '../middleware/rateLimiters.js';
import { parseBody, helpAssistantChatBodySchema } from '../utils/requestValidation.js';
import { runHelpAssistantChat } from '../utils/helpAssistantService.js';

const router = express.Router();
const requireAi = requireAiEnabledMiddleware(getRequestDatabase);

router.use(authenticateToken, requireAi);

router.post('/chat', helpAssistantLimiter, async (req, res) => {
  const parsed = parseBody(helpAssistantChatBodySchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const db = getRequestDatabase(req);
    const isAdmin = Array.isArray(req.user?.roles)
      ? req.user.roles.includes('admin')
      : req.user?.role === 'admin';

    const result = await runHelpAssistantChat({
      db,
      isAdmin: Boolean(isAdmin),
      language: parsed.data.language,
      messages: parsed.data.messages
    });

    if (!result.ok) {
      return res.status(result.status || 502).json({ error: result.error });
    }

    return res.json({
      answer: result.answer,
      targetId: result.targetId,
      target: result.target
    });
  } catch (err) {
    console.error('Help assistant chat failed:', err?.message || err);
    return res.status(500).json({ error: 'Help assistant request failed' });
  }
});

export default router;
