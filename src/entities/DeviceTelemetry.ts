import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn
} from "typeorm";
import { Device } from "./Device";

@Entity({ name: "device_telemetry" })
@Index("idx_device_telemetry_device_time", ["deviceId", "recordedAt"])
export class DeviceTelemetry {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  deviceId!: number;

  @ManyToOne(() => Device, (device) => device.telemetries, { onDelete: "CASCADE" })
  @JoinColumn({ name: "deviceId" })
  device!: Device;

  @Column({ type: "datetime" })
  recordedAt!: string;

  @Column({ type: "float", nullable: true })
  battery!: number | null;

  @Column({ type: "float", nullable: true })
  temperature!: number | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  uptime!: string | null;

  @Column({ type: "varchar", length: 10, nullable: true })
  internet!: string | null;

  @Column({ type: "float", nullable: true })
  ping!: number | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  interfaceName!: string | null;

  @Column({ type: "varchar", length: 20, default: "sample" })
  eventType!: string;
}