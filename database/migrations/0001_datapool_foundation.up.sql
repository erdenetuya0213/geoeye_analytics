CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION geoeye_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE coordinate_reference_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  wkt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (authority, code)
);

CREATE TABLE variable_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('numeric', 'text', 'category', 'boolean', 'datetime')),
  canonical_unit TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('primary', 'integrated', 'derived', 'interpreted')),
  spatial_support TEXT NOT NULL CHECK (spatial_support IN ('point', 'interval', 'orientation', 'raster', 'none')),
  compatible_analyses TEXT[] NOT NULL DEFAULT '{}',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_variable_definitions_updated_at
BEFORE UPDATE ON variable_definitions
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  producer_type TEXT NOT NULL CHECK (producer_type IN ('field', 'laboratory', 'instrument', 'analytics', 'external')),
  producer_name TEXT NOT NULL,
  source_system TEXT,
  spatial_support TEXT NOT NULL CHECK (spatial_support IN ('point', 'interval', 'orientation', 'raster', 'none')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  object_prefix TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX idx_datasets_project_status ON datasets(project_id, status);

CREATE TRIGGER trg_datasets_updated_at
BEFORE UPDATE ON datasets
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT,
  record_count BIGINT NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  schema_json JSONB NOT NULL DEFAULT '{}',
  source_object_key TEXT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version)
);

CREATE TABLE dataset_variables (
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  variable_id UUID NOT NULL REFERENCES variable_definitions(id) ON DELETE RESTRICT,
  source_name TEXT,
  source_unit TEXT,
  PRIMARY KEY (dataset_id, variable_id)
);

CREATE TABLE observation_projection_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL,
  source_field TEXT NOT NULL,
  variable_id UUID NOT NULL REFERENCES variable_definitions(id) ON DELETE RESTRICT,
  extraction_json JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_observation_projection_binding
  ON observation_projection_bindings(
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_entity_type,
    source_field
  );

CREATE TRIGGER trg_projection_bindings_updated_at
BEFORE UPDATE ON observation_projection_bindings
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE observation_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_version_id UUID REFERENCES dataset_versions(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  hole_id UUID REFERENCES drill_holes(id) ON DELETE SET NULL,
  depth_from NUMERIC,
  depth_to NUMERIC,
  variable_id UUID NOT NULL REFERENCES variable_definitions(id) ON DELETE RESTRICT,
  numeric_value DOUBLE PRECISION,
  text_value TEXT,
  category_value TEXT,
  boolean_value BOOLEAN,
  datetime_value TIMESTAMPTZ,
  unit TEXT,
  quality TEXT NOT NULL DEFAULT 'raw' CHECK (quality IN ('raw', 'reviewed', 'accepted', 'flagged')),
  observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (depth_from IS NULL OR depth_from >= 0),
  CHECK (depth_to IS NULL OR depth_to >= 0),
  CHECK (depth_from IS NULL OR depth_to IS NULL OR depth_to >= depth_from),
  CHECK (num_nonnulls(numeric_value, text_value, category_value, boolean_value, datetime_value) = 1)
);

CREATE UNIQUE INDEX uq_observation_source_variable_version
  ON observation_values(
    dataset_id,
    COALESCE(dataset_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_type,
    source_id,
    variable_id
  );
CREATE INDEX idx_observations_project_variable ON observation_values(project_id, variable_id);
CREATE INDEX idx_observations_hole_depth ON observation_values(project_id, hole_id, depth_from, depth_to);
CREATE INDEX idx_observations_dataset_version ON observation_values(dataset_id, dataset_version_id);

CREATE TABLE drillhole_collars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID NOT NULL REFERENCES drill_holes(id) ON DELETE CASCADE,
  easting DOUBLE PRECISION NOT NULL,
  northing DOUBLE PRECISION NOT NULL,
  elevation DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  crs_id UUID NOT NULL REFERENCES coordinate_reference_systems(id) ON DELETE RESTRICT,
  survey_method TEXT,
  accuracy DOUBLE PRECISION CHECK (accuracy IS NULL OR accuracy >= 0),
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hole_id)
);

CREATE INDEX idx_drillhole_collars_project ON drillhole_collars(project_id);

CREATE TRIGGER trg_drillhole_collars_updated_at
BEFORE UPDATE ON drillhole_collars
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE drillhole_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID NOT NULL REFERENCES drill_holes(id) ON DELETE CASCADE,
  measured_depth NUMERIC NOT NULL CHECK (measured_depth >= 0),
  azimuth DOUBLE PRECISION NOT NULL CHECK (azimuth >= 0 AND azimuth < 360),
  dip DOUBLE PRECISION NOT NULL CHECK (dip >= -90 AND dip <= 90),
  survey_method TEXT,
  tool TEXT,
  accuracy DOUBLE PRECISION CHECK (accuracy IS NULL OR accuracy >= 0),
  source TEXT NOT NULL,
  surveyed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hole_id, measured_depth)
);

CREATE INDEX idx_drillhole_surveys_project_hole_depth
  ON drillhole_surveys(project_id, hole_id, measured_depth);

CREATE TRIGGER trg_drillhole_surveys_updated_at
BEFORE UPDATE ON drillhole_surveys
FOR EACH ROW EXECUTE FUNCTION geoeye_touch_updated_at();

CREATE TABLE analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  dataset_snapshot JSONB NOT NULL,
  parameters_json JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  supersedes_run_id UUID REFERENCES analysis_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'saved', 'accepted', 'failed', 'cancelled', 'superseded'))
);

CREATE INDEX idx_analysis_runs_project_type ON analysis_runs(project_id, analysis_type, created_at DESC);
CREATE INDEX idx_analysis_runs_status ON analysis_runs(project_id, status);

CREATE TABLE derived_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  variable_id UUID NOT NULL REFERENCES variable_definitions(id) ON DELETE RESTRICT,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  hole_id UUID REFERENCES drill_holes(id) ON DELETE SET NULL,
  depth_from NUMERIC,
  depth_to NUMERIC,
  numeric_value DOUBLE PRECISION,
  text_value TEXT,
  category_value TEXT,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved', 'accepted', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (depth_from IS NULL OR depth_from >= 0),
  CHECK (depth_to IS NULL OR depth_to >= 0),
  CHECK (depth_from IS NULL OR depth_to IS NULL OR depth_to >= depth_from),
  CHECK (num_nonnulls(numeric_value, text_value, category_value) = 1)
);

CREATE INDEX idx_derived_values_run ON derived_values(analysis_run_id);
CREATE INDEX idx_derived_values_hole_depth ON derived_values(hole_id, depth_from, depth_to);
CREATE INDEX idx_derived_values_variable_status ON derived_values(variable_id, status);

CREATE TABLE derivation_inputs (
  derived_value_id UUID NOT NULL REFERENCES derived_values(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (derived_value_id, source_type, source_id)
);

COMMENT ON TABLE observation_values IS
  'Normalized Data Pool read model. Field-owned source rows remain authoritative.';
COMMENT ON TABLE derived_values IS
  'Analytics-owned results. These rows never replace primary observation_values.';
COMMENT ON TABLE observation_projection_bindings IS
  'Explicit semantic mapping from producer fields/JSON keys to variable definitions.';

