BEGIN;
CREATE TABLE IF NOT EXISTS data_agent.harness_sessions(
 id text PRIMARY KEY,project_id text NOT NULL REFERENCES data_agent.projects(id),actor_id text NOT NULL,
 input jsonb NOT NULL,runtime jsonb NOT NULL,provider text NOT NULL,invocations jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL CHECK(status IN ('preparing','ready','failed')),created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO data_agent.schema_versions(version) VALUES(5) ON CONFLICT DO NOTHING;
COMMIT;
