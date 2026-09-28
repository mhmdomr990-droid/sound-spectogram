import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from "typeorm";
import { Device } from "./Device";

export enum UserRole {
  ADMIN = "admin",
  EMP = "emp"
}

@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "varchar", length: 100, unique: true })
  username!: string;

  @Column({ type: "varchar", length: 255 })
  password!: string;

  @Column({ type: "enum", enum: UserRole, default: UserRole.EMP })
  role!: UserRole;

  @Column({ type: "varchar", length: 500, nullable: true })
  token!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  mobileDeviceId!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  mobileDeviceStatus!: string | null;

  @Column({ type: "datetime", nullable: true })
  mobileDeviceFirstSeenAt!: string | null;

  @Column({ type: "datetime", nullable: true })
  mobileDeviceApprovedAt!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  mobileDeviceChangeRequestId!: string | null;

  @Column({ type: "datetime", nullable: true })
  mobileDeviceChangeRequestedAt!: string | null;

  @ManyToMany(() => Device, (device) => device.users, { eager: false })
  @JoinTable({
    name: "user_devices",
    joinColumn: { name: "userId", referencedColumnName: "id" },
    inverseJoinColumn: { name: "deviceId", referencedColumnName: "id" }
  })
  devices!: Device[];
}
