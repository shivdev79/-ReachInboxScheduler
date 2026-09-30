import { Router } from 'express';
import { disconnectSlack, handleSlackOAuthCallback, startSlackOAuth } from '../controllers/slack.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/oauth', requireAuth, startSlackOAuth);
router.get('/callback', requireAuth, handleSlackOAuthCallback);
router.post('/disconnect', requireAuth, disconnectSlack);

export default router;
