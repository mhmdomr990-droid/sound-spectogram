import { Router } from "express";
import { telemetryController } from "../controllers/telemetry.controller";
import { UserRole } from "../entities/User";
import { authMiddleware, requireRole } from "../utils/auth.middleware";

const router = Router();

router.get(
  "/devices/:id/telemetry/series",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  telemetryController.getTelemetrySeries
);

router.get(
  "/devices/:id/telemetry/connectivity",
  authMiddleware,
  requireRole(UserRole.ADMIN, UserRole.EMP),
  telemetryController.getConnectivityEvents
);

export default router;