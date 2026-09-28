import { Router } from "express";
import { historyController } from "../controllers/history.controller";
import { UserRole } from "../entities/User";
import { authMiddleware, requireRole } from "../utils/auth.middleware";

const router = Router();

router.get(
  "/devices/:id/history/latest",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  historyController.getLatestDevicePacket
);

router.get(
  "/devices/:id/history/latest-batch",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  historyController.getLatestPacketsBatch
);

router.get(
  "/devices/:id/history",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  historyController.getDeviceHistory
);

export default router;
