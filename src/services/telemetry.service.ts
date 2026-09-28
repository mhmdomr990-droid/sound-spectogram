import { Repository } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { DeviceTelemetry } from "../entities/DeviceTelemetry";
import { HttpError } from "../utils/http-error";
import { AuthorizedUser } from "../utils/types";
import { isPositiveInteger, normalizeNaiveDateTimeString } from "../utils/validation";
import { DeviceService } from "./device.service";

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;

export interface TelemetryRecordInput {
  recordedAt?: string | null;
  date?: string | null;
  time?: string | null;
  battery?: number | null;
  temperature?: number | null;
  uptime?: string | null;
  internet?: string | null;
  ping?: number | null;
  interfaceName?: string | null;
}

export interface TelemetrySeriesPoint {
  recordedAt: string;
  battery: number | null;
  temperature: number | null;
  ping: number | null;
  uptime: string | null;
  internet: string | null;
  interfaceName: string | null;
  eventType: string;
}

export interface ConnectivityOutagePeriod {
  startMs: number;
  endMs: number | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
}

export interface ConnectivityOutageReport {
  periods: ConnectivityOutagePeriod[];
  totalDowntimeMinutes: number;
  longestDowntimePeriod: ConnectivityOutagePeriod | null;
}

export class TelemetryService {
  private readonly telemetryRepo: Repository<DeviceTelemetry>;
  private readonly deviceService: DeviceService;
  private readonly writeState = new Map<number, { lastSampleAt: number; lastInternetStatus: string | null }>();

  constructor() {
    this.telemetryRepo = AppDataSource.getRepository(DeviceTelemetry);
    this.deviceService = new DeviceService();
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

  private toNullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeInternet(value: unknown): string | null {
    const raw = this.toNullableString(value);
    if (!raw) {
      return null;
    }

    const normalized = raw.toUpperCase();
    return normalized === "UP" || normalized === "DOWN" ? normalized : raw;
  }

  private resolveRecordedAt(input: TelemetryRecordInput): string {
    const explicit = normalizeNaiveDateTimeString(input.recordedAt || null);
    if (explicit) {
      return explicit;
    }

    const date = this.toNullableString(input.date);
    const time = this.toNullableString(input.time);
    if (date && time) {
      const normalized = normalizeNaiveDateTimeString(`${date}T${time.replace(/-/g, ":")}`);
      if (normalized) {
        return normalized;
      }
    }

    return this.formatNaiveDateTime(new Date());
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

  async recordIfNeeded(deviceId: number, payload: TelemetryRecordInput): Promise<void> {
    if (!isPositiveInteger(deviceId)) {
      throw new HttpError(400, "device id must be a positive integer");
    }

    const recordedAt = this.resolveRecordedAt(payload);
    const recordedAtMs = new Date(recordedAt).getTime();
    const state = this.writeState.get(deviceId) || { lastSampleAt: 0, lastInternetStatus: null };
    const normalizedInternet = this.normalizeInternet(payload.internet);
    const shouldRecordSample = !state.lastSampleAt || (Number.isFinite(recordedAtMs) && recordedAtMs - state.lastSampleAt >= SAMPLE_INTERVAL_MS);
    const shouldRecordConnectionChange =
      normalizedInternet !== null && state.lastInternetStatus !== null && normalizedInternet !== state.lastInternetStatus;

    const baseRow = {
      deviceId,
      recordedAt,
      battery: this.toNullableNumber(payload.battery),
      temperature: this.toNullableNumber(payload.temperature),
      uptime: this.toNullableString(payload.uptime),
      internet: normalizedInternet,
      ping: this.toNullableNumber(payload.ping),
      interfaceName: this.toNullableString(payload.interfaceName)
    } satisfies Omit<DeviceTelemetry, "id" | "device" | "eventType">;

    const rows: Array<Partial<DeviceTelemetry>> = [];
    if (shouldRecordSample) {
      rows.push({ ...baseRow, eventType: "sample" });
    }
    if (shouldRecordConnectionChange) {
      rows.push({ ...baseRow, eventType: "connection_change" });
    }

    for (const row of rows) {
      try {
        await this.telemetryRepo.insert(row);
      } catch (error) {
        console.error("Failed to persist telemetry row", {
          deviceId,
          eventType: row.eventType,
          message: error instanceof Error ? error.message : "unknown error"
        });
      }
    }

    this.writeState.set(deviceId, {
      lastSampleAt: shouldRecordSample && Number.isFinite(recordedAtMs) ? recordedAtMs : state.lastSampleAt,
      lastInternetStatus: normalizedInternet !== null ? normalizedInternet : state.lastInternetStatus
    });
  }

  async getTelemetrySeries(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<TelemetrySeriesPoint[]> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.telemetryRepo.query(
      `SELECT recordedAt, battery, temperature, ping, uptime, internet, interfaceName, eventType FROM device_telemetry
       WHERE deviceId = ? AND recordedAt BETWEEN ? AND ?
       ORDER BY recordedAt ASC`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{
      recordedAt: string;
      battery: string | number | null;
      temperature: string | number | null;
      ping: string | number | null;
      uptime: string | null;
      internet: string | null;
      interfaceName: string | null;
      eventType: string | null;
    }>;

    return rows.map((row) => ({
      recordedAt: normalizeNaiveDateTimeString(row.recordedAt) || String(row.recordedAt),
      battery: this.toNullableNumber(row.battery),
      temperature: this.toNullableNumber(row.temperature),
      ping: this.toNullableNumber(row.ping),
      uptime: this.toNullableString(row.uptime),
      internet: this.normalizeInternet(row.internet),
      interfaceName: this.toNullableString(row.interfaceName),
      eventType: this.toNullableString(row.eventType) || "sample"
    }));
  }

  async getLatestSamplePerDevice(deviceIds: number[], user?: AuthorizedUser): Promise<Record<number, TelemetrySeriesPoint>> {
    const normalizedDeviceIds = Array.from(
      new Set(
        (Array.isArray(deviceIds) ? deviceIds : [])
          .map((deviceId) => Number(deviceId))
          .filter((deviceId) => isPositiveInteger(deviceId))
      )
    );

    if (!normalizedDeviceIds.length) {
      return {};
    }

    const samplesByDeviceId: Record<number, TelemetrySeriesPoint> = {};
    for (const deviceId of normalizedDeviceIds) {
      await this.deviceService.requireDeviceAccess(user, deviceId);

      const rows = await this.telemetryRepo.query(
        `SELECT recordedAt, battery, temperature, ping, uptime, internet, interfaceName, eventType
         FROM device_telemetry
         WHERE deviceId = ?
         ORDER BY recordedAt DESC
         LIMIT 1`,
        [deviceId]
      ) as Array<{
        recordedAt: string;
        battery: string | number | null;
        temperature: string | number | null;
        ping: string | number | null;
        uptime: string | null;
        internet: string | null;
        interfaceName: string | null;
        eventType: string | null;
      }>;

      const latest = rows[0];
      if (!latest) {
        continue;
      }

      samplesByDeviceId[deviceId] = {
        recordedAt: normalizeNaiveDateTimeString(latest.recordedAt) || String(latest.recordedAt),
        battery: this.toNullableNumber(latest.battery),
        temperature: this.toNullableNumber(latest.temperature),
        ping: this.toNullableNumber(latest.ping),
        uptime: this.toNullableString(latest.uptime),
        internet: this.normalizeInternet(latest.internet),
        interfaceName: this.toNullableString(latest.interfaceName),
        eventType: this.toNullableString(latest.eventType) || "sample"
      };
    }

    return samplesByDeviceId;
  }

  async getConnectivityEvents(deviceId: number, from: string, to: string, user?: AuthorizedUser): Promise<ConnectivityOutageReport> {
    const range = await this.resolveValidatedRangeForDevice(deviceId, from, to, user);
    const rows = await this.telemetryRepo.query(
      `SELECT recordedAt, internet FROM device_telemetry
       WHERE deviceId = ? AND recordedAt BETWEEN ? AND ? AND eventType = 'connection_change'
       ORDER BY recordedAt ASC`,
      [deviceId, range.normalizedFrom, range.normalizedTo]
    ) as Array<{ recordedAt: string; internet: string | null }>;

    const periods: ConnectivityOutagePeriod[] = [];
    let openStartTime: string | null = null;
    let openStartMs: number | null = null;

    for (const row of rows) {
      const normalizedTime = normalizeNaiveDateTimeString(row.recordedAt) || String(row.recordedAt);
      const recordedAtMs = new Date(normalizedTime).getTime();
      if (!Number.isFinite(recordedAtMs)) {
        continue;
      }

      const internet = this.normalizeInternet(row.internet);
      if (internet === "DOWN") {
        if (openStartTime === null) {
          openStartTime = normalizedTime;
          openStartMs = recordedAtMs;
        }
        continue;
      }

      if (internet === "UP" && openStartTime !== null && openStartMs !== null) {
        periods.push({
          startMs: openStartMs,
          endMs: recordedAtMs,
          startTime: openStartTime,
          endTime: normalizedTime,
          durationMinutes: Number(((recordedAtMs - openStartMs) / 60000).toFixed(2))
        });
        openStartTime = null;
        openStartMs = null;
      }
    }

    if (openStartTime !== null && openStartMs !== null) {
      periods.push({
        startMs: openStartMs,
        endMs: null,
        startTime: openStartTime,
        endTime: null,
        durationMinutes: Number((Math.max(0, range.toMs - openStartMs) / 60000).toFixed(2))
      });
    }

    const totalDowntimeMinutes = Number(periods.reduce((sum, item) => sum + item.durationMinutes, 0).toFixed(2));
    const longestDowntimePeriod = periods.reduce<ConnectivityOutagePeriod | null>((longest, item) => {
      if (!longest || item.durationMinutes > longest.durationMinutes) {
        return item;
      }
      return longest;
    }, null);

    return {
      periods,
      totalDowntimeMinutes,
      longestDowntimePeriod
    };
  }
}