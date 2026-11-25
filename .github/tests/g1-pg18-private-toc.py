"""Exercise the G1 client's private TOC mount on a loopback-only PG18 fixture."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time


def main(container):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("g1", root / "scripts/iam-g1-full-restore.py")
    g1 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g1)

    def admin(*args):
        return subprocess.check_output(["docker", "exec", container, *args])

    for _ in range(60):
        # TCP is available only after the image finishes its bootstrap server.
        if subprocess.run(["docker", "exec", container, "pg_isready", "-q",
                           "-h", "127.0.0.1", "-U", "postgres"]).returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Local PG18 fixture did not become ready")

    port = subprocess.check_output(["docker", "port", container, "5432/tcp"], text=True).strip()
    host, port = port.split(":")
    assert host == "127.0.0.1" and port.isdecimal()
    admin("psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
          "CREATE ROLE cloud_admin; CREATE ROLE sample_reader; "
          "CREATE ROLE fixture_owner LOGIN PASSWORD 'synthetic-owner';")
    for db in ("fixture_source", g1.TARGET_DATABASE):
        admin("createdb", "-U", "postgres", "-O", "fixture_owner", db)
        admin("psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-c",
              "ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public "
              "GRANT SELECT ON TABLES TO sample_reader; "
              "ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public "
              "GRANT USAGE ON SEQUENCES TO sample_reader;")
    admin("psql", "-U", "postgres", "-d", "fixture_source", "-v", "ON_ERROR_STOP=1", "-c",
          "SET ROLE fixture_owner; ALTER DEFAULT PRIVILEGES IN SCHEMA public "
          "GRANT SELECT ON TABLES TO sample_reader; CREATE TABLE sample(id int); "
          "INSERT INTO sample VALUES (42);")
    archive = admin("pg_dump", "-U", "postgres", "-Fc", "fixture_source")
    env = dict(os.environ, PGHOST=host, PGPORT=port, PGDATABASE=g1.TARGET_DATABASE,
               PGUSER="fixture_owner", PGPASSWORD="synthetic-owner")
    listing = g1.pg18(["pg_restore", "--list"], env, data=archive)
    filtered = g1.filtered_cloud_admin_toc(listing)
    provider_defaults = g1.cloud_admin_defaults(env)
    assert provider_defaults.startswith("2|")
    g1.apply_filtered_restore(archive, env, filtered)
    assert g1.cloud_admin_defaults(env) == provider_defaults
    assert g1.sql(env, "SELECT id FROM sample") == "42"
    assert g1.sql(env, "SELECT count(*) FROM pg_default_acl WHERE "
                       "defaclrole='fixture_owner'::regrole AND defaclnamespace='public'::regnamespace "
                       "AND defaclobjtype='r'") == "1"
    assert not (Path(env["RUNNER_TEMP"]) / "iam-g1-filtered-toc.list").exists()
    print("PASS: PG18 synthetic restore, provider and application defaults, row and TOC cleanup")


if __name__ == "__main__":
    main(sys.argv[1])
