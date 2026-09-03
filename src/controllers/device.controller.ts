import { NextFunction, Request, Response } from "express";
import { DeviceService } from "../services/device.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger } from "../utils/validation";

const deviceService = new DeviceService();

function parseOptionalFrequency(value: unknown, fieldName: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative number`);
  }

  return parsed;
}

export const deviceController = {
  createDevice: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, description } = req.body as {
        name?: string;
        description?: string;
        minFrequency?: unknown;
        maxFrequency?: unknown;
      };
      const minFrequency = parseOptionalFrequency((req.body as { minFrequency?: unknown }).minFrequency, "minFrequency");
      const maxFrequency = parseOptionalFrequency((req.body as { maxFrequency?: unknown }).maxFrequency, "maxFrequency");

      if (!name) {
        throw new HttpError(400, "name is required");
      }

      if (
        minFrequency !== undefined &&
        maxFrequency !== undefined &&
        minFrequency !== null &&
        maxFrequency !== null &&
        maxFrequency <= minFrequency
      ) {
        throw new HttpError(400, "maxFrequency must be greater than minFrequency");
      }

      const device = await deviceService.createDevice({ name, description, minFrequency, maxFrequency });
      res.status(201).json(device);
    } catch (error) {
      next(error);
    }
  },

  getDevices: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const devices = await deviceService.getDevicesForUser(req.user);
      res.json(devices);
    } catch (error) {
      next(error);
    }
  },

  getDeviceById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      const device = await deviceService.requireDeviceAccess(req.user, id);
      res.json(device);
    } catch (error) {
      next(error);
    }
  },

  updateDevice: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      const { name, description } = req.body as {
        name?: string;
        description?: string | null;
        minFrequency?: unknown;
        maxFrequency?: unknown;
      };
      const minFrequency = parseOptionalFrequency((req.body as { minFrequency?: unknown }).minFrequency, "minFrequency");
      const maxFrequency = parseOptionalFrequency((req.body as { maxFrequency?: unknown }).maxFrequency, "maxFrequency");

      if (
        minFrequency !== undefined &&
        maxFrequency !== undefined &&
        minFrequency !== null &&
        maxFrequency !== null &&
        maxFrequency <= minFrequency
      ) {
        throw new HttpError(400, "maxFrequency must be greater than minFrequency");
      }

      const updated = await deviceService.updateDevice(id, { name, description, minFrequency, maxFrequency });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },

  deleteDevice: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!isPositiveInteger(id)) {
        throw new HttpError(400, "id must be a positive integer");
      }

      await deviceService.deleteDevice(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
};
