// Local test database. It keeps its data in test-env/data and never touches production.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const databaseDir = path.join(import.meta.dirname, "data");
const isNew = !fs.existsSync(path.join(databaseDir, "PG_VERSION"));
const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "test", port: 5433, persistent: true });

if (isNew) await pg.initialise();
await pg.start();
if (isNew) await pg.createDatabase("gst_test");
console.log("Test database ready: postgresql://postgres:test@localhost:5433/gst_test");
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
