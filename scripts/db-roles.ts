import pg from "pg";
import { requireEnv } from "./env";

// Habilita login do papel da aplicação (criado sem login pela migração 0001) com a senha do ambiente.
// Execute após `db:migrate`. Exige que DATABASE_URL_OWNER tenha CREATEROLE.
async function main() {
  const owner = requireEnv("DATABASE_URL_OWNER");
  const appUrl = new URL(requireEnv("DATABASE_URL"));
  const password = decodeURIComponent(appUrl.password);
  if (appUrl.username !== "saas_app") throw new Error("DATABASE_URL deve usar o usuário saas_app");
  if (password.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres para saas_app");
  const client = new pg.Client({ connectionString: owner });
  await client.connect();
  try {
    const ident = await client.query("select format('alter role saas_app login password %L', $1::text) as sql", [password]);
    await client.query(ident.rows[0].sql);
    await client.query("alter role saas_app set search_path = saas, public");
    console.log("Papel saas_app habilitado para login.");
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
