import { IncomingDeviceDataPayload } from "./types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPartsToNaiveIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millis: number
): string {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  const mmm = String(millis).padStart(3, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${mmm}`.replace(/\.000$/, "");
}

function parseNaiveIsoString(value: string): string | null {
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );
  if (!m) {
    return null;
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  const msRaw = String(m[7] || "0");
  const millis = Number(msRaw.padEnd(3, "0"));

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    !Number.isFinite(millis)
  ) {
    return null;
  }

  return formatPartsToNaiveIso(year, month, day, hour, minute, second, millis);
}

function formatDateToNaiveIso(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  const millis = String(value.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}`.replace(/\.000$/, "");
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validateDeviceMatrix(data: unknown): { valid: boolean; message?: string } {
  if (!Array.isArray(data) || data.length === 0) {
    return { valid: false, message: "data must be a non-empty 2D array" };
  }

  for (const row of data) {
    if (!Array.isArray(row) || row.length === 0) {
      return { valid: false, message: "each row must be a non-empty array" };
    }

    for (const value of row) {
      if (!isFiniteNumber(value)) {
        return { valid: false, message: "data must contain only finite numbers" };
      }
    }
  }

  return { valid: true };
}

function parseTimestampLike(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return parseNaiveIsoString(trimmed);
  }

  return null;
}

export function normalizeNaiveDateTimeString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? formatDateToNaiveIso(value) : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? formatDateToNaiveIso(parsed) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseNaiveIsoString(trimmed);
  if (parsed) {
    return parsed;
  }

  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? formatDateToNaiveIso(date) : null;
}

export function validateIncomingDevicePayload(payload: unknown): {
  valid: boolean;
  message?: string;
  parsed?: IncomingDeviceDataPayload;
  parsedTimestamp?: string;
} {
  if (typeof payload !== "object" || payload === null) {
    return { valid: false, message: "payload must be an object" };
  }

  const outer = payload as Record<string, unknown>;
  const raw =
    typeof outer.data === "object" &&
    outer.data !== null &&
    !Array.isArray(outer.data) &&
    "deviceId" in (outer.data as Record<string, unknown>)
      ? (outer.data as Record<string, unknown>)
      : outer;

  const deviceIdRaw = raw.deviceId;
  const isStringDeviceId = typeof deviceIdRaw === "string" && deviceIdRaw.trim().length > 0;
  if (!isPositiveInteger(deviceIdRaw) && !isStringDeviceId) {
    return { valid: false, message: "deviceId must be a positive integer or non-empty string" };
  }

  const matrixValidation = validateDeviceMatrix(raw.data);
  if (!matrixValidation.valid) {
    return { valid: false, message: matrixValidation.message };
  }

  const matrixRows = (raw.data as unknown[]).length;

  const intensityTypeValue =
    typeof raw.intensityType === "string"
      ? raw.intensityType
      : typeof raw.intensity_type === "string"
        ? raw.intensity_type
        : undefined;
  const intensityTypeRaw = intensityTypeValue ? intensityTypeValue.trim().toLowerCase() : undefined;
  let parsedIntensityType: IncomingDeviceDataPayload["intensityType"];
  if (intensityTypeRaw) {
    if (
      intensityTypeRaw !== "normalized" &&
      intensityTypeRaw !== "uint8" &&
      intensityTypeRaw !== "magnitude" &&
      intensityTypeRaw !== "db"
    ) {
      return {
        valid: false,
        message: "intensityType must be one of normalized, uint8, magnitude, db"
      };
    }

    parsedIntensityType = intensityTypeRaw;
  }

  const rawAiStatus = raw.aiStatus ?? raw.ai_status;
  let parsedAiStatus: IncomingDeviceDataPayload["aiStatus"];
  if (rawAiStatus !== undefined && rawAiStatus !== null && rawAiStatus !== "") {
    const aiStatusNumber = Number(rawAiStatus);
    if (!Number.isInteger(aiStatusNumber) || (aiStatusNumber !== 0 && aiStatusNumber !== 1 && aiStatusNumber !== 2)) {
      return { valid: false, message: "aiStatus must be one of 0, 1, 2" };
    }
    parsedAiStatus = aiStatusNumber as IncomingDeviceDataPayload["aiStatus"];
  }

  const rawConfidence = raw.confidence ?? raw.Confidence;
  let parsedConfidence: IncomingDeviceDataPayload["confidence"];
  if (rawConfidence !== undefined && rawConfidence !== null && rawConfidence !== "") {
    const confidenceNumber = Number(rawConfidence);
    if (!Number.isFinite(confidenceNumber)) {
      return { valid: false, message: "confidence must be a finite number" };
    }
    parsedConfidence = confidenceNumber;
  }

  const rawFrequencyBins =
    raw.frequencyBins ??
    raw.frequency_bins ??
    raw.freq ??
    raw.frequencies ??
    raw.frequency ??
    raw.bin_frequencies;
  let parsedFrequencyBins: number[] | undefined;
  if (rawFrequencyBins !== undefined) {
    if (!Array.isArray(rawFrequencyBins) || rawFrequencyBins.length === 0) {
      return { valid: false, message: "frequency bins must be a non-empty array when provided" };
    }

    const bins: number[] = [];
    for (const item of rawFrequencyBins) {
      const value = Array.isArray(item) ? item[0] : item;
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return { valid: false, message: "frequency bins must contain only finite numbers" };
      }
      bins.push(n);
    }

    if (bins.length !== matrixRows) {
      return {
        valid: false,
        message: `frequency bins length (${bins.length}) must match data rows (${matrixRows})`
      };
    }

    parsedFrequencyBins = bins;
  }

  const startTimeCandidate = raw.start_time ?? raw.startTime ?? raw.timestamp;
  const endTimeCandidate = raw.end_time ?? raw.endTime ?? raw.timestamp;

  const parsedStart = parseTimestampLike(startTimeCandidate);
  const parsedEnd = parseTimestampLike(endTimeCandidate);
  if (!parsedStart || !parsedEnd) {
    return { valid: false, message: "start_time/end_time are invalid" };
  }

  if (parsedStart > parsedEnd) {
    return { valid: false, message: "start_time must be before or equal to end_time" };
  }

  const parsedTimestamp = parseTimestampLike(raw.timestamp ?? parsedEnd);
  if (!parsedTimestamp) {
    return { valid: false, message: "timestamp is invalid" };
  }

  return {
    valid: true,
    parsedTimestamp,
    parsed: {
      deviceId: isStringDeviceId ? deviceIdRaw.trim() : (deviceIdRaw as number),
      timestamp: parsedTimestamp,
      startTime: parsedStart,
      endTime: parsedEnd,
      data: raw.data as number[][],
      frequencyBins: parsedFrequencyBins,
      intensityType: parsedIntensityType,
      aiStatus: parsedAiStatus,
      confidence: parsedConfidence
    }
  };
}
