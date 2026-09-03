import bcrypt from "bcrypt";
import { In, Repository } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { Device } from "../entities/Device";
import { User, UserRole } from "../entities/User";
import { HttpError } from "../utils/http-error";
import { signJwt } from "../utils/jwt";

interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role: UserRole;
  deviceIds?: number[];
}

interface UpdateUserInput {
  name?: string;
  username?: string;
  password?: string;
  role?: UserRole;
  deviceIds?: number[];
}

type SafeUser = Omit<User, "password" | "devices"> & {
  deviceIds: number[];
};

export class UserService {
  private readonly userRepo: Repository<User>;
  private readonly deviceRepo: Repository<Device>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.deviceRepo = AppDataSource.getRepository(Device);
  }

  private sanitizeUser(user: User): SafeUser {
    const { password: _password, devices: _devices, ...safeUser } = user as User & { devices?: Device[] };
    return {
      ...safeUser,
      deviceIds: Array.isArray(user.devices) ? user.devices.map((device) => device.id) : []
    };
  }

  private async resolveDevices(deviceIds?: number[]): Promise<Device[]> {
    const uniqueIds = Array.from(new Set((deviceIds || []).filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const devices = await this.deviceRepo.find({
      where: { id: In(uniqueIds) },
      order: { id: "ASC" }
    });

    if (devices.length !== uniqueIds.length) {
      throw new HttpError(400, "One or more deviceIds are invalid");
    }

    return devices;
  }

  async createUser(input: CreateUserInput): Promise<SafeUser> {
    const existing = await this.userRepo.findOne({ where: { username: input.username } });
    if (existing) {
      throw new HttpError(409, "Username already exists");
    }

    const assignedDevices = input.role === UserRole.EMP ? await this.resolveDevices(input.deviceIds) : [];
    if (input.role === UserRole.EMP && assignedDevices.length === 0) {
      throw new HttpError(400, "At least one device must be assigned to employee users");
    }

    const hashedPassword = await bcrypt.hash(input.password, 10);
    const user = this.userRepo.create({
      name: input.name,
      username: input.username,
      password: hashedPassword,
      role: input.role,
      token: null,
      devices: assignedDevices
    });

    const saved = await this.userRepo.save(user);
    const reloaded = await this.userRepo.findOne({ where: { id: saved.id }, relations: { devices: true } });
    if (!reloaded) {
      throw new HttpError(500, "Failed to create user");
    }

    return this.sanitizeUser(reloaded);
  }

  async authenticateUser(username: string, password: string): Promise<{
    token: string;
    user: { id: number; name: string; username: string; role: UserRole; deviceIds: number[] };
  }> {
    const user = await this.userRepo.findOne({ where: { username }, relations: { devices: true } });
    if (!user) {
      throw new HttpError(401, "Invalid username or password");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new HttpError(401, "Invalid username or password");
    }

    const token = signJwt({
      userId: user.id,
      username: user.username,
      role: user.role
    });

    user.token = token;
    await this.userRepo.save(user);

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        deviceIds: Array.isArray(user.devices) ? user.devices.map((device) => device.id) : []
      }
    };
  }

  async getUsers(): Promise<Array<SafeUser>> {
    const users = await this.userRepo.find({ relations: { devices: true }, order: { id: "ASC" } });
    return users.map((user) => this.sanitizeUser(user));
  }

  async getUserById(id: number): Promise<SafeUser> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { devices: true } });
    if (!user) {
      throw new HttpError(404, "User not found");
    }
    return this.sanitizeUser(user);
  }

  async updateUser(id: number, input: UpdateUserInput): Promise<SafeUser> {
    const user = await this.userRepo.findOne({ where: { id }, relations: { devices: true } });
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    if (input.username && input.username !== user.username) {
      const existing = await this.userRepo.findOne({ where: { username: input.username } });
      if (existing) {
        throw new HttpError(409, "Username already exists");
      }
      user.username = input.username;
    }

    if (input.name) {
      user.name = input.name;
    }

    if (input.role) {
      user.role = input.role;
    }

    const effectiveRole = input.role || user.role;
    if (effectiveRole === UserRole.ADMIN) {
      user.devices = [];
    } else {
      const resolvedDevices = input.deviceIds !== undefined ? await this.resolveDevices(input.deviceIds) : user.devices || [];
      if (resolvedDevices.length === 0) {
        throw new HttpError(400, "At least one device must be assigned to employee users");
      }
      user.devices = resolvedDevices;
    }

    if (input.password) {
      user.password = await bcrypt.hash(input.password, 10);
    }

    const saved = await this.userRepo.save(user);
    const reloaded = await this.userRepo.findOne({ where: { id: saved.id }, relations: { devices: true } });
    if (!reloaded) {
      throw new HttpError(500, "Failed to update user");
    }

    return this.sanitizeUser(reloaded);
  }

  async deleteUser(id: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new HttpError(404, "User not found");
    }

    await this.userRepo.delete(id);
  }
}
