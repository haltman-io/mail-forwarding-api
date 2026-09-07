CREATE TABLE IF NOT EXISTS `smtp_users` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(320) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `smtp_sender_acl` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `login` VARCHAR(320) NOT NULL,
  `sender` VARCHAR(320) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_login_sender` (`login`, `sender`),
  KEY `idx_sender_active` (`sender`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `smtp_invite_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` VARBINARY(32) NOT NULL,
  `created_by` VARCHAR(320) NOT NULL,
  `allowed_sender_constraint` VARCHAR(254) DEFAULT NULL,
  `is_used` TINYINT(1) NOT NULL DEFAULT 0,
  `used_at` TIMESTAMP NULL DEFAULT NULL,
  `created_username` VARCHAR(320) DEFAULT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_smtp_invite_token_hash` (`token_hash`),
  KEY `idx_smtp_invite_active` (`is_used`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
