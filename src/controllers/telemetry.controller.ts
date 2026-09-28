import { NextFunction, Request, Response } from "express";
import { TelemetryService } from "../services/telemetry.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger, normalizeNaiveDateTimeString } from "../utils/validation";

const telemetryService = new TelemetryService();

function resolveTelemetryRange(query: { from?: string; to?: string }): { from: string; to: string } {
  if (!query.from || !query.to) {
    throw new HttpError(400, "both from and to are required for telemetry queries");
  }

  const from = normalizeNaiveDateTimeString(query.from);
  const to = normalizeNaiveDateTimeString(query.to);
  if (!from || !to) {
    throw new HttpError(400, "from and to must be valid dates");
  }

  if (new Date(from).getTime() > new Date(to).getTime()) {
    throw new HttpError(400, "from must be before or equal to to");
  }

  return { from, to };
}

export const telemetryController = {
  getTelemetrySeries: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId = Number(req.params.id);
      if (!isPositiveInteger(deviceId)) {
        throw new HttpError(400, "device id must be a positive integer");
      }

      const range = resolveTelemetryRange(req.query as { from?: string; to?: string });
      const series = await telemetryService.getTelemetrySeries(deviceId, range.from, range.to, req.user);
      res.json(series);
    } catch (error) {
      next(error);
    }
  },

  getConnectivityEvents: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId = Number(req.params.id);
      if (!isPositiveInteger(deviceId)) {
        throw new HttpError(400, "device id must be a positive integer");
      }

      const range = resolveTelemetryRange(req.query as { from?: string; to?: string });
      const report = await telemetryService.getConnectivityEvents(deviceId, range.from, range.to, req.user);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }
};