BEGIN;
ALTER TABLE data_agent.harness_sessions ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE data_agent.harness_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS data_agent.workflow_templates(
 project_id text NOT NULL REFERENCES data_agent.projects(id),id text NOT NULL,name text NOT NULL,
 revision integer NOT NULL,body jsonb NOT NULL,actor_id text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id)
);
INSERT INTO data_agent.schema_versions(version) VALUES(8) ON CONFLICT DO NOTHING;
COMMIT;
