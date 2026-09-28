import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { UserRole } from "../entities/User";
import { authMiddleware, requireRole } from "../utils/auth.middleware";

const router = Router();

router.post("/auth/login", userController.login);

router.get("/users", authMiddleware, requireRole(UserRole.ADMIN), userController.getUsers);
router.post("/users", authMiddleware, requireRole(UserRole.ADMIN), userController.createUser);
router.get("/users/pending-devices", authMiddleware, requireRole(UserRole.ADMIN), userController.getPendingDevices);
router.get("/users/device-change-requests", authMiddleware, requireRole(UserRole.ADMIN), userController.getDeviceChangeRequests);
router.get("/users/:id", authMiddleware, requireRole(UserRole.ADMIN), userController.getUserById);
router.put("/users/:id", authMiddleware, requireRole(UserRole.ADMIN), userController.updateUser);
router.delete("/users/:id", authMiddleware, requireRole(UserRole.ADMIN), userController.deleteUser);
router.post("/users/:id/approve-device", authMiddleware, requireRole(UserRole.ADMIN), userController.approveDevice);
router.post("/users/:id/reset-device", authMiddleware, requireRole(UserRole.ADMIN), userController.resetDevice);
router.post("/users/:id/approve-device-change", authMiddleware, requireRole(UserRole.ADMIN), userController.approveDeviceChange);
router.post("/users/:id/reject-device-change", authMiddleware, requireRole(UserRole.ADMIN), userController.rejectDeviceChange);

export default router;
