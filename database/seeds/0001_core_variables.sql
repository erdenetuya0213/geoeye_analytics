BEGIN;

INSERT INTO variable_definitions (
  key,
  display_name,
  description,
  data_type,
  canonical_unit,
  origin,
  spatial_support,
  compatible_analyses
)
VALUES
  ('structure.alpha', 'Alpha', 'Acute angle between the feature trace and the core axis.', 'numeric', 'deg', 'primary', 'orientation', ARRAY['structure.alpha_beta_conversion', 'structure.stereonet']),
  ('structure.beta', 'Beta', 'Rotation angle around the oriented core reference line.', 'numeric', 'deg', 'primary', 'orientation', ARRAY['structure.alpha_beta_conversion', 'structure.stereonet']),
  ('structure.apparent_angle', 'Apparent angle', 'Feature angle measured on the row image by GeoEye Field.', 'numeric', 'deg', 'primary', 'orientation', ARRAY['structure.quality_control']),
  ('structure.true_dip', 'True dip', 'True dip derived from an oriented observation and drillhole orientation.', 'numeric', 'deg', 'derived', 'orientation', ARRAY['structure.stereonet', 'structure.joint_sets']),
  ('structure.true_dip_direction', 'True dip direction', 'Dip direction derived from an oriented observation and drillhole orientation.', 'numeric', 'deg', 'derived', 'orientation', ARRAY['structure.stereonet', 'structure.joint_sets']),
  ('structure.joint_set', 'Joint set', 'Algorithmic joint-set population membership.', 'category', NULL, 'derived', 'orientation', ARRAY['structure.joint_sets', 'structure.domains']),
  ('joint.aperture', 'Joint aperture', 'Observed opening width of a joint.', 'numeric', 'mm', 'primary', 'point', ARRAY['geotechnical.rmr', 'structure.summary']),
  ('joint.roughness', 'Joint roughness', 'Observed roughness classification of a joint surface.', 'category', NULL, 'primary', 'point', ARRAY['geotechnical.rmr', 'structure.summary']),
  ('geotech.rqd', 'RQD', 'Rock Quality Designation over a logged interval.', 'numeric', '%', 'primary', 'interval', ARRAY['geotechnical.rqd', 'geotechnical.rmr']),
  ('geotech.ucs', 'UCS', 'Uniaxial compressive strength measurement.', 'numeric', 'MPa', 'primary', 'interval', ARRAY['geotechnical.rmr', 'geotechnical.domains']),
  ('geotech.rmr76', 'RMR76', '1976 Bieniawski Rock Mass Rating.', 'numeric', NULL, 'derived', 'interval', ARRAY['geotechnical.rmr', 'geotechnical.domains']),
  ('geotech.rmr76_class', 'RMR76 class', 'Rock-mass class derived from the 1976 Bieniawski Rock Mass Rating.', 'category', NULL, 'derived', 'interval', ARRAY['geotechnical.rmr', 'geotechnical.domains', 'domain']),
  ('geotech.rmr90', 'RMR90', '1990 Laubscher in-situ Rock Mass Rating before mining adjustments.', 'numeric', NULL, 'derived', 'interval', ARRAY['geotechnical.rmr', 'geotechnical.mrmr', 'geotechnical.domains']),
  ('geotech.mrmr90', 'MRMR90', 'Laubscher Mining Rock Mass Rating after weathering, orientation, stress, and blasting adjustments.', 'numeric', NULL, 'derived', 'interval', ARRAY['geotechnical.mrmr', 'geotechnical.domains']),
  ('geotech.q', 'Q-system index', 'Barton tunnelling quality index calculated from RQD, Jn, Jr, Ja, Jw, and SRF.', 'numeric', NULL, 'derived', 'interval', ARRAY['geotechnical.q', 'geotechnical.domains']),
  ('assay.au', 'Gold', 'Gold assay concentration.', 'numeric', 'g/t', 'integrated', 'interval', ARRAY['explore', 'grade', 'variography', 'domain']),
  ('assay.cu', 'Copper assay', 'Copper assay concentration.', 'numeric', '%', 'integrated', 'interval', ARRAY['explore', 'grade', 'variography', 'domain']),
  ('xrf.cu', 'Copper XRF', 'Copper concentration reported by an XRF integration.', 'numeric', 'ppm', 'integrated', 'point', ARRAY['explore', 'multivariate', 'domain'])
ON CONFLICT (key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  data_type = EXCLUDED.data_type,
  canonical_unit = EXCLUDED.canonical_unit,
  origin = EXCLUDED.origin,
  spatial_support = EXCLUDED.spatial_support,
  compatible_analyses = EXCLUDED.compatible_analyses;

UPDATE variable_definitions
SET metadata_json = '{"type":"bounded_ordinal_score","origin":"derived","method":"Bieniawski 1976"}'::jsonb
WHERE key = 'geotech.rmr76';

UPDATE variable_definitions
SET metadata_json = '{"origin":"derived","method":"Bieniawski 1976","source_variable":"geotech.rmr76"}'::jsonb
WHERE key = 'geotech.rmr76_class';

INSERT INTO observation_projection_bindings (
  project_id,
  source_entity_type,
  source_field,
  variable_id,
  extraction_json
)
SELECT
  NULL,
  'field.logging_structure',
  binding.source_field,
  variable.id,
  binding.extraction_json::jsonb
FROM (
  VALUES
    ('selections.alpha', 'structure.alpha', '{"kind":"selection","key":"alpha"}'),
    ('selections.beta', 'structure.beta', '{"kind":"selection","key":"beta"}'),
    ('selections.aperture', 'joint.aperture', '{"kind":"selection","key":"aperture"}'),
    ('selections.roughness', 'joint.roughness', '{"kind":"selection","key":"roughness"}'),
    -- Field ids used by the GeoEye Field structure templates in production.
    ('selections.alpha_to_core_axis_deg', 'structure.alpha', '{"kind":"selection","key":"alpha_to_core_axis_deg"}'),
    ('selections.beta_reference_deg', 'structure.beta', '{"kind":"selection","key":"beta_reference_deg"}'),
    ('selections.aperture_mm', 'joint.aperture', '{"kind":"selection","key":"aperture_mm"}'),
    ('angle_deg', 'structure.apparent_angle', '{"kind":"column","column":"angleDeg"}')
) AS binding(source_field, variable_key, extraction_json)
JOIN variable_definitions AS variable ON variable.key = binding.variable_key
ON CONFLICT DO NOTHING;

COMMIT;
