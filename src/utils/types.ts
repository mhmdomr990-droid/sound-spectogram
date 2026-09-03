import { UserRole } from "../entities/User";

export type DeviceMatrix = number[][];
export type IntensityType = "normalized" | "uint8" | "magnitude" | "db";

export interface CompressedDeviceMatrixPayload {
  format: "gzip-base64-json-v1";
  rows: number;
  cols: number;
  payload: string;
}

export type StoredDeviceMatrix = DeviceMatrix | CompressedDeviceMatrixPayload;

export type DeviceIdentifier = number | string;

export interface IncomingDeviceDataPayload {
  deviceId: DeviceIdentifier;
  timestamp: string;
  startTime?: string;
  endTime?: string;
  data: DeviceMatrix;
  frequencyBins?: number[];
  intensityType?: IntensityType;
  aiStatus?: 0 | 1 | 2;
}

export interface DeviceDataBroadcastPayload {
  deviceId: number;
  deviceName?: string;
  sourceDeviceId?: DeviceIdentifier;
  timestamp: string;
  startTime?: string;
  endTime?: string;
  data: DeviceMatrix;
  frequencyBins?: number[];
  intensityType?: IntensityType;
  aiStatus?: 0 | 1 | 2;
  persisted?: boolean;
}

export interface JwtUserPayload {
  userId: number;
  username: string;
  role: UserRole;
}

export interface AuthorizedUser {
  userId: number;
  username: string;
  role: UserRole;
  allowedDeviceIds?: number[];
}
