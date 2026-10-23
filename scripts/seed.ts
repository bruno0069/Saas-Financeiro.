import "./env";
import { ownerPool, closePools } from "../src/server/db/pool";
import { signup, getSessionUser } from "../src/server/auth/service";
import { createCompany } from "../src/domains/tenants/service";
import { runInTenant } from "../src/server/context";
import { createAccount } from "../src/domains/finance/accounts";
import { createTitle } from "../src/domains/finance/titles";
import { categoryIdByCode } from "../src/domains/finance/categories";
import { saveSettings, createClosing } from "../src/domains/padaria/caixa";
import { saveIngredient, saveProduct } from "../src/domains/padaria/producao";
import { addDays } from "../src/lib/dates";

/**
 * Dados FICTÍCIOS para desenvolvimento/demonstração. Nunca execute em produção.
 * Cria: dono@demo.local / admin@demo.local (senha: demonstracao123) e a "Padaria Demonstração".
 */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed de demonstração não pode rodar em produção.");
  const password = "demonstracao123";
  const db = ownerPool();
  const ensureUser = async (name: string, email: string) => {
    const ex = await db.query("select id from saas.users where email = $1", [email]);
    if (ex.rowCount) return null;
    const r = await signup({ name, email, password }, { ip: "seed" });
    await db.query("update saas.users set email_verified_at = now() where id = $1", [r.userId]);
    return r;
  };
  const admin = await ensureUser("Admin Plataforma", "admin@demo.local");
  if (admin) await db.query("insert into saas.platform_admins (user_id, role) values ($1, 'superadmin')", [admin.userId]);
  const owner = await ensureUser("Maria Padeira", "dono@demo.local");
  if (!owner) {
    console.log("Dados de demonstração já existem.");
    return;
  }
  const su = (await getSessionUser(owner.sessionToken))!;
  const tenantId = await createCompany(su, { tradeName: "Padaria Demonstração", segment: "padaria" });
  await runInTenant({ sessionToken: owner.sessionToken, tenantId }, async (ctx) => {
    const t = ctx.today;
    const start = addDays(t, -40);
    const caixa = await createAccount(ctx, { name: "Caixa da loja", kind: "cash", openingBalance: "300,00", openingDate: start });
    const banco = await createAccount(ctx, { name: "Banco do Bairro", kind: "checking", openingBalance: "8.500,00", openingDate: start });
    const cartoes = await createAccount(ctx, { name: "Recebíveis de cartão", kind: "card_receivables", openingBalance: "0", openingDate: start });
    await saveSettings(ctx, { pixAccountId: banco, cardAccountId: cartoes, safeAccountId: banco, debitDays: 1, creditDays: 30, voucherDays: 30,
      debitFeePct: 1.5, creditFeePct: 3.5, voucherFeePct: 5 });
    const cat = (c: string) => categoryIdByCode(ctx, c);
    await createTitle(ctx, { direction: "payable", description: "Aluguel do ponto", categoryId: await cat("core.rent"), amount: "2.800,00", dueDate: addDays(t, 5) });
    await createTitle(ctx, { direction: "payable", description: "Farinha de trigo — 20 sacos", categoryId: await cat("padaria.insumos"), amount: "2.400,00", dueDate: addDays(t, 10), installments: 2 });
    await createTitle(ctx, { direction: "payable", description: "Energia elétrica", categoryId: await cat("core.energy"), amount: "980,00", dueDate: addDays(t, -2) });
    await createTitle(ctx, { direction: "payable", description: "Gás (botijões P45)", categoryId: await cat("padaria.gas"), amount: "640,00", dueDate: addDays(t, -6),
      settleNow: { accountId: banco, date: addDays(t, -6), method: "pix" } });
    await createTitle(ctx, { direction: "receivable", description: "Encomenda — festa de aniversário", categoryId: await cat("padaria.encomendas"), amount: "450,00", dueDate: addDays(t, 3) });
    for (let i = 7; i >= 1; i--) {
      const base = 1400 + ((i * 137) % 400);
      await createClosing(ctx, {
        closingDate: addDays(t, -i), registerName: "Caixa 1", registerAccountId: caixa, openingFloat: "200,00",
        cashSales: (base * 0.35).toFixed(2).replace(".", ","), pixSales: `${Math.round(base * 0.3)}`, debitSales: `${Math.round(base * 0.2)}`,
        creditSales: `${Math.round(base * 0.1)}`, voucherSales: `${Math.round(base * 0.05)}`, withdrawals: "300,00",
        countedCash: `${(200 + base * 0.35 - 300 - (i % 3 === 0 ? 7.5 : 0)).toFixed(2)}`.replace(".", ","), ticketCount: 120 + i * 9,
      });
    }
    const farinha = await saveIngredient(ctx, { name: "Farinha de trigo", unit: "kg", packQuantity: "25", packCost: "120,00" });
    const fermento = await saveIngredient(ctx, { name: "Fermento biológico", unit: "kg", packQuantity: "0,5", packCost: "14,00" });
    const sal = await saveIngredient(ctx, { name: "Sal", unit: "kg", packQuantity: "1", packCost: "3,50" });
    await saveProduct(ctx, { name: "Pão francês", saleUnit: "un", salePrice: "0,90", yieldQuantity: "120",
      items: [{ ingredientId: farinha, quantity: "6" }, { ingredientId: fermento, quantity: "0,12" }, { ingredientId: sal, quantity: "0,12" }] });
  });
  console.log("Dados de demonstração criados.\n  Cliente: dono@demo.local / demonstracao123\n  Admin:   admin@demo.local / demonstracao123");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(closePools);
