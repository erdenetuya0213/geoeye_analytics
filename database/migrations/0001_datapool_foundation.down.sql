BEGIN;

DROP TABLE IF EXISTS derivation_inputs;
DROP TABLE IF EXISTS derived_values;
DROP TABLE IF EXISTS analysis_runs;
DROP TABLE IF EXISTS drillhole_surveys;
DROP TABLE IF EXISTS drillhole_collars;
DROP TABLE IF EXISTS observation_values;
DROP TABLE IF EXISTS observation_projection_bindings;
DROP TABLE IF EXISTS dataset_variables;
DROP TABLE IF EXISTS dataset_versions;
DROP TABLE IF EXISTS datasets;
DROP TABLE IF EXISTS variable_definitions;
DROP TABLE IF EXISTS coordinate_reference_systems;
DROP FUNCTION IF EXISTS geoeye_touch_updated_at();

COMMIT;

