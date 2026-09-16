BEGIN;
CREATE TABLE IF NOT EXISTS data_agent.proposals(
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES data_agent.projects(id), actor_id text NOT NULL,
 workflow_id text NOT NULL, revision integer NOT NULL, semantic_digest text NOT NULL, digest text NOT NULL,
 body jsonb NOT NULL, status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 approval_id text REFERENCES data_agent.approvals(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workflow_id,revision) REFERENCES data_agent.workflow_versions(project_id,workflow_id,revision)
);
CREATE TABLE IF NOT EXISTS data_agent.proposal_decisions(
 proposal_id text PRIMARY KEY REFERENCES data_agent.proposals(id), actor_id text NOT NULL,
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO data_agent.schema_versions(version) VALUES(6) ON CONFLICT DO NOTHING;
COMMIT;
