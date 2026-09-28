import { Column, Entity, ManyToMany, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { DeviceHistory } from "./DeviceHistory";
import { DeviceTelemetry } from "./DeviceTelemetry";
import { User } from "./User";

@Entity({ name: "devices" })
export class Device {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  externalDeviceId!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  description!: string | null;

  @Column({ type: "double", nullable: true })
  minFrequency!: number | null;

  @Column({ type: "double", nullable: true })
  maxFrequency!: number | null;

  @Column({ type: "decimal", precision: 10, scale: 7, nullable: true })
  latitude!: number | null;

  @Column({ type: "decimal", precision: 10, scale: 7, nullable: true })
  longitude!: number | null;

  @OneToMany(() => DeviceHistory, (history) => history.device)
  histories!: DeviceHistory[];

  @OneToMany(() => DeviceTelemetry, (telemetry) => telemetry.device)
  telemetries!: DeviceTelemetry[];

  @ManyToMany(() => User, (user) => user.devices)
  users!: User[];
}
