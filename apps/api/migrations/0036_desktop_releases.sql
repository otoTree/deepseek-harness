CREATE TABLE enterprise_auth.desktop_release (
  id text PRIMARY KEY,
  target text NOT NULL CHECK (target IN ('darwin-arm64', 'win32-x64')),
  version text NOT NULL,
  envelope text NOT NULL,
  object_key text,
  submitted_by text NOT NULL REFERENCES enterprise_auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK ((published_at IS NULL) = (object_key IS NULL))
);
CREATE INDEX desktop_release_target ON enterprise_auth.desktop_release(target, published_at);
CREATE UNIQUE INDEX desktop_release_published_version ON enterprise_auth.desktop_release(target, version) WHERE published_at IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON enterprise_auth.desktop_release TO enterprise_app;
