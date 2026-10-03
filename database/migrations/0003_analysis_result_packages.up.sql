-- Production catalog for reusable GeoEye-owned analysis results.
-- Binary graph files belong in private object storage; PostgreSQL owns their
-- hierarchy, lineage, version, and object keys.

CREATE TABLE analysis_result_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key TEXT NOT NULL CHECK (tenant_key ~ '^[A-Za-z0-9._-]+$'),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
  feature TEXT NOT NULL CHECK (feature IN ('structure', 'geotechnical', 'multivariate', 'domain')),
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  source_file_name TEXT NOT NULL CHECK (length(btrim(source_file_name)) > 0),
  input_name TEXT NOT NULL CHECK (length(btrim(input_name)) > 0),
  analysis_file_key TEXT NOT NULL CHECK (length(btrim(analysis_file_key)) > 0),
  derived_field_keys TEXT[] NOT NULL DEFAULT '{}',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_key, project_id, dataset_id, feature, template_version)
);

CREATE INDEX idx_analysis_result_packages_project
  ON analysis_result_packages(tenant_key, project_id, created_at DESC);
CREATE INDEX idx_analysis_result_packages_run
  ON analysis_result_packages(analysis_run_id);

CREATE TRIGGER trg_analysis_result_packages_updated_at
BEFORE UPDATE ON analysis_result_packages
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE analysis_result_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_package_id UUID NOT NULL REFERENCES analysis_result_packages(id) ON DELETE CASCADE,
  borehole_id UUID REFERENCES drill_holes(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('analysis_file', 'graph_image')),
  object_key TEXT NOT NULL CHECK (length(btrim(object_key)) > 0),
  file_name TEXT NOT NULL CHECK (length(btrim(file_name)) > 0 AND file_name !~ '[/\\]'),
  media_type TEXT NOT NULL CHECK (media_type IN ('application/json', 'image/png')),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum_sha256 TEXT CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (artifact_type = 'analysis_file' AND media_type = 'application/json')
    OR (artifact_type = 'graph_image' AND media_type = 'image/png')
  ),
  UNIQUE (result_package_id, object_key)
);

CREATE INDEX idx_analysis_result_artifacts_borehole
  ON analysis_result_artifacts(borehole_id, created_at DESC)
  WHERE borehole_id IS NOT NULL;

ALTER TABLE analysis_result_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_result_artifacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analysis_result_packages, analysis_result_artifacts FROM PUBLIC;

DO $revoke_supabase_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE analysis_result_packages, analysis_result_artifacts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE analysis_result_packages, analysis_result_artifacts FROM authenticated;
  END IF;
END
$revoke_supabase_roles$;

COMMENT ON TABLE analysis_result_packages IS
  'Versioned GeoEye analysis packages projected onto a logging dataset/template.';
COMMENT ON TABLE analysis_result_artifacts IS
  'Private object-storage catalog for analysis JSON files and graph images, optionally scoped to a borehole.';
