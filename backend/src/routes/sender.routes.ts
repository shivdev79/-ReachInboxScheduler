import { Router } from 'express';
import { getSenders } from '../controllers/sender.controller';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);
router.get('/', getSenders);

export default router;
