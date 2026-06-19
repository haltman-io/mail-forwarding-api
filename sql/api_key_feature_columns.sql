ALTER TABLE api_tokens
  ADD COLUMN automatic_renew TINYINT(1) NULL AFTER user_agent;

UPDATE api_tokens
SET automatic_renew = 0
WHERE automatic_renew IS NULL;

ALTER TABLE api_tokens
  MODIFY COLUMN automatic_renew TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE api_token_requests
  ADD COLUMN action VARCHAR(32) NULL AFTER email,
  ADD COLUMN automatic_renew TINYINT(1) NULL AFTER days;

UPDATE api_token_requests
SET action = 'create'
WHERE action IS NULL OR action = '';

UPDATE api_token_requests
SET automatic_renew = 0
WHERE automatic_renew IS NULL;

ALTER TABLE api_token_requests
  MODIFY COLUMN action VARCHAR(32) NOT NULL DEFAULT 'create',
  MODIFY COLUMN automatic_renew TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX idx_api_token_requests_email_action_status
  ON api_token_requests (email, action, status, expires_at);

CREATE INDEX idx_api_tokens_owner_status_expiry
  ON api_tokens (owner_email, status, revoked_at, expires_at);
