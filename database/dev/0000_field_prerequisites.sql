-- Stand-ins for tables owned by GeoEye Field. This file is for local disposable
-- databases only and must never be applied to an existing Field database.
--
-- Column names and types mirror the Field Hub schema (GeoEye Field
-- apps/edge-server Alembic migrations 0001-0009) for every column the Data Pool
-- reads, so local tests exercise the same SQL that runs against staging.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'geologist',
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  site_id TEXT NOT NULL DEFAULT 'geoeye-site',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS drill_holes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL DEFAULT 'geoeye-site',
  hole_name TEXT NOT NULL,
  collar_lat DOUBLE PRECISION,
  collar_lon DOUBLE PRECISION,
  UNIQUE (project_id, hole_name)
);

-- Field keeps drill-hole rows for synchronization history and records logical
-- deletions here. Analytics must treat matching rows as absent.
CREATE TABLE IF NOT EXISTS depth_registration_deletions (
  entity_type VARCHAR NOT NULL,
  entity_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID REFERENCES drill_holes(id) ON DELETE CASCADE,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS core_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID NOT NULL REFERENCES drill_holes(id) ON DELETE CASCADE,
  box_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS core_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID NOT NULL REFERENCES drill_holes(id) ON DELETE CASCADE,
  box_id UUID NOT NULL REFERENCES core_boxes(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  depth_from DOUBLE PRECISION,
  depth_to DOUBLE PRECISION,
  stage3_rqd_json JSONB,
  stage_status TEXT NOT NULL DEFAULT 'intake',
  stage3_accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS logging_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS dictionary_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dictionary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES dictionary_categories(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logging_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hole_id UUID REFERENCES drill_holes(id) ON DELETE SET NULL,
  row_id UUID NOT NULL REFERENCES core_rows(id) ON DELETE CASCADE,
  template_id UUID REFERENCES logging_templates(id) ON DELETE SET NULL,
  class_id TEXT NOT NULL,
  field_id TEXT,
  structure_type TEXT,
  geometry_type TEXT NOT NULL DEFAULT 'line',
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  depth_from DOUBLE PRECISION,
  depth_to DOUBLE PRECISION,
  angle_deg DOUBLE PRECISION,
  length_px DOUBLE PRECISION,
  selections_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'accepted', 'flagged')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
