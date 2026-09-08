ALTER TABLE `alias_handle`
  ADD COLUMN IF NOT EXISTS `pgp_public_key` TEXT NULL DEFAULT NULL AFTER `active`,
  ADD COLUMN IF NOT EXISTS `pgp_fingerprint` VARCHAR(64) NULL DEFAULT NULL AFTER `pgp_public_key`,
  ADD COLUMN IF NOT EXISTS `pgp_enabled` TINYINT(1) NULL DEFAULT NULL AFTER `pgp_fingerprint`,
  ADD COLUMN IF NOT EXISTS `pgp_hide_subject` TINYINT(1) NULL DEFAULT NULL AFTER `pgp_enabled`;

ALTER TABLE `alias`
  ADD COLUMN IF NOT EXISTS `pgp_public_key` TEXT NULL DEFAULT NULL AFTER `active`,
  ADD COLUMN IF NOT EXISTS `pgp_fingerprint` VARCHAR(64) NULL DEFAULT NULL AFTER `pgp_public_key`,
  ADD COLUMN IF NOT EXISTS `pgp_enabled` TINYINT(1) NULL DEFAULT NULL AFTER `pgp_fingerprint`,
  ADD COLUMN IF NOT EXISTS `pgp_hide_subject` TINYINT(1) NULL DEFAULT NULL AFTER `pgp_enabled`;

UPDATE `alias_handle` SET `pgp_enabled` = 0 WHERE `pgp_enabled` IS NULL;
UPDATE `alias_handle` SET `pgp_hide_subject` = 0 WHERE `pgp_hide_subject` IS NULL;

UPDATE `alias` SET `pgp_enabled` = 0 WHERE `pgp_enabled` IS NULL;
UPDATE `alias` SET `pgp_hide_subject` = 0 WHERE `pgp_hide_subject` IS NULL;

ALTER TABLE `alias_handle`
  MODIFY `pgp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  MODIFY `pgp_hide_subject` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `alias`
  MODIFY `pgp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  MODIFY `pgp_hide_subject` TINYINT(1) NOT NULL DEFAULT 0;
