-- Runs inside each organisation's schema (search_path is set by the migrator),
-- so table names are unqualified. Add your own per-tenant tables in new files.

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
