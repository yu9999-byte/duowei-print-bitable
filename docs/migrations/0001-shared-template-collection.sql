-- Additive only. Do not modify or remove the existing bridge / automation tables.
CREATE TABLE IF NOT EXISTS duowei_shared_template_collection (
    tenant_key TEXT NOT NULL,
    base_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    envelope JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_key, base_id, table_id),
    CHECK (jsonb_typeof(envelope) = 'object'),
    CHECK (envelope->>'baseId' IS NOT NULL AND envelope->>'baseId' = base_id),
    CHECK (envelope->>'tableId' IS NOT NULL AND envelope->>'tableId' = table_id),
    CHECK (envelope->>'revision' IS NOT NULL AND envelope->>'revision' = revision)
);
