import { NextFunction, Request, Response } from "express";
import { DeviceService } from "../services/device.service";
import { TelemetryService } from "../services/telemetry.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger } from "../utils/validation";

const deviceService = new DeviceService();
const telemetryService = new TelemetryService();

function splitRecordedAt(value: string): { date: string; time: string } | null {
  const matched = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/);
  if (!matched) {
    return null;
  }

  return {
    date: matched[1],
    time: matched[2]
  };
}

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

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "externalDeviceId must be a string when provided");
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalLocationCoordinate(value: unknown, fieldName: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${fieldName} must be a finite number or null`);
  }

  return parsed;
}

export const deviceController = {
  createDevice: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, description } = req.body as {
        name?: string;
        externalDeviceId?: unknown;
        description?: string;
        minFrequency?: unknown;
        maxFrequency?: unknown;
      };
      const externalDeviceId = parseOptionalString((req.body as { externalDeviceId?: unknown }).externalDeviceId);
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

      const device = await deviceService.createDevice({ name, externalDeviceId, description, minFrequency, maxFrequency });
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

  getDevicesWithStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const devices = await deviceService.getDevicesWithLatestStatus(req.user);
      const latestSamplesByDeviceId = await telemetryService.getLatestSamplePerDevice(
        devices.map((device) => Number(device.id)),
        req.user
      );

      const devicesWithMergedStatus = devices.map((device) => {
        const latestSample = latestSamplesByDeviceId[Number(device.id)];
        if (!latestSample) {
          return device;
        }

        const recordedAtParts = splitRecordedAt(latestSample.recordedAt);

        // These fields mirror the live status payload so the frontend can consume DB snapshot + socket data uniformly.
        return {
          ...device,
          device_id: device.externalDeviceId || device.name || String(device.id),
          battery: latestSample.battery,
          temperature: latestSample.temperature,
          uptime: latestSample.uptime,
          internet: latestSample.internet,
          ping: latestSample.ping,
          interface: latestSample.interfaceName,
          recordedAt: latestSample.recordedAt,
          date: recordedAtParts ? recordedAtParts.date : null,
          time: recordedAtParts ? recordedAtParts.time : null
        };
      });

      res.json(devicesWithMergedStatus);
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
        externalDeviceId?: unknown;
        description?: string | null;
        minFrequency?: unknown;
        maxFrequency?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
      const externalDeviceId = parseOptionalString((req.body as { externalDeviceId?: unknown }).externalDeviceId);
      const minFrequency = parseOptionalFrequency((req.body as { minFrequency?: unknown }).minFrequency, "minFrequency");
      const maxFrequency = parseOptionalFrequency((req.body as { maxFrequency?: unknown }).maxFrequency, "maxFrequency");
      const latitude = parseOptionalLocationCoordinate((req.body as { latitude?: unknown }).latitude, "latitude");
      const longitude = parseOptionalLocationCoordinate((req.body as { longitude?: unknown }).longitude, "longitude");

      if (
        minFrequency !== undefined &&
        maxFrequency !== undefined &&
        minFrequency !== null &&
        maxFrequency !== null &&
        maxFrequency <= minFrequency
      ) {
        throw new HttpError(400, "maxFrequency must be greater than minFrequency");
      }

      const updated = await deviceService.updateDevice(id, {
        name,
        externalDeviceId,
        description,
        minFrequency,
        maxFrequency,
        latitude,
        longitude
      });
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
