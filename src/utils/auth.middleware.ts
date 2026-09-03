import { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { UserRole } from "../entities/User";
import { HttpError } from "./http-error";
import { verifyJwt } from "./jwt";
import { AuthorizedUser } from "./types";

const userRepo = AppDataSource.getRepository(User);

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new HttpError(401, "Authentication required");
    }

    const token = authHeader.slice(7);
    const payload = verifyJwt(token);

    void userRepo
      .findOne({
        where: { id: payload.userId, username: payload.username, role: payload.role },
        relations: { devices: true }
      })
      .then((user) => {
        if (!user) {
          throw new HttpError(401, "Invalid or expired token");
        }

        const authorizedUser: AuthorizedUser = {
          userId: user.id,
          username: user.username,
          role: user.role,
          allowedDeviceIds: user.role === UserRole.EMP ? user.devices.map((device) => device.id) : undefined
        };

        req.user = authorizedUser;
        next();
      })
      .catch(() => {
        next(new HttpError(401, "Invalid or expired token"));
      });
  } catch (_error) {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, "Authentication required"));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new HttpError(403, "You do not have permission to access this resource"));
      return;
    }

    next();
  };
}
