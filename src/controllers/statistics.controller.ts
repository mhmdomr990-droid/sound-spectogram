import { NextFunction, Request, Response } from "express";
import { DeviceStatisticsService } from "../services/statistics.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger, normalizeNaiveDateTimeString } from "../utils/validation";

const statisticsService = new DeviceStatisticsService();

function resolveStatisticsRange(query: { from?: string; to?: string }): { from: string; to: string } {
  if (!query.from && !query.to) {
    return statisticsService.getDefaultRange();
  }

  if (!query.from || !query.to) {
    throw new HttpError(400, "both from and to are required for range queries");
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

export const statisticsController = {
  getDeviceStatistics: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId = Number(req.params.id);
      if (!isPositiveInteger(deviceId)) {
        throw new HttpError(400, "device id must be a positive integer");
      }

      const range = resolveStatisticsRange(req.query as { from?: string; to?: string });
      const report = await statisticsService.getFullDeviceReport(deviceId, range.from, range.to, req.user);
      res.json(report);
    } catch (error) {
      next(error);
    }
  },

  getComparisonStatistics: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const range = resolveStatisticsRange(req.query as { from?: string; to?: string });
      const comparison = await statisticsService.getCrossDeviceComparison(range.from, range.to, req.user);
      res.json(comparison);
    } catch (error) {
      next(error);
    }
  }
};