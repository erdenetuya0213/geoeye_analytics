-- Projection bookkeeping for the Field -> Data Pool analytical read model.
-- Additive only: Field-owned tables are read, never altered.

CREATE TABLE projection_checkpoints (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL CHECK (length(btrim(source_entity_type)) > 0),
  dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
  -- Cheap change detector over the source rows and active bindings. A run is
  -- skipped when it matches, so a scheduled projection does not rewrite rows.
  source_fingerprint TEXT,
  source_row_count BIGINT NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
  observation_count BIGINT NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  issue_count BIGINT NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  issue_summary_json JSONB NOT NULL DEFAULT '{}',
  last_status TEXT NOT NULL CHECK (last_status IN ('ok', 'failed')),
  last_error TEXT,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, source_entity_type)
);

-- Stale-observation cleanup deletes by (dataset, source type, source id).
CREATE INDEX idx_observations_dataset_source
  ON observation_values(dataset_id, source_type, source_id);

ALTER TABLE projection_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE projection_checkpoints FROM PUBLIC;

DO $revoke_supabase_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE projection_checkpoints FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE projection_checkpoints FROM authenticated;
  END IF;
END
$revoke_supabase_roles$;

COMMENT ON TABLE projection_checkpoints IS
  'Per-project state of each Field source projected into observation_values.';
