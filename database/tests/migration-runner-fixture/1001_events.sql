CREATE TABLE iam_runner_fixture.events (
  id integer PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES iam_runner_fixture.tenants(id)
);
ALTER TABLE iam_runner_fixture.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam_runner_fixture.events FORCE ROW LEVEL SECURITY;
GRANT SELECT ON iam_runner_fixture.events TO iam_app_runtime;
