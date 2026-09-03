import { NextFunction, Request, Response } from "express";
import { HistoryService } from "../services/history.service";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger, normalizeNaiveDateTimeString } from "../utils/validation";

const historyService = new HistoryService();

export const historyController = {
  getLatestDevicePacket: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId = Number(req.params.id);
      if (!isPositiveInteger(deviceId)) {
        throw new HttpError(400, "device id must be a positive integer");
      }

      const decodeData = String((req.query as { decode?: string }).decode || "") === "1";

      const item = await historyService.getLatestPacket(deviceId, decodeData, req.user);
      if (!item) {
        res.status(404).json({ message: "No packets found for this device" });
        return;
      }

      res.json(item);
    } catch (error) {
      next(error);
    }
  },

  getDeviceHistory: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceId = Number(req.params.id);
      if (!isPositiveInteger(deviceId)) {
        throw new HttpError(400, "device id must be a positive integer");
      }

      const decodeData = String((req.query as { decode?: string }).decode || "") === "1";

      const { from, to } = req.query as { from?: string; to?: string };

      if (from || to) {
        if (!from || !to) {
          throw new HttpError(400, "both from and to are required for range queries");
        }

        const normalizedFrom = normalizeNaiveDateTimeString(from);
        const normalizedTo = normalizeNaiveDateTimeString(to);
        if (!normalizedFrom || !normalizedTo) {
          throw new HttpError(400, "from and to must be valid dates");
        }

        const items = await historyService.getHistoryByDateRange(deviceId, normalizedFrom, normalizedTo, decodeData, req.user);
        console.info("[HistoryController] Range query", {
          deviceId,
          from,
          to,
          count: items.length
        });
        res.json(items);
        return;
      }

      const items = await historyService.getLatest24Hours(deviceId, decodeData, req.user);
      console.info("[HistoryController] Latest24 query", {
        deviceId,
        count: items.length
      });
      res.json(items);
    } catch (error) {
      next(error);
    }
  }
};
