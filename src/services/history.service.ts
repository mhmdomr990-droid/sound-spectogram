import { Between, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from "typeorm";
import { gzipSync, gunzipSync } from "zlib";
import { AppDataSource } from "../config/data-source";
import { DeviceHistory } from "../entities/DeviceHistory";
import { HttpError } from "../utils/http-error";
import {
  CompressedDeviceMatrixPayload,
  DeviceDataBroadcastPayload,
  IncomingDeviceDataPayload,
  StoredDeviceMatrix
} from "../utils/types";
import {
  isPositiveInteger,
  normalizeNaiveDateTimeString,
  validateDeviceMatrix,
  validateIncomingDevicePayload
} from "../utils/validation";
import { DeviceService } from "./device.service";
import { AuthorizedUser } from "../utils/types";

export class HistoryService {
  private static readonly LEGACY_TIME_SKEW_MS = 3 * 60 * 60 * 1000;
  private readonly historyRepo: Repository<DeviceHistory>;
  private readonly deviceService: DeviceService;

  constructor() {
    this.historyRepo = AppDataSource.getRepository(DeviceHistory);
    this.deviceService = new DeviceService();
  }

  private compressMatrix(matrix: number[][]): StoredDeviceMatrix {
    const rows = matrix.length;
    const cols = rows > 0 && Array.isArray(matrix[0]) ? matrix[0].length : 0;
    const rawJson = JSON.stringify(matrix);
    const compressed = gzipSync(Buffer.from(rawJson, "utf8"));

    return {
      format: "gzip-base64-json-v1",
      rows,
      cols,
      payload: compressed.toString("base64")
    };
  }

  private isCompressedMatrixPayload(value: unknown): value is CompressedDeviceMatrixPayload {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const raw = value as Record<string, unknown>;
    return (
      raw.format === "gzip-base64-json-v1" &&
      typeof raw.rows === "number" &&
      typeof raw.cols === "number" &&
      typeof raw.payload === "string"
    );
  }

  private decodeMatrix(stored: StoredDeviceMatrix): number[][] {
    if (Array.isArray(stored)) {
      return stored as number[][];
    }

    if (!this.isCompressedMatrixPayload(stored)) {
      throw new HttpError(500, "Stored matrix payload format is invalid");
    }

    try {
      const inflated = gunzipSync(Buffer.from(stored.payload, "base64")).toString("utf8");
      const parsed = JSON.parse(inflated);
      const validation = validateDeviceMatrix(parsed);
      if (!validation.valid) {
        throw new Error(validation.message || "decoded matrix is invalid");
      }

      return parsed as number[][];
    } catch (_error) {
      throw new HttpError(500, "Failed to decode stored matrix payload");
    }
  }

  private decodeHistoryItems(items: DeviceHistory[]): DeviceHistory[] {
    return items.map((item) => {
      const resolvedTimestamp = normalizeNaiveDateTimeString(item.timestamp) || String(item.timestamp);
      const resolvedEnd = normalizeNaiveDateTimeString(item.endTime || item.timestamp) || resolvedTimestamp;
      const resolvedStart = normalizeNaiveDateTimeString(item.startTime || resolvedEnd) || resolvedEnd;

      return {
        ...item,
        timestamp: resolvedTimestamp,
        startTime: resolvedStart,
        endTime: resolvedEnd,
        data: this.decodeMatrix(item.data),
        frequencyBins: Array.isArray(item.frequencyBins) ? item.frequencyBins : null
      };
    });
  }

  private normalizeHistoryItemsRaw(items: DeviceHistory[]): DeviceHistory[] {
    return items.map((item) => ({
      ...item,
      timestamp: normalizeNaiveDateTimeString(item.timestamp) || String(item.timestamp),
      startTime: normalizeNaiveDateTimeString(item.startTime || item.timestamp) || String(item.timestamp),
      endTime: normalizeNaiveDateTimeString(item.endTime || item.timestamp) || String(item.timestamp),
      frequencyBins: Array.isArray(item.frequencyBins) ? item.frequencyBins : null
    }));
  }

  private formatLocalNaiveDateTime(value: Date): string {
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    const seconds = String(value.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  private async normalizeIncomingPayload(payload: unknown): Promise<{
    parsed: IncomingDeviceDataPayload;
    parsedTimestamp: string;
    parsedStartTime: string;
    parsedEndTime: string;
    resolvedDeviceId: number;
    resolvedDeviceName: string;
  }> {
    const validation = validateIncomingDevicePayload(payload);
    if (!validation.valid || !validation.parsed || !validation.parsedTimestamp) {
      throw new HttpError(400, validation.message || "Invalid payload");
    }

    const parsed: IncomingDeviceDataPayload = validation.parsed;
    const parsedStartTime = normalizeNaiveDateTimeString(parsed.startTime || parsed.timestamp);
    const parsedEndTime = normalizeNaiveDateTimeString(parsed.endTime || parsed.timestamp);
    if (!parsedStartTime || !parsedEndTime) {
      throw new HttpError(400, "start_time/end_time are invalid");
    }

    if (parsedStartTime > parsedEndTime) {
      throw new HttpError(400, "start_time must be before or equal to end_time");
    }

    const device = await this.deviceService.resolveDeviceIdentifier(parsed.deviceId);

    return {
      parsed,
      parsedTimestamp: validation.parsedTimestamp,
      parsedStartTime,
      parsedEndTime,
      resolvedDeviceId: device.id,
      resolvedDeviceName: device.name
    };
  }

  async buildBroadcastPayload(payload: unknown): Promise<DeviceDataBroadcastPayload> {
    const normalized = await this.normalizeIncomingPayload(payload);

    return {
      deviceId: normalized.resolvedDeviceId,
      deviceName: normalized.resolvedDeviceName,
      sourceDeviceId: normalized.parsed.deviceId,
      timestamp: normalized.parsedTimestamp,
      startTime: normalized.parsedStartTime,
      endTime: normalized.parsedEndTime,
      data: normalized.parsed.data,
      frequencyBins: normalized.parsed.frequencyBins,
      intensityType: normalized.parsed.intensityType,
      aiStatus: normalized.parsed.aiStatus,
      persisted: false
    };
  }

  async saveIncomingDeviceData(payload: unknown): Promise<DeviceDataBroadcastPayload> {
    const normalized = await this.normalizeIncomingPayload(payload);

    const existing = await this.historyRepo.findOne({
      where: {
        deviceId: normalized.resolvedDeviceId,
        startTime: normalized.parsedStartTime,
        endTime: normalized.parsedEndTime
      }
    });

    if (existing) {
      const preservedFrequencyBins = normalized.parsed.frequencyBins ?? existing.frequencyBins ?? null;

      console.info("[HistoryService] Duplicate packet skipped", {
        deviceId: normalized.resolvedDeviceId,
        deviceName: normalized.resolvedDeviceName,
        startTime: normalized.parsedStartTime,
        endTime: normalized.parsedEndTime,
        existingHistoryId: existing.id,
        preservedFrequencyBins: preservedFrequencyBins ? preservedFrequencyBins.length : 0
      });

      return {
        deviceId: existing.deviceId,
        deviceName: normalized.resolvedDeviceName,
        sourceDeviceId: normalized.parsed.deviceId,
        timestamp: normalizeNaiveDateTimeString(existing.timestamp) || existing.timestamp,
        startTime: normalizeNaiveDateTimeString(existing.startTime || normalized.parsedStartTime) || normalized.parsedStartTime,
        endTime: normalizeNaiveDateTimeString(existing.endTime || normalized.parsedEndTime) || normalized.parsedEndTime,
        data: normalized.parsed.data,
        frequencyBins: preservedFrequencyBins ?? undefined,
        intensityType: normalized.parsed.intensityType,
        aiStatus: normalized.parsed.aiStatus ?? ((existing.aiStatus as 0 | 1 | 2 | null) ?? undefined),
        persisted: true
      };
    }

    const entity = this.historyRepo.create({
      deviceId: normalized.resolvedDeviceId,
      timestamp: normalized.parsedTimestamp,
      startTime: normalized.parsedStartTime,
      endTime: normalized.parsedEndTime,
      data: this.compressMatrix(normalized.parsed.data),
      frequencyBins: normalized.parsed.frequencyBins ?? null,
      aiStatus: normalized.parsed.aiStatus ?? null
    });

    const saved = await this.historyRepo.save(entity);

    console.info("[HistoryService] Packet inserted", {
      deviceId: saved.deviceId,
      deviceName: normalized.resolvedDeviceName,
      startTime: normalized.parsedStartTime,
      endTime: normalized.parsedEndTime,
      historyId: saved.id
    });

    return {
      deviceId: saved.deviceId,
      deviceName: normalized.resolvedDeviceName,
      sourceDeviceId: normalized.parsed.deviceId,
      timestamp: normalizeNaiveDateTimeString(saved.timestamp) || saved.timestamp,
      startTime: normalizeNaiveDateTimeString(saved.startTime || normalized.parsedStartTime) || normalized.parsedStartTime,
      endTime: normalizeNaiveDateTimeString(saved.endTime || normalized.parsedEndTime) || normalized.parsedEndTime,
      data: normalized.parsed.data,
      frequencyBins: normalized.parsed.frequencyBins,
      intensityType: normalized.parsed.intensityType,
      aiStatus: normalized.parsed.aiStatus,
      persisted: true
    };
  }

  async getLatest24Hours(deviceId: number, decodeData = false, user?: AuthorizedUser): Promise<DeviceHistory[]> {
    if (!isPositiveInteger(deviceId)) {
      throw new HttpError(400, "device id must be a positive integer");
    }

    await this.deviceService.requireDeviceAccess(user, deviceId);
    await this.deviceService.verifyDeviceExists(deviceId);

    const fromDate = this.formatLocalNaiveDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const items = await this.historyRepo.find({
      where: {
        deviceId,
        timestamp: MoreThanOrEqual(fromDate)
      },
      order: {
        timestamp: "ASC"
      }
    });

    if (decodeData) {
      return this.decodeHistoryItems(items);
    }

    return this.normalizeHistoryItemsRaw(items);
  }

  async getLatestPacket(deviceId: number, decodeData = false, user?: AuthorizedUser): Promise<DeviceHistory | null> {
    if (!isPositiveInteger(deviceId)) {
      throw new HttpError(400, "device id must be a positive integer");
    }

    await this.deviceService.requireDeviceAccess(user, deviceId);
    await this.deviceService.verifyDeviceExists(deviceId);

    const item = await this.historyRepo.findOne({
      where: {
        deviceId
      },
      order: {
        timestamp: "DESC"
      }
    });

    if (!item) {
      return null;
    }

    if (decodeData) {
      return this.decodeHistoryItems([item])[0] || null;
    }

    return this.normalizeHistoryItemsRaw([item])[0] || null;
  }

  async getHistoryByDateRange(
    deviceId: number,
    from: string,
    to: string,
    decodeData = false,
    user?: AuthorizedUser
  ): Promise<DeviceHistory[]> {
    if (!isPositiveInteger(deviceId)) {
      throw new HttpError(400, "device id must be a positive integer");
    }

    const normalizedFrom = normalizeNaiveDateTimeString(from);
    const normalizedTo = normalizeNaiveDateTimeString(to);
    if (!normalizedFrom || !normalizedTo) {
      throw new HttpError(400, "from and to must be valid dates");
    }

    if (normalizedFrom > normalizedTo) {
      throw new HttpError(400, "from must be before to");
    }

    await this.deviceService.requireDeviceAccess(user, deviceId);
    await this.deviceService.verifyDeviceExists(deviceId);

    const items = await this.historyRepo.find({
      where: [
        {
          deviceId,
          startTime: LessThanOrEqual(normalizedTo),
          endTime: MoreThanOrEqual(normalizedFrom)
        },
        {
          deviceId,
          timestamp: Between(normalizedFrom, normalizedTo)
        }
      ],
      order: {
        timestamp: "ASC"
      }
    });

    if (decodeData) {
      return this.decodeHistoryItems(items);
    }

    return this.normalizeHistoryItemsRaw(items);
  }
}
