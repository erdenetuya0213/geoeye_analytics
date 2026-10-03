-- Least-privilege runtime role for the GeoEye Data Pool API. Idempotent: run it
-- again after every release so new tables receive their grants.
DO $create_geoeye_api$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoeye_api') THEN
    CREATE ROLE geoeye_api
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      BYPASSRLS;
  ELSE
    -- PostgreSQL lets only a superuser change SUPERUSER or REPLICATION, even to
    -- switch them off, and a managed service such as Supabase gives no superuser.
    -- Verify those two instead of re-asserting them so this script can be re-run.
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = 'geoeye_api' AND (rolsuper OR rolreplication)
    ) THEN
      RAISE EXCEPTION 'Role geoeye_api has SUPERUSER or REPLICATION; it must have neither';
    END IF;
    ALTER ROLE geoeye_api
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      BYPASSRLS;
  END IF;
END
$create_geoeye_api$;

GRANT USAGE ON SCHEMA public TO geoeye_api;

-- Data Pool and Analytics tables: read access.
GRANT SELECT ON TABLE
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
  derivation_inputs,
  analysis_result_packages,
  analysis_result_artifacts,
  projection_checkpoints
TO geoeye_api;

GRANT INSERT ON TABLE
  coordinate_reference_systems,
  datasets,
  dataset_versions,
  dataset_variables,
  observation_projection_bindings,
  observation_values,
  drillhole_collars,
  drillhole_surveys,
  analysis_runs,
  derived_values,
  derivation_inputs,
  analysis_result_packages,
  analysis_result_artifacts,
  projection_checkpoints
TO geoeye_api;

GRANT UPDATE ON TABLE
  coordinate_reference_systems,
  datasets,
  dataset_versions,
  observation_projection_bindings,
  observation_values,
  drillhole_collars,
  analysis_runs,
  derived_values,
  analysis_result_packages,
  projection_checkpoints
TO geoeye_api;

GRANT DELETE ON TABLE
  observation_values,
  drillhole_surveys,
  analysis_result_artifacts
TO geoeye_api;

-- Field-owned tables: read-only, and only the ones the Data Pool consumes.
-- Optional tables are granted when present so one script serves every Field
-- schema revision. The Data Pool never writes to Field tables.
GRANT SELECT ON TABLE projects, drill_holes TO geoeye_api;

-- `profiles` and the membership tables are read to sign users in and to limit each
-- user to the organizations and projects they belong to.
GRANT SELECT ON TABLE profiles TO geoeye_api;

DO $grant_field_sources$
DECLARE
  field_table TEXT;
BEGIN
  FOREACH field_table IN ARRAY ARRAY[
    'logging_structures', 'core_rows', 'dictionary_categories', 'dictionary_items',
    'organizations', 'organization_members', 'project_members',
    'logging_templates', 'logging_template_assignments', 'logging_row_selections',
    'logging_intervals', 'generated_logs', 'depth_registration_deletions'
  ]
  LOOP
    IF to_regclass('public.' || field_table) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO geoeye_api', field_table);
    END IF;
  END LOOP;
END
$grant_field_sources$;

ALTER ROLE geoeye_api SET statement_timeout = '30s';
ALTER ROLE geoeye_api SET idle_in_transaction_session_timeout = '30s';

COMMENT ON ROLE geoeye_api IS
  'Least-privilege login used only by the GeoEye Data Pool API. Password managed outside migrations.';
