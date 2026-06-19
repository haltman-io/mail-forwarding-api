ALTER TABLE `domain`
  ADD COLUMN IF NOT EXISTS `active_mx` tinyint(1) NULL AFTER `active`,
  ADD COLUMN IF NOT EXISTS `active_ui` tinyint(1) NULL AFTER `active_mx`,
  ADD COLUMN IF NOT EXISTS `visible` tinyint(1) NULL AFTER `active_ui`;

UPDATE `domain` SET `active_mx` = 0 WHERE `active_mx` IS NULL;
UPDATE `domain` SET `active_ui` = 0 WHERE `active_ui` IS NULL;
UPDATE `domain` SET `visible` = 1 WHERE `visible` IS NULL;

ALTER TABLE `domain`
  MODIFY `active_mx` tinyint(1) NOT NULL,
  MODIFY `active_ui` tinyint(1) NOT NULL,
  MODIFY `visible` tinyint(1) NOT NULL DEFAULT 1;
