import pg from "pg";
import { requireEnv } from "./env";

// Uso: npm run admin:grant -- email@dominio.com [superadmin|support|billing]
async function main() {
  const [email, role = "superadmin"] = process.argv.slice(2);
  if (!email || !["superadmin", "support", "billing"].includes(role)) {
    console.error("Uso: npm run admin:grant -- <email> [superadmin|support|billing]");
    process.exit(1);
  }
  const c = new pg.Client({ connectionString: requireEnv("DATABASE_URL_OWNER") });
  await c.connect();
  const u = await c.query("select id from saas.users where email = lower($1)", [email]);
  if (!u.rowCount) throw new Error("Usuário não encontrado. Crie a conta pela tela de cadastro primeiro.");
  await c.query(
    `insert into saas.platform_admins (user_id, role) values ($1, $2) on conflict (user_id) do update set role = excluded.role`,
    [u.rows[0].id, role]);
  await c.query(
    `insert into saas.audit_log (actor_type, action, entity_type, entity_id, metadata) values ('system', 'platform.admin_grant', 'user', $1, $2)`,
    [u.rows[0].id, JSON.stringify({ role })]);
  await c.end();
  console.log(`${email} agora é administrador da plataforma (${role}).`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
