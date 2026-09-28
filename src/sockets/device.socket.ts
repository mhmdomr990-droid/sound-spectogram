import { Server, Socket } from "socket.io";
import { AppDataSource } from "../config/data-source";
import { User, UserRole } from "../entities/User";
import { DeviceService } from "../services/device.service";
import { HistoryService } from "../services/history.service";
import { TelemetryRecordInput, TelemetryService } from "../services/telemetry.service";
import { HttpError } from "../utils/http-error";
import { verifyJwt } from "../utils/jwt";
import { AuthorizedUser, CheckAiStatusRequestPayload, DeviceDataBroadcastPayload } from "../utils/types";

const historyService = new HistoryService();
const deviceService = new DeviceService();
const telemetryService = new TelemetryService();
const userRepo = AppDataSource.getRepository(User);

interface SocketAck {
  ok: boolean;
  message?: string;
  data?: unknown;
  failedCount?: number;
}

interface TelemetryStatusEntry {
  deviceIdentifier: number | string;
  telemetry: TelemetryRecordInput;
}

interface DeviceSocketData {
  user?: User;
  userLookup?: Promise<User | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildTelemetryStatusEntry(raw: Record<string, unknown>, fallbackIdentifier?: string): TelemetryStatusEntry | null {
  const deviceIdentifierRaw =
    raw.device_id ?? raw.deviceId ?? raw.id ?? raw.name ?? raw.deviceName ?? raw.key ?? fallbackIdentifier;

  let deviceIdentifier: number | string | null = null;
  if (typeof deviceIdentifierRaw === "number" && Number.isFinite(deviceIdentifierRaw)) {
    deviceIdentifier = deviceIdentifierRaw;
  } else if (typeof deviceIdentifierRaw === "string" && deviceIdentifierRaw.trim()) {
    deviceIdentifier = deviceIdentifierRaw.trim();
  }

  if (deviceIdentifier === null) {
    return null;
  }

  return {
    deviceIdentifier,
    telemetry: {
      recordedAt: toOptionalString(raw.recordedAt ?? raw.timestamp),
      date: toOptionalString(raw.date),
      time: toOptionalString(raw.time),
      battery: toOptionalFiniteNumber(raw.battery),
      temperature: toOptionalFiniteNumber(raw.temperature),
      uptime: toOptionalString(raw.uptime),
      internet: toOptionalString(raw.internet),
      ping: toOptionalFiniteNumber(raw.ping),
      interfaceName: toOptionalString(raw.interfaceName ?? raw.interface)
    }
  };
}

function extractTelemetryStatusEntries(payload: unknown): TelemetryStatusEntry[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (isRecord(payload) && Array.isArray(payload.devices)) {
    return payload.devices
      .map((item) => (isRecord(item) ? buildTelemetryStatusEntry(item) : null))
      .filter((item): item is TelemetryStatusEntry => !!item);
  }

  if (isRecord(payload) && Array.isArray(payload.entries)) {
    return payload.entries
      .map((item) => (isRecord(item) ? buildTelemetryStatusEntry(item) : null))
      .filter((item): item is TelemetryStatusEntry => !!item);
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => (isRecord(item) ? buildTelemetryStatusEntry(item) : null))
      .filter((item): item is TelemetryStatusEntry => !!item);
  }

  if (isRecord(payload)) {
    const singleEntry = buildTelemetryStatusEntry(payload);
    if (singleEntry && ("device_id" in payload || "deviceId" in payload)) {
      return [singleEntry];
    }

    return Object.keys(payload)
      .map((key) => {
        const item = payload[key];
        return isRecord(item) ? buildTelemetryStatusEntry(item, key) : null;
      })
      .filter((item): item is TelemetryStatusEntry => !!item);
  }

  return [];
}

function extractAiStatusRange(payload: unknown): { startTime: string; endTime: string } {
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError(400, "payload must be an object");
  }

  const raw = payload as CheckAiStatusRequestPayload;
  const startTime = String(raw.startTime ?? raw.start_time ?? raw.from ?? "").trim();
  const endTime = String(raw.endTime ?? raw.end_time ?? raw.to ?? "").trim();

  if (!startTime || !endTime) {
    throw new HttpError(400, "payload must include startTime and endTime");
  }

  return { startTime, endTime };
}

function toAuthorizedUser(user: User): AuthorizedUser {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    allowedDeviceIds: Array.isArray(user.devices)
      ? user.devices
          .map((device) => Number(device.id))
          .filter((deviceId) => Number.isInteger(deviceId) && deviceId > 0)
      : []
  };
}

function parseRequestedDeviceIds(payload: unknown): number[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.deviceIds)) {
    return undefined;
  }

  return Array.from(
    new Set(
      payload.deviceIds
        .map((deviceId) => Number(deviceId))
        .filter((deviceId) => Number.isInteger(deviceId) && deviceId > 0)
    )
  );
}

function isMisroutedTelemetryPayload(raw: Record<string, unknown>): boolean {
  const hasDeviceIdentifier = raw.device_id !== undefined || raw.deviceId !== undefined;
  const hasStartTime = raw.start_time !== undefined || raw.startTime !== undefined;
  const hasEndTime = raw.end_time !== undefined || raw.endTime !== undefined;

  return hasDeviceIdentifier && !hasStartTime && !hasEndTime;
}

async function routeMisroutedTelemetryPayload(payload: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isRecord(payload)) {
    return { ok: false, message: "misrouted telemetry payload must be an object" };
  }

  const entry = buildTelemetryStatusEntry(payload);
  if (!entry) {
    return { ok: false, message: "misrouted telemetry payload is missing a valid device identifier" };
  }

  try {
    const device = await deviceService.resolveDeviceIdentifier(entry.deviceIdentifier);
    await telemetryService.recordIfNeeded(device.id, entry.telemetry);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to record misrouted telemetry payload"
    };
  }
}

async function handleIncomingDeviceData(
  io: Server,
  payload: unknown,
  ack?: (response: SocketAck) => void
): Promise<void> {
  const result = await processSingleDevicePacket(io, payload);

  if (typeof ack === "function") {
    if (result.ok) {
      ack({ ok: true, data: result.data });
    } else {
      ack({ ok: false, message: result.message });
    }
  }
}

async function processSingleDevicePacket(
  io: Server,
  payload: unknown
): Promise<{ ok: true; data: DeviceDataBroadcastPayload } | { ok: false; message: string }> {
  try {
    const savedPayload = await historyService.saveIncomingDeviceData(payload);
    io.to("all-devices").emit("device:data", savedPayload);
    if (Number.isFinite(savedPayload.deviceId)) {
      io.to(`device:${savedPayload.deviceId}`).emit("device:data", savedPayload);
    }

    return { ok: true, data: savedPayload };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process socket payload";
    const errorObject = error as {
      code?: string;
      errno?: number;
      sqlState?: string;
      sqlMessage?: string;
    };

    console.error("Failed to persist incoming device packet", {
      message,
      code: errorObject?.code,
      errno: errorObject?.errno,
      sqlState: errorObject?.sqlState,
      sqlMessage: errorObject?.sqlMessage
    });

    console.error("Raw payload that failed deviceId validation", {
      topLevelKeys: payload && typeof payload === "object" ? Object.keys(payload as object) : typeof payload,
      deviceId: (payload as any)?.deviceId,
      device_id: (payload as any)?.device_id,
      nestedDataKeys:
        (payload as any)?.data && typeof (payload as any).data === "object"
          ? Object.keys((payload as any).data)
          : undefined
    });

    try {
      const livePayload = await historyService.buildBroadcastPayload(payload);
      io.to("all-devices").emit("device:data", livePayload);
      if (Number.isFinite(livePayload.deviceId)) {
        io.to(`device:${livePayload.deviceId}`).emit("device:data", livePayload);
      }
    } catch (fallbackError) {
      console.error("Failed to build fallback live payload", fallbackError);
    }

    io.to("dashboards").emit("device:error", { message });

    return { ok: false, message };
  }
}

export function registerDeviceSocket(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);
    let isAuthenticatedSocket = false;

    const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || "").trim();
    if (token) {

      
      try {
        const payload = verifyJwt(token);
        isAuthenticatedSocket = true;
           //   console.log("tokennnnnnnnn ",token);
        const userLookup = userRepo
          .findOne({ where: { id: payload.userId, username: payload.username, role: payload.role }, relations: { devices: true } })
          .then((user) => {
            (socket.data as DeviceSocketData).user = user || undefined;
            if (!user) {
              return null;
            }

            socket.join("dashboards");
            if (user.role !== UserRole.ADMIN) {
              user.devices.forEach((device) => {
                socket.join(`device:${device.id}`);
              });
            } else {
              socket.join("all-devices");
            }

            return user;
          })
          .catch((error) => {
            console.error("Failed to join socket rooms", error);
            (socket.data as DeviceSocketData).user = undefined;
            return null;
          });

        (socket.data as DeviceSocketData).userLookup = userLookup;
      } catch (_error) {
        socket.disconnect(true);
        return;
      }
    }

    socket.on("disconnect", (reason: string) => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`);
    });

    socket.on("client:heartbeat", (payload: unknown, ack?: (response: unknown) => void) => {
      const response = {
        ok: true,
        serverTime: new Date().toISOString(),
        clientPayload: payload ?? null
      };

      socket.emit("server:heartbeat", response);

      if (typeof ack === "function") {
        ack(response);
      }
    });

    socket.on("mobile:subscribe", () => {
      if (!isAuthenticatedSocket) {
        return;
      }

      socket.join("mobile-clients");
    });

    socket.on("mobile:request_latest_telemetry", async (payload: unknown, ack?: (response: unknown) => void) => {
      if (!isAuthenticatedSocket) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "not authenticated" });
        }
        return;
      }

      try {
        const socketData = socket.data as DeviceSocketData;
        const user = socketData.user || (socketData.userLookup ? await socketData.userLookup : null);
        if (!user) {
          if (typeof ack === "function") {
            ack({ ok: false, error: "user not resolved" });
          }
          return;
        }

        const authorizedUser = toAuthorizedUser(user);
        const allowedDevices = await deviceService.getDevicesForUser(authorizedUser);
        const allowedDeviceIds = allowedDevices.map((device) => Number(device.id)).filter((deviceId) => Number.isInteger(deviceId) && deviceId > 0);
        const allowedDeviceIdSet = new Set<number>(allowedDeviceIds);

        const requestedDeviceIds = parseRequestedDeviceIds(payload);
        const deviceIds = Array.isArray(requestedDeviceIds)
          ? requestedDeviceIds.filter((deviceId) => allowedDeviceIdSet.has(deviceId))
          : allowedDeviceIds;

        const latestByDeviceId = await telemetryService.getLatestSamplePerDevice(deviceIds, authorizedUser);
        const deviceById = new Map<number, { name: string; externalDeviceId: string | null }>();
        allowedDevices.forEach((device) => {
          const id = Number(device.id);
          if (Number.isInteger(id) && id > 0) {
            deviceById.set(id, {
              name: device.name,
              externalDeviceId: device.externalDeviceId ?? null
            });
          }
        });

        const snapshot: Record<number, {
          deviceId: number;
          name: string;
          externalDeviceId: string | null;
          battery: number | null;
          temperature: number | null;
          uptime: string | null;
          internet: string | null;
          ping: number | null;
          interfaceName: string | null;
          recordedAt: string | null;
        }> = {};

        deviceIds.forEach((deviceId) => {
          const deviceMeta = deviceById.get(deviceId);
          if (!deviceMeta) {
            return;
          }

          const latest = latestByDeviceId[deviceId];
          snapshot[deviceId] = {
            deviceId,
            name: deviceMeta.name,
            externalDeviceId: deviceMeta.externalDeviceId,
            battery: latest ? latest.battery : null,
            temperature: latest ? latest.temperature : null,
            uptime: latest ? latest.uptime : null,
            internet: latest ? latest.internet : null,
            ping: latest ? latest.ping : null,
            interfaceName: latest ? latest.interfaceName : null,
            recordedAt: latest ? latest.recordedAt : null
          };
        });

        if (typeof ack === "function") {
          ack({ ok: true, snapshot });
        }
      } catch (error) {
        console.error("Failed to fetch latest telemetry snapshot for mobile", error);
        if (typeof ack === "function") {
          ack({ ok: false, error: "internal error" });
        }
      }
    });

    // const handleSendData = async (payload: unknown, ack?: (response: SocketAck) => void): Promise<void> => {
    //     // console.log("data from device ",(payload as any).data);
    //        console.log("data from device ",(payload as any).data.deviceId);
    //           console.log("data from device ",(payload as any).data.start_time);
    //              console.log("data from device ",(payload as any).data.end_time);
        
    //         //   console.log("data from device ",payload);
    //   await handleIncomingDeviceData(io, payload, ack);
    // };

const handleSendData = async (payload: unknown, ack?: (response: SocketAck) => void): Promise<void> => {
    if (payload === undefined || payload === null) {
      if (typeof ack === "function") {
        ack({ ok: false, message: "payload is empty" });
      }
      return;
    }

    let data: unknown = payload;
    try {
      data = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (_error) {
      if (typeof ack === "function") {
        ack({ ok: false, message: "payload string is not valid JSON" });
      }
      return;
    }

    const raw = data as Record<string, unknown>;
    const maybeMatrix = Array.isArray(raw.data) ? raw.data : null;
    console.log("Incoming device packet", {
      deviceId: raw.deviceId,
      start_time: raw.start_time,
      end_time: raw.end_time,
      rows: maybeMatrix ? maybeMatrix.length : undefined,
      cols: maybeMatrix && Array.isArray(maybeMatrix[0]) ? maybeMatrix[0].length : undefined,
      freq: raw.frequencies,
      intensityType: raw.intensityType,
      confidence: raw.confidence
    });

    if (isMisroutedTelemetryPayload(raw)) {
      const result = await routeMisroutedTelemetryPayload(raw);
      if (result.ok) {
        if (typeof ack === "function") {
          ack({ ok: true, message: "routed to telemetry" });
        }
      } else {
        console.warn("Failed to route misrouted telemetry payload from send_data", {
          message: result.message,
          deviceId: raw.deviceId,
          device_id: raw.device_id
        });
        if (typeof ack === "function") {
          ack({ ok: false, message: result.message });
        }
      }
      return;
    }

    if (Array.isArray(raw.entries)) {
      let succeededCount = 0;
      let failedCount = 0;

      for (const entry of raw.entries) {
        if (isRecord(entry) && isMisroutedTelemetryPayload(entry)) {
          const telemetryResult = await routeMisroutedTelemetryPayload(entry);
          if (telemetryResult.ok) {
            succeededCount += 1;
          } else {
            failedCount += 1;
            console.warn("Failed to route misrouted telemetry batch entry from send_data", {
              message: telemetryResult.message,
              deviceId: entry.deviceId,
              device_id: entry.device_id
            });
          }
          continue;
        }

        const result = await processSingleDevicePacket(io, entry);
        if (result.ok) {
          succeededCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (typeof ack === "function") {
        ack({
          ok: failedCount === 0,
          message: `processed ${succeededCount}/${raw.entries.length} entries`,
          failedCount,
          data: {
            totalCount: raw.entries.length,
            succeededCount,
            failedCount
          }
        });
      }
      return;
    }

    await handleIncomingDeviceData(io, data, ack);
};

    const handlePing = async (payload: unknown): Promise<void> => {

       io.to("mobile-clients").emit("device_ping_update", payload);
      if (!Array.isArray(payload)) {
        console.warn("Invalid ping payload received; expected array", payload);
        return;
      }

      const cleanedEntries: Array<{
        deviceId: number;
        device_id: string;
        status: string;
        ping: number | null;
        time: string;
        date: string;
      }> = [];

      for (const entry of payload) {
        if (!isRecord(entry)) {
          console.warn("Skipping ping entry because it is not an object", entry);
          continue;
        }

        const rawDeviceId = entry.device_id ?? entry.deviceId;
        if (typeof rawDeviceId !== "string" && typeof rawDeviceId !== "number") {
          console.warn("Skipping ping entry because device identifier is missing", entry);
          continue;
        }

        try {
          const device = await deviceService.resolveDeviceIdentifier(rawDeviceId);
          const statusValue = typeof entry.status === "string" ? entry.status : "UNKNOWN";
          const pingValue = entry.ping === null ? null : Number(entry.ping);

          cleanedEntries.push({
            deviceId: device.id,
            device_id: typeof rawDeviceId === "string" ? rawDeviceId : String(rawDeviceId),
            status: statusValue,
            ping: Number.isFinite(pingValue) ? pingValue : null,
            time: typeof entry.time === "string" ? entry.time : "",
            date: typeof entry.date === "string" ? entry.date : ""
          });
        } catch (error) {
          console.warn("Skipping ping payload for unknown device", {
            deviceIdentifier: rawDeviceId,
            message: error instanceof Error ? error.message : "unknown error"
          });
        }
      }

      io.to("dashboards").emit("ping", cleanedEntries);

      // const mobilePingUpdate = cleanedEntries.map((entry) => ({
      //   deviceId: entry.deviceId,
      //   device_id: entry.device_id,
      //   status: entry.status,
      //   ping: entry.ping
      // }));
      // io.to("mobile-clients").emit("device_ping_update", mobilePingUpdate);
    };

    const handleDeviceStatus = async (payload: unknown, ack?: (response: SocketAck) => void): Promise<void> => {
      console.log("🚨 devices_status event received");

      let parsedPayload: unknown = payload;
      if (typeof payload === "string") {
        try {
          parsedPayload = JSON.parse(payload);
        } catch (_error) {
          console.log("error ..... Raw devices_status payload:", payload);
          if (typeof ack === "function") {
            ack({ ok: true, message: "devices_status received", data: payload });
          }
          return;
        }
      }

      console.dir(parsedPayload, { depth: null });

      const telemetryEntries = extractTelemetryStatusEntries(parsedPayload);
      for (const entry of telemetryEntries) {
        try {
          const device = await deviceService.resolveDeviceIdentifier(entry.deviceIdentifier);
          await telemetryService.recordIfNeeded(device.id, entry.telemetry);
        } catch (error) {
          console.warn("Skipping telemetry status payload for unknown device", {
            deviceIdentifier: entry.deviceIdentifier,
            message: error instanceof Error ? error.message : "unknown error"
          });
        }
      }

      io.to("dashboards").emit("devices_status", parsedPayload);
  io.to("mobile-clients").emit("device_telemetry_update", parsedPayload);
      socket.emit("devices_status", parsedPayload);

      if (typeof ack === "function") {
        ack({ ok: true, message: "devices_status received", data: parsedPayload });
      }
    };

    const handleCheckAiStatus = async (payload: unknown, ack?: (response: SocketAck) => void): Promise<void> => {
      console.log("check_ai_status event received");
      console.dir(payload, { depth: null });

      try {
        const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;
        const { startTime, endTime } = extractAiStatusRange(parsedPayload);
        const items = await historyService.getAiStatusByDateRange(startTime, endTime);

        const response = {
          ok: true,
          data: {
            startTime,
            endTime,
            items
          }
        } satisfies SocketAck;

        if (typeof ack === "function") {
          ack(response);
          return;
        }

        socket.emit("check_ai_status_result", response);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check AI status";
        const response = { ok: false, message } satisfies SocketAck;

        if (typeof ack === "function") {
          ack(response);
          return;
        }

        socket.emit("check_ai_status_result", response);
      }
    };

    socket.on("devices_status", handleDeviceStatus);
    socket.on("check_ai_status", handleCheckAiStatus);
    socket.on("ping", handlePing);
    socket.on("send_data", handleSendData);
    socket.on("device:data", handleSendData);
  });
}
