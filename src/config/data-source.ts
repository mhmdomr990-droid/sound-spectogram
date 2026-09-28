import "dotenv/config";
import { DataSource } from "typeorm";
import { User } from "../entities/User";
import { Device } from "../entities/Device";
import { DeviceHistory } from "../entities/DeviceHistory";
import { DeviceTelemetry } from "../entities/DeviceTelemetry";

const isProduction = process.env.NODE_ENV === "production";

export const AppDataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [User, Device, DeviceHistory, DeviceTelemetry],
  synchronize: !isProduction,
  logging: false,
  extra: {
    connectionLimit: 20,
    dateStrings: true
  }
});
