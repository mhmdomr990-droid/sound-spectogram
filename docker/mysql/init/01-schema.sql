CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'emp') NOT NULL DEFAULT 'emp',
  token VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  minFrequency DOUBLE NULL,
  maxFrequency DOUBLE NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_histories (
  id INT NOT NULL AUTO_INCREMENT,
  deviceId INT NOT NULL,
  timestamp DATETIME NOT NULL,
  startTime DATETIME NULL,
  endTime DATETIME NULL,
  data JSON NOT NULL,
  frequencyBins JSON NULL,
  aiStatus TINYINT NULL,
  PRIMARY KEY (id),
  KEY idx_device_histories_device_timestamp (deviceId, timestamp),
  KEY idx_device_histories_device_start_end (deviceId, startTime, endTime),
  CONSTRAINT fk_device_histories_device
    FOREIGN KEY (deviceId) REFERENCES devices (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_devices (
  userId INT NOT NULL,
  deviceId INT NOT NULL,
  PRIMARY KEY (userId, deviceId),
  KEY idx_user_devices_device (deviceId),
  CONSTRAINT fk_user_devices_user
    FOREIGN KEY (userId) REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_user_devices_device
    FOREIGN KEY (deviceId) REFERENCES devices (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
