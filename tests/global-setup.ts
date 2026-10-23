import pg from "pg";
import { runMigrations } from "../src/server/db/migrate";
import { TEST_ENV } from "./test-env";

/** Recria o esquema do banco de testes do zero e aplica todas as migrações. */
export default async function setup() {
  const db = new URL(TEST_ENV.DATABASE_URL_OWNER).pathname.slice(1);
  if (!/test/.test(db)) throw new Error(`Recusando-se a limpar um banco que não parece de testes: ${db}`);
  const c = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL_OWNER });
  await c.connect();
  await c.query("drop schema if exists saas cascade; drop table if exists public.schema_migrations;");
  await c.end();
  await runMigrations(TEST_ENV.DATABASE_URL_OWNER, () => {});
  const c2 = new pg.Client({ connectionString: TEST_ENV.DATABASE_URL_OWNER });
  await c2.connect();
  const pw = decodeURIComponent(new URL(TEST_ENV.DATABASE_URL).password);
  const sql = (await c2.query("select format('alter role saas_app login password %L', $1::text) as s", [pw])).rows[0].s;
  await c2.query(sql);
  await c2.end();
}
