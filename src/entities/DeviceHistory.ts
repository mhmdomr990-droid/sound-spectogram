import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn
} from "typeorm";
import { Device } from "./Device";
import { StoredDeviceMatrix } from "../utils/types";



export enum AiStatus {
  POSSIBLE = 0,
  DETECTED = 1,
  NOT_DETECTED = 2
}

@Entity({ name: "device_histories" })
@Index(["deviceId", "timestamp"])
@Index(["deviceId", "startTime", "endTime"], { unique: true })
export class DeviceHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  deviceId!: number;

  @ManyToOne(() => Device, (device) => device.histories, { onDelete: "CASCADE" })
  @JoinColumn({ name: "deviceId" })
  device!: Device;

  @Column({ type: "datetime" })
  timestamp!: string;

  @Column({ type: "datetime", nullable: true })
  startTime!: string | null;

  @Column({ type: "datetime", nullable: true })
  endTime!: string | null;

  @Column({ type: "json" })
  data!: StoredDeviceMatrix;

  @Column({ type: "json", nullable: true })
  frequencyBins!: number[] | null;

  @Column({ type: "tinyint", nullable: true })
  aiStatus!: AiStatus | null;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  confidence!: number | null;
}
