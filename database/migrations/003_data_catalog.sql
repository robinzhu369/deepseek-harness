BEGIN;
ALTER TABLE data_agent.artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE data_agent.artifacts ADD CONSTRAINT artifacts_kind_check CHECK(kind IN ('RawFileRef','DatasetRef','TransformerRef','ReportRef','SplitMapRef'));
ALTER TABLE data_agent.artifacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS data_agent.uploads(
 id text PRIMARY KEY,project_id text NOT NULL REFERENCES data_agent.projects(id),actor_id text NOT NULL,
 idempotency_key text NOT NULL,request_digest text NOT NULL,filename text NOT NULL,bytes bigint NOT NULL,
 digest text NOT NULL,part_bytes integer NOT NULL,status text NOT NULL CHECK(status IN ('uploading','completing','uploaded','failed','aborted')),
 object_key text,error_code text,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,actor_id,idempotency_key),UNIQUE(project_id,id));
ALTER TABLE data_agent.uploads ADD COLUMN IF NOT EXISTS cleaned_at timestamptz;
CREATE TABLE IF NOT EXISTS data_agent.upload_parts(upload_id text REFERENCES data_agent.uploads(id),number integer,bytes bigint NOT NULL,digest text NOT NULL,object_key text NOT NULL,PRIMARY KEY(upload_id,number));
CREATE TABLE IF NOT EXISTS data_agent.upload_grants(upload_id text REFERENCES data_agent.uploads(id),number integer,token_hash text NOT NULL,digest text NOT NULL,PRIMARY KEY(upload_id,number));
CREATE TABLE IF NOT EXISTS data_agent.imports(id text,project_id text NOT NULL REFERENCES data_agent.projects(id),upload_id text NOT NULL REFERENCES data_agent.uploads(id),options jsonb NOT NULL,roles jsonb NOT NULL,run_id text NOT NULL REFERENCES data_agent.runs(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,id));
INSERT INTO data_agent.schema_versions(version) VALUES(3) ON CONFLICT DO NOTHING;
COMMIT;
