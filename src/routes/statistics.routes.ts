import { Router } from "express";
import { statisticsController } from "../controllers/statistics.controller";
import { UserRole } from "../entities/User";
import { authMiddleware, requireRole } from "../utils/auth.middleware";

const router = Router();

router.get(
  "/devices/:id/statistics",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  statisticsController.getDeviceStatistics
);

router.get(
  "/statistics/comparison",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  statisticsController.getComparisonStatistics
);

export default router;