-- Run once in the Supabase SQL editor after the database migrations.
-- Objects stay private; only a trusted server using the service-role credential
-- may upload or issue short-lived signed download URLs.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'geoeye-analysis-results',
  'geoeye-analysis-results',
  false,
  26214400,
  ARRAY['application/json', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Intentionally create no anon/authenticated storage.objects policy. The
-- bucket remains inaccessible from browser Supabase clients. Tenant/project
-- authorization belongs at the Data Pool API boundary.
