import { Router } from 'express';
import {
  redirectToGoogleConsent,
  handleGoogleCallback,
  getCurrentUserSession,
  handleLogoutSession,
  loginWithEmail,
  registerWithEmail,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/google', redirectToGoogleConsent);
router.get('/google/callback', handleGoogleCallback);
router.post('/email/login', loginWithEmail);
router.post('/email/register', registerWithEmail);
router.get('/me', requireAuth, getCurrentUserSession);
router.post('/logout', handleLogoutSession);

export default router;
