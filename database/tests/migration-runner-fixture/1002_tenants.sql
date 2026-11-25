CREATE TABLE iam_runner_fixture.tenants (id integer PRIMARY KEY);
ALTER TABLE iam_runner_fixture.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam_runner_fixture.tenants FORCE ROW LEVEL SECURITY;
GRANT SELECT ON iam_runner_fixture.tenants TO iam_app_runtime;
