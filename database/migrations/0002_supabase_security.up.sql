-- These tables are accessed through the Data Pool API, not through Supabase's
-- browser-facing Data API. RLS plus revoked grants makes that boundary explicit.
ALTER TABLE coordinate_reference_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE variable_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_projection_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE drillhole_collars ENABLE ROW LEVEL SECURITY;
ALTER TABLE drillhole_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivation_inputs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  coordinate_reference_systems,
  variable_definitions,
  datasets,
  dataset_versions,
  dataset_variables,
  observation_projection_bindings,
  observation_values,
  drillhole_collars,
  drillhole_surveys,
  analysis_runs,
  derived_values,
  derivation_inputs
FROM PUBLIC;

DO $revoke_supabase_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      coordinate_reference_systems,
      variable_definitions,
      datasets,
      dataset_versions,
      dataset_variables,
      observation_projection_bindings,
      observation_values,
      drillhole_collars,
      drillhole_surveys,
      analysis_runs,
      derived_values,
      derivation_inputs
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      coordinate_reference_systems,
      variable_definitions,
      datasets,
      dataset_versions,
      dataset_variables,
      observation_projection_bindings,
      observation_values,
      drillhole_collars,
      drillhole_surveys,
      analysis_runs,
      derived_values,
      derivation_inputs
    FROM authenticated;
  END IF;
END
$revoke_supabase_roles$;

COMMENT ON TABLE variable_definitions IS
  'Server-side Data Pool table. Browser roles are intentionally denied; use the Data Pool API.';
