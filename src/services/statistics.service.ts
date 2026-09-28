import { Repository } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { DeviceHistory } from "../entities/DeviceHistory";
import { AuthorizedUser } from "../utils/types";
import { HttpError } from "../utils/http-error";
import { isPositiveInteger, normalizeNaiveDateTimeString } from "../utils/validation";
import { DeviceService } from "./device.service";
import { HistoryService } from "./history.service";

export const PACKET_INTERVAL_MINUTES = 5;

const STATUS_META: Array<Pick<StatusDistributionItem, "key" | "aiStatus" | "label" | "color">> = [
  { key: "possible", aiStatus: 0 as 0, label: "هدف محتمل", color: "#f59e0b" },
  { key: "detected", aiStatus: 1 as 1, label: "هدف مكتشف", color: "#d13438" },
  { key: "notDetected", aiStatus: 2 as 2, label: "لا يوجد هدف", color: "#21a366" },
  { key: "unknown", aiStatus: null, label: "غير محدد", color: "#000000" }
];

type StatusKey = "possible" | "detected" | "notDetected" | "unknown";

export interface StatusDistributionItem {
  key: StatusKey;
  aiStatus: 0 | 1 | 2 | null;
  label: string;
  color: string;
  count: number;
  avgConfidence: number | null;
}

export interface TimelineSummaryItem {
  id: number;
  timestamp: string;
  startTime: string | null;
  endTime: string | null;
  aiStatus: number | null;
  confidence: number | null;
}

export interface DowntimePeriod {
  startMs: number;
  endMs: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface CrossDeviceComparisonItem {
  deviceId: number;
  deviceName: string;
  counts: {
    possible: number;
    detected: number;
    notDetected: number;
    unknown: number;
  };
  totalCount: number;
}

export class DeviceStatisticsService {
  private readonly historyRepo: Repository<DeviceHistory>;
  private readonly deviceService: DeviceService;
  private readonly historyService: HistoryService;

  constructor() {
    this.historyRepo = AppDataSource.getRepository(DeviceHistory);
    this.deviceService = new DeviceService();
    this.historyService = new HistoryService();
  }

  private formatNaiveDateTime(value: Date): string {
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    const seconds = String(value.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  private buildStatusDistributionDefaults(): StatusDistributionItem[] {
    return STATUS_META.map((item) => ({
      ...item,
      count: 0,
      avgConfidence: null
    }));
  }

  private async resolveValidatedRangeForDevice(
    deviceId: number,
    from: string,
    to: string,
    user?: AuthorizedUser
  ): Promise<{ normalizedFrom: string; normalizedTo: string; fromMs: number; toMs: number }> {
    if (!isPositiveInteger(deviceId)) {
      throw new HttpError(400, "device id must be a positive integer");
    }

    const normalizedFrom = normalizeNaiveDateTimeString(from);
    const normalizedTo = normalizeNaiveDateTimeString(to);
    if (!normalizedFrom || !normalizedTo) {
      throw new HttpError(400, "from and to must be valid dates");
    }

    const fromMs = new Date(normalizedFrom).getTime();
    const toMs = new Date(normalizedTo).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new HttpError(400, "from must be before or equal to to");
    }

    await this.deviceService.requireDeviceAccess(user, deviceId);
    await this.deviceService.verifyDeviceExists(deviceId);

    return { normalizedFrom, normalizedTo, fromMs, toMs };
  }

  private resolveStatusKey(aiStatus: unknown): StatusKey {
    const normalized = aiStatus === null || aiStatus === undefined ? null : Number(aiStatus);
    if (normalized === 0) {
      return "possible";
    }
    if (normalized === 1) {
      return "detected";
    }
    if (normalized === 2) {
      return "notDetected";
    }
    return "unknown";
  }

  private resolveLast24HoursRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return {
      from: this.formatNaiveDateTime(from),
      to: this.formatNaiveDateTime(to)
    };
  }

  getDefaultRange(): { from: string; to: string } {
    return this.resolveLast24HoursRange();
  }

  async getStatusDistribution(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<{
    totalCount: number;
    items: StatusDistributionItem[];
  }> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.historyRepo.query(
      `SELECT aiStatus, COUNT(*) AS count, AVG(confidence) AS avgConfidence
       FROM device_histories
       WHERE deviceId = ? AND timestamp BETWEEN ? AND ?
       GROUP BY aiStatus`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{ aiStatus: number | null; count: string | number; avgConfidence: string | number | null }>;

    const items = this.buildStatusDistributionDefaults();
    let totalCount = 0;
    rows.forEach((row) => {
      const key = this.resolveStatusKey(row.aiStatus);
      const target = items.find((item) => item.key === key);
      if (!target) {
        return;
      }

      const count = Number(row.count);
      const avgConfidence = Number(row.avgConfidence);
      target.count = Number.isFinite(count) ? count : 0;
      target.avgConfidence = Number.isFinite(avgConfidence) ? Number(avgConfidence.toFixed(2)) : null;
      totalCount += target.count;
    });

    return { totalCount, items };
  }

  async getReceivedVsExpected(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<{
    receivedCount: number;
    expectedCount: number;
    missingCount: number;
    packetIntervalMinutes: number;
  }> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.historyRepo.query(
      `SELECT COUNT(*) AS receivedCount
       FROM device_histories
       WHERE deviceId = ? AND timestamp BETWEEN ? AND ?`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{ receivedCount: string | number }>;

    const receivedCount = Number(rows[0] && rows[0].receivedCount) || 0;
    const expectedCount = Math.ceil((range.toMs - range.fromMs) / (PACKET_INTERVAL_MINUTES * 60000));
    return {
      receivedCount,
      expectedCount,
      missingCount: Math.max(0, expectedCount - receivedCount),
      packetIntervalMinutes: PACKET_INTERVAL_MINUTES
    };
  }

  async getDowntimePeriods(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<{
    packetIntervalMinutes: number;
    downtimeThresholdMinutes: number;
    periods: DowntimePeriod[];
    totalDowntimeMinutes: number;
    longestDowntimePeriod: DowntimePeriod | null;
  }> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.historyRepo.query(
      `SELECT timestamp
       FROM device_histories
       WHERE deviceId = ? AND timestamp BETWEEN ? AND ?
       ORDER BY timestamp ASC`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{ timestamp: string }>;

    const thresholdMs = PACKET_INTERVAL_MINUTES * 1.5 * 60000;
    const periods: DowntimePeriod[] = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previousMs = new Date(rows[index - 1].timestamp).getTime();
      const currentMs = new Date(rows[index].timestamp).getTime();
      if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs)) {
        continue;
      }

      const deltaMs = currentMs - previousMs;
      if (deltaMs <= thresholdMs) {
        continue;
      }

      periods.push({
        startMs: previousMs,
        endMs: currentMs,
        startTime: this.formatNaiveDateTime(new Date(previousMs)),
        endTime: this.formatNaiveDateTime(new Date(currentMs)),
        durationMinutes: Number((deltaMs / 60000).toFixed(2))
      });
    }

    const totalDowntimeMinutes = Number(
      periods.reduce((sum, item) => sum + item.durationMinutes, 0).toFixed(2)
    );
    const longestDowntimePeriod =
      periods.reduce<DowntimePeriod | null>((longest, item) => {
        if (!longest || item.durationMinutes > longest.durationMinutes) {
          return item;
        }
        return longest;
      }, null) || null;

    return {
      packetIntervalMinutes: PACKET_INTERVAL_MINUTES,
      downtimeThresholdMinutes: Number((thresholdMs / 60000).toFixed(2)),
      periods,
      totalDowntimeMinutes,
      longestDowntimePeriod
    };
  }

  async getTimelineSummary(
    deviceId: number,
    from: string,
    to: string,
    user?: AuthorizedUser
  ): Promise<TimelineSummaryItem[]> {
    const items = await this.historyService.getHistorySummaryByDateRange(deviceId, from, to, user);
    return items.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      startTime: item.startTime,
      endTime: item.endTime,
      aiStatus: item.aiStatus,
      confidence: item.confidence
    }));
  }

  async getHourlyDetectionDistribution(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<{
    totalDetectedCount: number;
    items: Array<{ hourOfDay: number; count: number }>;
  }> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.historyRepo.query(
      `SELECT HOUR(timestamp) AS hourOfDay, COUNT(*) AS count
       FROM device_histories
       WHERE deviceId = ? AND timestamp BETWEEN ? AND ? AND aiStatus = 1
       GROUP BY HOUR(timestamp)`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{ hourOfDay: string | number; count: string | number }>;

    const items = Array.from({ length: 24 }, (_, hourOfDay) => ({ hourOfDay, count: 0 }));
    let totalDetectedCount = 0;
    rows.forEach((row) => {
      const hourOfDay = Number(row.hourOfDay);
      const count = Number(row.count);
      if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
        return;
      }
      items[hourOfDay].count = Number.isFinite(count) ? count : 0;
      totalDetectedCount += items[hourOfDay].count;
    });

    return { totalDetectedCount, items };
  }

  async getCrossDeviceComparison(from: string, to: string, user?: AuthorizedUser): Promise<{
    from: string;
    to: string;
    items: CrossDeviceComparisonItem[];
  }> {
    const normalizedFrom = normalizeNaiveDateTimeString(from);
    const normalizedTo = normalizeNaiveDateTimeString(to);
    if (!normalizedFrom || !normalizedTo) {
      throw new HttpError(400, "from and to must be valid dates");
    }

    if (new Date(normalizedFrom).getTime() > new Date(normalizedTo).getTime()) {
      throw new HttpError(400, "from must be before or equal to to");
    }

    const devices = await this.deviceService.getDevicesForUser(user);
    if (!devices.length) {
      return { from: normalizedFrom, to: normalizedTo, items: [] };
    }

    const deviceIds = devices.map((device) => device.id);
    const placeholders = deviceIds.map(() => "?").join(", ");
    const rows = await this.historyRepo.query(
      `SELECT deviceId, aiStatus, COUNT(*) AS count
       FROM device_histories
       WHERE deviceId IN (${placeholders}) AND timestamp BETWEEN ? AND ?
       GROUP BY deviceId, aiStatus`,
      [...deviceIds, normalizedFrom, normalizedTo]
    ) as Array<{ deviceId: string | number; aiStatus: number | null; count: string | number }>;

    const items = devices.map((device) => ({
      deviceId: device.id,
      deviceName: device.name,
      counts: {
        possible: 0,
        detected: 0,
        notDetected: 0,
        unknown: 0
      } as Record<StatusKey, number>,
      totalCount: 0
    }));

    const byDeviceId = new Map<number, CrossDeviceComparisonItem>(items.map((item) => [item.deviceId, item]));
    rows.forEach((row) => {
      const deviceId = Number(row.deviceId);
      const target = byDeviceId.get(deviceId);
      if (!target) {
        return;
      }

      const key = this.resolveStatusKey(row.aiStatus);
      const count = Number(row.count);
      const safeCount = Number.isFinite(count) ? count : 0;
      target.counts[key] = safeCount;
      target.totalCount += safeCount;
    });

    return {
      from: normalizedFrom,
      to: normalizedTo,
      items
    };
  }

  async getFullDeviceReport(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<{
    deviceId: number;
    from: string;
    to: string;
    packetIntervalMinutes: number;
    statusDistribution: Awaited<ReturnType<DeviceStatisticsService["getStatusDistribution"]>>;
    receivedVsExpected: Awaited<ReturnType<DeviceStatisticsService["getReceivedVsExpected"]>>;
    downtime: Awaited<ReturnType<DeviceStatisticsService["getDowntimePeriods"]>>;
    timelineSummary: Awaited<ReturnType<DeviceStatisticsService["getTimelineSummary"]>>;
    hourlyDetectionDistribution: Awaited<ReturnType<DeviceStatisticsService["getHourlyDetectionDistribution"]>>;
  }> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const [statusDistribution, receivedVsExpected, downtime, timelineSummary, hourlyDetectionDistribution] = await Promise.all([
      this.getStatusDistribution(deviceId, range.normalizedFrom, range.normalizedTo, user),
      this.getReceivedVsExpected(deviceId, range.normalizedFrom, range.normalizedTo, user),
      this.getDowntimePeriods(deviceId, range.normalizedFrom, range.normalizedTo, user),
      this.getTimelineSummary(deviceId, range.normalizedFrom, range.normalizedTo, user),
      this.getHourlyDetectionDistribution(deviceId, range.normalizedFrom, range.normalizedTo, user)
    ]);

    return {
      deviceId,
      from: range.normalizedFrom,
      to: range.normalizedTo,
      packetIntervalMinutes: PACKET_INTERVAL_MINUTES,
      statusDistribution,
      receivedVsExpected,
      downtime,
      timelineSummary,
      hourlyDetectionDistribution
    };
  }
}