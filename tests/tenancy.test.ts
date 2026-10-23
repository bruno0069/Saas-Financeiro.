import { afterAll, describe, expect, it } from "vitest";
import { closePools, ownerPool } from "@/server/db/pool";
import { getSessionUser } from "@/server/auth/service";
import { createCompany } from "@/domains/tenants/service";
import { listTitles, createTitle } from "@/domains/finance/titles";
import { listAccounts } from "@/domains/finance/accounts";
import { as, categoryId, makeAccount, makeCompany, makeUser, rawApp } from "./helpers";

afterAll(closePools);

describe("criação de empresa (onboarding)", () => {
  it("cria empresa, vínculo de proprietário, categorias do segmento, módulos e assinatura de avaliação", async () => {
    const { owner, tenantId } = await makeCompany("Padaria Pão Quente");
    const db = ownerPool();
    const m = (await db.query("select role, status from saas.memberships where tenant_id = $1", [tenantId])).rows;
    expect(m).toEqual([{ role: "owner", status: "active" }]);
    const cats = (await db.query("select code from saas.categories where tenant_id = $1", [tenantId])).rows.map((r) => r.code);
    expect(cats).toContain("padaria.vendas_balcao");
    expect(cats).toContain("padaria.insumos");
    expect(cats).toContain("core.card_fees");
    const mods = (await db.query("select module_key from saas.tenant_modules where tenant_id = $1 and enabled", [tenantId])).rows.map((r) => r.module_key);
    expect(mods.sort()).toEqual(["padaria.caixa", "padaria.producao"]);
    const sub = (await db.query("select status, trial_ends_at from saas.subscriptions where tenant_id = $1", [tenantId])).rows[0];
    expect(sub.status).toBe("trialing");
    expect(new Date(sub.trial_ends_at).getTime()).toBeGreaterThan(Date.now());
    const ctxInfo = await as(owner, tenantId, async (ctx) => ({ role: ctx.role, access: ctx.access, plan: ctx.subscription?.plan_code }));
    expect(ctxInfo).toEqual({ role: "owner", access: "full", plan: "profissional" });
  });

  it("não deixa empresa parcialmente cadastrada quando há falha no meio do processo", async () => {
    const u = await makeUser("Falha");
    const su = (await getSessionUser(u.token))!;
    for (const step of ["membership", "categories"]) {
      await expect(createCompany(su, { tradeName: `Falha ${step}`, segment: "padaria" }, { failAfterStep: step })).rejects.toThrow(/simulada/);
    }
    const r = await ownerPool().query("select count(*)::int as n from saas.tenants where created_by = $1", [u.id]);
    expect(r.rows[0].n).toBe(0);
    // Após a falha, o usuário consegue concluir o cadastro normalmente.
    await createCompany(su, { tradeName: "Recuperada", segment: "padaria" });
    const r2 = await ownerPool().query("select count(*)::int as n from saas.tenants where created_by = $1", [u.id]);
    expect(r2.rows[0].n).toBe(1);
  });

  it("exige e-mail confirmado para cadastrar empresa", async () => {
    const u = await makeUser("Sem verificação", false);
    const su = (await getSessionUser(u.token))!;
    await expect(createCompany(su, { tradeName: "Não pode", segment: "padaria" })).rejects.toThrow(/Confirme seu e-mail/);
  });

  it("valida CNPJ", async () => {
    const u = await makeUser();
    const su = (await getSessionUser(u.token))!;
    await expect(createCompany(su, { tradeName: "CNPJ ruim", segment: "padaria", taxId: "11.111.111/1111-11" })).rejects.toThrow(/CNPJ/);
    await expect(createCompany(su, { tradeName: "CNPJ bom", segment: "padaria", taxId: "11.222.333/0001-81" })).resolves.toBeTruthy();
  });
});

describe("isolamento multi-tenant", () => {
  it("serviços só enxergam os dados do tenant autenticado", async () => {
    const a = await makeCompany("Empresa A");
    const b = await makeCompany("Empresa B");
    await makeAccount(a.owner, a.tenantId, "Banco A", 1000_00);
    await makeAccount(b.owner, b.tenantId, "Banco B", 5000_00);
    const accA = await as(a.owner, a.tenantId, (ctx) => listAccounts(ctx));
    expect(accA.map((x) => x.name)).toEqual(["Banco A"]);
    // Dono de A tentando abrir o tenant B (ex.: alterando o identificador no cookie/requisição).
    await expect(as(a.owner, b.tenantId, (ctx) => listAccounts(ctx))).rejects.toThrow(/sem acesso/);
  });

  it("RLS: trocar app.tenant_id para outra empresa não revela nem grava dados", async () => {
    const a = await makeCompany("RLS A");
    const b = await makeCompany("RLS B");
    await makeAccount(b.owner, b.tenantId, "Segredo B", 777_00);
    await rawApp(a.owner.token, b.tenantId, async (c) => {
      expect((await c.query("select saas.current_tenant_id() as t")).rows[0].t).toBeNull();
      expect((await c.query("select count(*)::int as n from saas.financial_accounts")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int as n from saas.cash_movements")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int as n from saas.categories")).rows[0].n).toBe(0);
      await expect(c.query(
        "insert into saas.contacts (tenant_id, name, kind) values ($1, 'Invasor', 'customer')", [b.tenantId])).rejects.toThrow(/row-level security/);
    });
  });

  it("RLS: dentro do próprio tenant, não é possível gravar com tenant_id de outra empresa", async () => {
    const a = await makeCompany("RLS C");
    const b = await makeCompany("RLS D");
    await rawApp(a.owner.token, a.tenantId, async (c) => {
      expect((await c.query("select count(*)::int as n from saas.categories")).rows[0].n).toBeGreaterThan(0);
      await expect(c.query(
        "insert into saas.contacts (tenant_id, name, kind) values ($1, 'Invasor', 'customer')", [b.tenantId])).rejects.toThrow(/row-level security/);
    });
    await rawApp(a.owner.token, a.tenantId, async (c) => {
      const r = await c.query("update saas.categories set name = 'hack' where tenant_id = $1", [b.tenantId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("RLS: sem sessão válida nada é visível; token inválido não autentica", async () => {
    const a = await makeCompany("RLS E");
    await rawApp(null, a.tenantId, async (c) => {
      expect((await c.query("select count(*)::int as n from saas.tenants")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int as n from saas.users")).rows[0].n).toBe(0);
    });
    await rawApp("token-forjado", a.tenantId, async (c) => {
      expect((await c.query("select saas.current_user_id() as u")).rows[0].u).toBeNull();
      expect((await c.query("select count(*)::int as n from saas.categories")).rows[0].n).toBe(0);
    });
  });

  it("RLS: papel da aplicação não lê hashes de senha nem sessões", async () => {
    const a = await makeCompany("RLS F");
    await rawApp(a.owner.token, a.tenantId, async (c) => {
      await expect(c.query("select password_hash from saas.users")).rejects.toThrow(/permission denied/);
    });
    await rawApp(a.owner.token, a.tenantId, async (c) => {
      await expect(c.query("select * from saas.sessions")).rejects.toThrow(/permission denied/);
    });
  });

  it("chaves compostas impedem referência a registros de outro tenant (mesmo no contexto de sistema)", async () => {
    const a = await makeCompany("FK A");
    const b = await makeCompany("FK B");
    const catB = await categoryId(b.tenantId, "padaria.insumos");
    await expect(ownerPool().query(
      `insert into saas.titles (tenant_id, direction, description, category_id, amount_cents, due_date)
       values ($1, 'payable', 'cruzado', $2, 100, current_date)`, [a.tenantId, catB])).rejects.toThrow(/foreign key/);
    // Pelo serviço: categoria de outro tenant é tratada como inexistente.
    await expect(as(a.owner, a.tenantId, (ctx) => createTitle(ctx, {
      direction: "payable", description: "x", categoryId: catB, amount: "10,00", dueDate: ctx.today,
    }))).rejects.toThrow(/Categoria não encontrada/);
  });

  it("relatórios e listagens não incluem dados de outro tenant", async () => {
    const a = await makeCompany("Rel A");
    const b = await makeCompany("Rel B");
    for (const t of [a, b]) {
      const cat = await categoryId(t.tenantId, "padaria.insumos");
      await as(t.owner, t.tenantId, (ctx) => createTitle(ctx, { direction: "payable", description: `Farinha ${t.tenantId}`, categoryId: cat, amount: "100", dueDate: ctx.today }));
    }
    const list = await as(a.owner, a.tenantId, (ctx) => listTitles(ctx, { direction: "payable", status: "all" }));
    expect(list).toHaveLength(1);
    expect(list[0].description).toContain(a.tenantId);
  });
});
