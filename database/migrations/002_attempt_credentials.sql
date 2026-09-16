BEGIN;
ALTER TABLE data_agent.attempts ADD COLUMN IF NOT EXISTS credential_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS attempt_credential_hash ON data_agent.attempts(credential_hash) WHERE credential_hash IS NOT NULL;
INSERT INTO data_agent.schema_versions(version) VALUES(2) ON CONFLICT DO NOTHING;
COMMIT;
