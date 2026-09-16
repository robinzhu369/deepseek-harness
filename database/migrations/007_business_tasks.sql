BEGIN;
CREATE TABLE IF NOT EXISTS data_agent.business_tasks(
 id text PRIMARY KEY,project_id text NOT NULL REFERENCES data_agent.projects(id),actor_id text NOT NULL,
 name text NOT NULL,goal text NOT NULL,dataset jsonb NOT NULL,idempotency_key text NOT NULL,request_digest text NOT NULL,
 revision integer NOT NULL DEFAULT 0,selected_run_id text,cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,actor_id,idempotency_key),UNIQUE(project_id,id)
);
ALTER TABLE data_agent.runs ADD COLUMN IF NOT EXISTS business_task_id text;
ALTER TABLE data_agent.runs ADD COLUMN IF NOT EXISTS previous_run_id text REFERENCES data_agent.runs(id);
ALTER TABLE data_agent.runs ADD COLUMN IF NOT EXISTS source_run_id text REFERENCES data_agent.runs(id);
ALTER TABLE data_agent.runs ADD COLUMN IF NOT EXISTS stage text CHECK(stage IN ('analysis','processing','features'));
ALTER TABLE data_agent.runs ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='runs_task_project_fk') THEN
 ALTER TABLE data_agent.runs ADD CONSTRAINT runs_task_project_fk FOREIGN KEY(project_id,business_task_id) REFERENCES data_agent.business_tasks(project_id,id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS data_agent.job_outputs(
 job_id text NOT NULL REFERENCES data_agent.jobs(id),output_port text NOT NULL,artifact_id text NOT NULL REFERENCES data_agent.artifacts(id),
 PRIMARY KEY(job_id,output_port)
);
INSERT INTO data_agent.job_outputs SELECT job_id,output_port,id FROM data_agent.artifacts WHERE job_id IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE data_agent.jobs ADD COLUMN IF NOT EXISTS compute_key text;
ALTER TABLE data_agent.jobs ADD COLUMN IF NOT EXISTS reused_from_job_id text REFERENCES data_agent.jobs(id);
ALTER TABLE data_agent.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE data_agent.jobs ADD CONSTRAINT jobs_status_check CHECK(status IN ('pending','queued','running','computed_waiting_approval','cancel_requested','cancelled','succeeded','failed','not_selected'));
ALTER TABLE data_agent.artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE data_agent.artifacts ADD CONSTRAINT artifacts_kind_check CHECK(kind IN ('RawFileRef','DatasetRef','TransformerRef','ReportRef','SplitMapRef','ExportRef'));
ALTER TABLE data_agent.harness_sessions ADD COLUMN IF NOT EXISTS business_task_id text REFERENCES data_agent.business_tasks(id);
INSERT INTO data_agent.schema_versions(version) VALUES(7) ON CONFLICT DO NOTHING;
COMMIT;
