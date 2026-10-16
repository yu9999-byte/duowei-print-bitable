BEGIN;

CREATE TABLE IF NOT EXISTS duowei_automation_template (
  tenant_key varchar(128) NOT NULL,
  base_token varchar(128) NOT NULL,
  table_id varchar(128) NOT NULL,
  template_id varchar(128) NOT NULL,
  revision varchar(128) NOT NULL,
  name varchar(255) NOT NULL,
  status varchar(32) NOT NULL CHECK (status IN ('ready', 'syncing', 'error')),
  snapshot jsonb NOT NULL,
  referenced_field_ids jsonb NOT NULL CHECK (jsonb_typeof(referenced_field_ids) = 'array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT duowei_automation_template_pk PRIMARY KEY (
    tenant_key, base_token, table_id, template_id, revision
  )
);

CREATE INDEX IF NOT EXISTS duowei_automation_template_scope_idx
  ON duowei_automation_template (tenant_key, base_token, table_id, status, updated_at DESC);

COMMIT;
