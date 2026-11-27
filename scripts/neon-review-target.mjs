import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// These pins bind the credential to the reviewed, time-limited Development clone.
export const target = Object.freeze({
  project: "tiny-rice-70320263",
  branch: "br-shiny-recipe-b61dmx4a",
  endpoint: "ep-fancy-cell-b6832gje",
  database: "iam_control_center",
  login: "iam_app_runtime_login",
  expires: "2026-11-28T12:23:00Z",
});
const host = target.endpoint + ".c-2.sa-east-1.aws.neon.tech";

export function checkLease(env, now = Date.now()) {
  if (env.NEON_REVIEW_BRANCH_ID !== target.branch || env.NEON_REVIEW_DATABASE !== target.database) {
    throw new Error("Review Environment branch or database differs from the reviewed target.");
  }
  if (!(now < Date.parse(target.expires))) throw new Error("Review branch lease expired.");
}

export function connectionEnv(raw) {
  // Build libpq parameters from trusted pins. Never forward arbitrary URI options.
  try {
    const uri = new URL(raw);
    const password = decodeURIComponent(uri.password);
    if (!["postgres:", "postgresql:"].includes(uri.protocol) ||
        uri.hostname !== host || (uri.port && uri.port !== "5432") ||
        uri.pathname !== "/" + target.database || uri.username !== target.login ||
        !password || /[\x00-\x1f\x7f]/.test(password) || uri.hash ||
        uri.searchParams.size !== 2 || uri.searchParams.get("sslmode") !== "verify-full" ||
        uri.searchParams.get("sslrootcert") !== "system") throw new Error();
    return {
      PGHOST: host, PGPORT: "5432", PGDATABASE: target.database, PGUSER: target.login,
      PGPASSWORD: password, PGSSLMODE: "verify-full", PGSSLROOTCERT: "system",
      PGCONNECT_TIMEOUT: "8", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=12000",
    };
  } catch {
    throw new Error("Invalid protected review connection.");
  }
}

function verify(env) {
  const pg = connectionEnv(env.NEON_REVIEW_DATABASE_URL);
  const sql = readFileSync(new URL("../.github/trusted/neon-review-role.sql", import.meta.url), "utf8");
  const args = ["run", "--rm", "-i"];
  for (const key of Object.keys(pg)) args.push("--env", key);
  args.push("iam-neon-review-client", "psql", "-XAtw", "--set=ON_ERROR_STOP=1",
    "--set=project=" + target.project, "--set=branch=" + target.branch,
    "--set=endpoint=" + target.endpoint, "--set=database=" + target.database,
    "--set=login=" + target.login);
  const result = spawnSync("docker", args, {
    input: sql, encoding: "utf8", timeout: 45000,
    env: { PATH: env.PATH, HOME: env.HOME, ...pg },
  });
  if (result.status !== 0 || result.stdout.trim() !== "t") {
    throw new Error("Direct TLS connection or authenticated catalog verification failed.");
  }
  console.log("Verified review branch, PostgreSQL 18, runtime roles and forced RLS metadata.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkLease(process.env);
    if (process.argv[2] === "--verify") verify(process.env);
    else if (process.argv[2] !== "--preflight") throw new Error("Unknown verification mode.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
