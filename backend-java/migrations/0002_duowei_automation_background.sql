BEGIN;

CREATE TABLE IF NOT EXISTS duowei_automation_background_job (
  job_id varchar(128) PRIMARY KEY,
  task_key varchar(128) NOT NULL UNIQUE,
  status varchar(32) NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  submission jsonb NOT NULL,
  file_token varchar(512),
  error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS duowei_automation_background_job_recovery_idx
  ON duowei_automation_background_job (status, created_at ASC);

CREATE TABLE IF NOT EXISTS duowei_automation_app_ticket (
  app_id varchar(128) PRIMARY KEY,
  ticket text NOT NULL,
  received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
