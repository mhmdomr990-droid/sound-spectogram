import { NextFunction, Request, Response } from "express";
import { UserRole } from "../entities/User";
import { UserService } from "../services/user.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger } from "../utils/validation";

const userService = new UserService();

function parseRole(value: unknown): UserRole {
  if (value === UserRole.ADMIN || value === UserRole.EMP) {
    return value;
  }
  throw new HttpError(400, "role must be admin or emp");
}

function parseDeviceIds(value: unknown): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "deviceIds must be an array of positive integers");
  }

  const parsed = value.map((item) => Number(item));
  if (parsed.some((item) => !isPositiveInteger(item))) {
    throw new HttpError(400, "deviceIds must be an array of positive integers");
  }

  return Array.from(new Set(parsed));
}

export const userController = {
  login: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { username, password } = req.body as {
        username?: string;
        password?: string;
      };

      if (!username || !password) {
        throw new HttpError(400, "username and password are required");
      }

      const result = await userService.authenticateUser(username, password);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  createUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, username, password, role } = req.body as {
        name?: string;
        username?: string;
        password?: string;
        role?: UserRole;
        deviceIds?: unknown;
      };

      if (!name || !username || !password || !role) {
        throw new HttpError(400, "name, username, password and role are required");
      }

      const user = await userService.createUser({
        name,
        username,
        password,
        role: parseRole(role),
        deviceIds: parseDeviceIds((req.body as { deviceIds?: unknown }).deviceIds)
      });

      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  },

  getUsers: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await userService.getUsers();
      res.json(users);
    } catch (error) {
      next(error);
    }
  },

  getUserById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      const user = await userService.getUserById(id);
      res.json(user);
    } catch (error) {
      next(error);
    }
  },

  updateUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      const body = req.body as {
        name?: string;
        username?: string;
        password?: string;
        role?: UserRole;
        deviceIds?: unknown;
      };

      const parsedDeviceIds = parseDeviceIds(body.deviceIds);

      if (body.role !== undefined) {
        parseRole(body.role);
      }

      const updated = await userService.updateUser(id, {
        name: body.name,
        username: body.username,
        password: body.password,
        role: body.role,
        deviceIds: parsedDeviceIds
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },

  deleteUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      await userService.deleteUser(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
};
