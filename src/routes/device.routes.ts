import { Router } from "express";
import { deviceController } from "../controllers/device.controller";
import { UserRole } from "../entities/User";
import { authMiddleware, requireRole } from "../utils/auth.middleware";

const router = Router();

router.get("/devices", authMiddleware, requireRole(UserRole.ADMIN, UserRole.EMP), deviceController.getDevices);
router.get("/devices/with-status", authMiddleware, requireRole(UserRole.ADMIN, UserRole.EMP), deviceController.getDevicesWithStatus);
router.post("/devices", authMiddleware, requireRole(UserRole.ADMIN), deviceController.createDevice);
router.get("/devices/:id", authMiddleware, requireRole(UserRole.ADMIN, UserRole.EMP), deviceController.getDeviceById);
router.put("/devices/:id", authMiddleware, requireRole(UserRole.ADMIN), deviceController.updateDevice);
router.delete("/devices/:id", authMiddleware, requireRole(UserRole.ADMIN), deviceController.deleteDevice);

export default router;
