import { runMigrations } from "../src/server/db/migrate";
import { requireEnv } from "./env";

runMigrations(requireEnv("DATABASE_URL_OWNER")).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
