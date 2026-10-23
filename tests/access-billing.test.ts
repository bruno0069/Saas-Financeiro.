import { afterAll, describe, expect, it } from "vitest";
import { closePools, ownerPool } from "@/server/db/pool";
import { getSessionUser, login, signup } from "@/server/auth/service";
import { inviteUser, listMembers, removeMember, transferOwnership, updateMember, acceptInvite } from "@/domains/access/members";
import { createTitle, settleTitle } from "@/domains/finance/titles";
import { createAccount } from "@/domains/finance/accounts";
import { createContact } from "@/domains/finance/contacts";
import { setModuleEnabled } from "@/domains/tenants/service";
import { exportTenantData } from "@/domains/lgpd/service";
import { canTransition, TRANSITIONS, SUBSCRIPTION_STATUSES, assertTransition } from "@/domains/billing/state-machine";
import { changePlan, currentSubscriptionId, runBillingCycle, cancelSubscription } from "@/domains/billing/subscriptions";
import { handleAsaasWebhook } from "@/domains/billing/providers";
import { metrics, runAsAdmin, enterSupport, tenantDetail } from "@/domains/admin/service";
import { grantSupport } from "@/domains/access/support";
import { listAccounts } from "@/domains/finance/accounts";
import { as, addMember, categoryId, ip, makeAccount, makeCompany, makeUser, rawApp, setSubscriptionStatus } from "./helpers";

afterAll(closePools);

async function planId(code: string) {
  return (await ownerPool().query("select id from saas.plans where code = $1", [code])).rows[0].id as string;
}

describe("autenticação", () => {
  it("senha é armazenada com hash e login inválido é genérico", async () => {
    const email = `auth-${Date.now()}@teste.local`;
    await signup({ name: "Auth", email, password: "senha-muito-segura-1" }, { ip: ip() });
    const row = (await ownerPool().query("select password_hash from saas.users where email = $1", [email])).rows[0];
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain("senha-muito-segura-1");
    await expect(login({ email, password: "errada-errada" }, { ip: ip() })).rejects.toThrow("E-mail ou senha incorretos.");
    await expect(login({ email: "naoexiste@teste.local", password: "x" }, { ip: ip() })).rejects.toThrow("E-mail ou senha incorretos.");
    const ok = await login({ email, password: "senha-muito-segura-1" }, { ip: ip() });
    expect((await getSessionUser(ok.sessionToken))!.email).toBe(email);
  });

  it("limita tentativas de login por e-mail", async () => {
    const email = `rl-${Date.now()}@teste.local`;
    let last: unknown;
    for (let i = 0; i < 12; i++) {
      last = await login({ email, password: "x" }, { ip: ip() }).catch((e) => e);
    }
    expect(String(last)).toMatch(/Muitas tentativas/);
  });
});

describe("usuários e permissões", () => {
  it("operador não lança contas a pagar nem registra pagamentos; financeiro sim", async () => {
    const { owner, tenantId } = await makeCompany("Perm A");
    const op = await addMember(owner, tenantId, "operator");
    const fin = await addMember(owner, tenantId, "finance");
    const cat = await categoryId(tenantId, "padaria.insumos");
    const bank = await makeAccount(owner, tenantId, "Banco", 1000_00);
    await expect(as(op, tenantId, (ctx) => createTitle(ctx, { direction: "payable", description: "x", categoryId: cat, amount: "10", dueDate: ctx.today })))
      .rejects.toThrow(/permissão/);
    const [id] = await as(fin, tenantId, (ctx) => createTitle(ctx, { direction: "payable", description: "Farinha", categoryId: cat, amount: "10", dueDate: ctx.today }));
    await expect(as(op, tenantId, (ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "10", date: ctx.today }))).rejects.toThrow(/permissão/);
    await as(fin, tenantId, (ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "10", date: ctx.today }));
    // Tentativa negada não deixa rastro de dados; operador pode cadastrar contatos.
    await as(op, tenantId, (ctx) => createContact(ctx, { name: "Cliente balcão", kind: "customer" }));
  });

  it("usuário não consegue atribuir privilégios a si mesmo (serviço e banco)", async () => {
    const { owner, tenantId } = await makeCompany("Perm B");
    const mgr = await addMember(owner, tenantId, "manager");
    const op = await addMember(owner, tenantId, "operator");
    const myId = (await ownerPool().query("select id from saas.memberships where user_id = $1", [mgr.id])).rows[0].id;
    // Gerente não tem users.manage.
    await expect(as(mgr, tenantId, (ctx) => updateMember(ctx, { membershipId: myId, role: "finance" }))).rejects.toThrow(/permissão/);
    // Mesmo via SQL direto: a política RLS bloqueia a atualização do próprio vínculo.
    await rawApp(mgr.token, tenantId, async (c) => {
      const r = await c.query("update saas.memberships set role = 'owner', permissions = '{users.manage}' where id = $1", [myId]);
      expect(r.rowCount).toBe(0);
    });
    // Concedendo users.manage ao gerente: ainda não pode alterar a si nem dar permissões que não tem.
    await as(owner, tenantId, (ctx) => updateMember(ctx, { membershipId: myId, role: "manager", extraPermissions: ["users.manage"] }));
    await rawApp(mgr.token, tenantId, async (c) => {
      await expect(c.query("update saas.memberships set role = 'finance' where id = $1", [myId])).rejects.toThrow(/próprio vínculo/);
    });
    const opId = (await ownerPool().query("select id from saas.memberships where user_id = $1", [op.id])).rows[0].id;
    await expect(as(mgr, tenantId, (ctx) => updateMember(ctx, { membershipId: opId, role: "operator", extraPermissions: ["movements.adjust"] })))
      .rejects.toThrow(/não possui/);
    await rawApp(mgr.token, tenantId, async (c) => {
      await expect(c.query("update saas.memberships set permissions = '{movements.adjust}' where id = $1", [opId])).rejects.toThrow(/não possui/);
    });
    await rawApp(mgr.token, tenantId, async (c) => {
      await expect(c.query("update saas.memberships set role = 'owner' where id = $1", [opId])).rejects.toThrow(/proprietário/);
    });
  });

  it("convite só pode ser aceito pela conta do e-mail convidado", async () => {
    const { owner, tenantId } = await makeCompany("Convite");
    const target = await makeUser("Convidado");
    const intruder = await makeUser("Intruso");
    const inv = await as(owner, tenantId, (ctx) => inviteUser(ctx, { email: target.email, role: "operator" }));
    const token = inv.link.split("/invite/")[1];
    await expect(acceptInvite((await getSessionUser(intruder.token))!, token)).rejects.toThrow(/enviado para/);
    await acceptInvite((await getSessionUser(target.token))!, token);
    await expect(acceptInvite((await getSessionUser(target.token))!, token)).rejects.toThrow(/inválido/);
  });

  it("remover usuário preserva os registros que ele criou", async () => {
    const { owner, tenantId } = await makeCompany("Remoção");
    const fin = await addMember(owner, tenantId, "finance");
    const cat = await categoryId(tenantId, "padaria.insumos");
    const [id] = await as(fin, tenantId, (ctx) => createTitle(ctx, { direction: "payable", description: "Criado pelo financeiro", categoryId: cat, amount: "10", dueDate: ctx.today }));
    const mid = (await ownerPool().query("select id from saas.memberships where user_id = $1", [fin.id])).rows[0].id;
    await as(owner, tenantId, (ctx) => removeMember(ctx, mid));
    await expect(as(fin, tenantId, async () => 1)).rejects.toThrow(/sem acesso/);
    const t = (await ownerPool().query("select created_by from saas.titles where id = $1", [id])).rows[0];
    expect(t.created_by).toBe(fin.id);
  });

  it("transferência de propriedade exige confirmação e mantém um único proprietário", async () => {
    const { owner, tenantId } = await makeCompany("Sucessão");
    const mgr = await addMember(owner, tenantId, "manager");
    const mid = (await ownerPool().query("select id from saas.memberships where user_id = $1", [mgr.id])).rows[0].id;
    await expect(as(owner, tenantId, (ctx) => transferOwnership(ctx, { membershipId: mid, confirmName: "errado" }))).rejects.toThrow(/Digite/);
    await as(owner, tenantId, (ctx) => transferOwnership(ctx, { membershipId: mid, confirmName: "Sucessão" }));
    const roles = (await ownerPool().query("select user_id, role from saas.memberships where tenant_id = $1 order by role", [tenantId])).rows;
    expect(roles).toEqual(expect.arrayContaining([{ user_id: mgr.id, role: "owner" }, { user_id: owner.id, role: "manager" }]));
  });
});

describe("planos, limites e funcionalidades (aplicados no servidor)", () => {
  it("limite de contas financeiras do plano", async () => {
    const { owner, tenantId } = await makeCompany("Limite contas");
    await changePlan((await currentSubscriptionId(ownerPool() as never, tenantId))!, await planId("essencial"), "monthly", { type: "system" });
    for (let i = 0; i < 3; i++) await makeAccount(owner, tenantId, `Conta ${i}`);
    await expect(makeAccount(owner, tenantId, "Conta 4")).rejects.toThrow(/Limite do plano/);
  });

  it("limite de usuários considera convites pendentes", async () => {
    const { owner, tenantId } = await makeCompany("Limite usuários");
    await changePlan((await currentSubscriptionId(ownerPool() as never, tenantId))!, await planId("essencial"), "monthly", { type: "system" });
    await as(owner, tenantId, (ctx) => inviteUser(ctx, { email: "a@teste.local", role: "operator" }));
    await expect(as(owner, tenantId, (ctx) => inviteUser(ctx, { email: "b@teste.local", role: "operator" }))).rejects.toThrow(/Limite do plano/);
    const m = await as(owner, tenantId, (ctx) => listMembers(ctx));
    expect(m.maxUsers).toBe(2);
  });

  it("módulo não contratado não pode ser habilitado nem usado", async () => {
    const { owner, tenantId } = await makeCompany("Sem produção");
    await changePlan((await currentSubscriptionId(ownerPool() as never, tenantId))!, await planId("essencial"), "monthly", { type: "system" });
    const state = await as(owner, tenantId, async (ctx) => ctx.modules.find((m) => m.def.key === "padaria.producao"));
    expect(state).toMatchObject({ entitled: false, available: false });
    await expect(as(owner, tenantId, (ctx) => setModuleEnabled(ctx, "padaria.producao", true))).rejects.toThrow(/plano/);
    const { listProducts } = await import("@/domains/padaria/producao");
    await expect(as(owner, tenantId, (ctx) => listProducts(ctx))).rejects.toThrow(/não está incluído no plano/);
  });

  it("downgrade é bloqueado quando o uso excede os limites do novo plano", async () => {
    const { owner, tenantId } = await makeCompany("Downgrade");
    for (let i = 0; i < 4; i++) await makeAccount(owner, tenantId, `C${i}`);
    const sub = (await currentSubscriptionId(ownerPool() as never, tenantId))!;
    await expect(changePlan(sub, await planId("essencial"), "monthly", { type: "user", userId: owner.id })).rejects.toThrow(/conta\(s\) financeira/);
  });

  it("override administrativo concede funcionalidade fora do plano", async () => {
    const { owner, tenantId } = await makeCompany("Override");
    await changePlan((await currentSubscriptionId(ownerPool() as never, tenantId))!, await planId("essencial"), "monthly", { type: "system" });
    await ownerPool().query("insert into saas.tenant_feature_overrides (tenant_id, feature_key, enabled, reason) values ($1, 'module.padaria.producao', true, 'cortesia')", [tenantId]);
    const s = await as(owner, tenantId, async (ctx) => ctx.modules.find((m) => m.def.key === "padaria.producao")!.entitled);
    expect(s).toBe(true);
  });
});

describe("máquina de estados e ciclo de cobrança", () => {
  it("define transições válidas e rejeita as inválidas", () => {
    expect(canTransition("trialing", "active")).toBe(true);
    expect(canTransition("ended", "active")).toBe(false);
    expect(canTransition("active", "trialing")).toBe(false);
    expect(() => assertTransition("suspended", "past_due")).toThrow(/inválida/);
    for (const s of SUBSCRIPTION_STATUSES) for (const t of TRANSITIONS[s]) expect(SUBSCRIPTION_STATUSES).toContain(t);
  });

  it("avaliação → aguardando pagamento → em atraso → suspensa (somente leitura) → pagamento → ativa", async () => {
    const { owner, tenantId } = await makeCompany("Ciclo");
    const bank = await makeAccount(owner, tenantId, "Banco", 100_00);
    await ownerPool().query("update saas.subscriptions set trial_ends_at = now() - interval '1 day', current_period_end = now() - interval '1 day' where tenant_id = $1", [tenantId]);
    await runBillingCycle(new Date());
    const status = async () => (await ownerPool().query("select status from saas.subscriptions where tenant_id = $1 and status <> 'ended'", [tenantId])).rows[0].status;
    expect(await status()).toBe("pending_payment");
    const inv = (await ownerPool().query("select id, status, due_date from saas.invoices where tenant_id = $1", [tenantId])).rows;
    expect(inv).toHaveLength(1);
    // Rodar de novo não duplica fatura.
    await runBillingCycle(new Date());
    expect((await ownerPool().query("select count(*)::int as n from saas.invoices where tenant_id = $1", [tenantId])).rows[0].n).toBe(1);
    // Vencimento passou.
    await runBillingCycle(new Date(Date.now() + 10 * 86400000));
    expect(await status()).toBe("past_due");
    // Em atraso ainda permite operar (carência).
    await makeAccount(owner, tenantId, "Caixa carência");
    await runBillingCycle(new Date(Date.now() + 40 * 86400000));
    expect(await status()).toBe("suspended");
    // Suspensa: leitura sim, escrita não — no serviço e no banco.
    const accounts = await as(owner, tenantId, (ctx) => listAccounts(ctx));
    expect(accounts.length).toBe(2);
    await expect(makeAccount(owner, tenantId, "Nova")).rejects.toThrow(/somente leitura/);
    await rawApp(owner.token, tenantId, async (c) => {
      await expect(c.query("insert into saas.contacts (tenant_id, name, kind) values ($1, 'x', 'customer')", [tenantId])).rejects.toThrow(/row-level security/);
    });
    // Exportação continua disponível e os dados não foram apagados.
    const exp = await as(owner, tenantId, (ctx) => exportTenantData(ctx));
    expect((exp.data.financial_accounts as unknown[]).length).toBe(2);
    void bank;
    // Webhook de pagamento confirmado reativa.
    const body = JSON.stringify({ id: `evt_${inv[0].id}`, event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: inv[0].id, value: 99.9, billingType: "PIX", paymentDate: "2026-01-01" } });
    const res = await handleAsaasWebhook(new Headers({ "asaas-access-token": "test-webhook-token" }), body);
    expect(res).toEqual({ status: 200, body: "processed" });
    expect(await status()).toBe("active");
    await makeAccount(owner, tenantId, "Pós pagamento");
  });

  it("webhook: token inválido é rejeitado e eventos duplicados não são reprocessados", async () => {
    const { tenantId } = await makeCompany("Webhook");
    await ownerPool().query("update saas.subscriptions set current_period_end = now() - interval '1 day' where tenant_id = $1", [tenantId]);
    await runBillingCycle(new Date());
    const inv = (await ownerPool().query("select id from saas.invoices where tenant_id = $1", [tenantId])).rows[0];
    const body = JSON.stringify({ id: `evt_dup_${inv.id}`, event: "PAYMENT_CONFIRMED", payment: { id: "pay_dup", externalReference: inv.id, value: 99.9 } });
    expect((await handleAsaasWebhook(new Headers({ "asaas-access-token": "errado" }), body)).status).toBe(401);
    expect((await handleAsaasWebhook(new Headers(), body)).status).toBe(401);
    const h = new Headers({ "asaas-access-token": "test-webhook-token" });
    const results = await Promise.all([handleAsaasWebhook(h, body), handleAsaasWebhook(h, body), handleAsaasWebhook(h, body)]);
    expect(results.filter((r) => r.body === "processed")).toHaveLength(1);
    expect(results.filter((r) => r.body === "duplicate")).toHaveLength(2);
    const events = (await ownerPool().query("select count(*)::int as n from saas.subscription_events s join saas.subscriptions x on x.id = s.subscription_id where x.tenant_id = $1 and s.to_status = 'active'", [tenantId])).rows[0].n;
    expect(events).toBe(1);
  });

  it("cancelamento mantém acesso até o fim do período e depois encerra sem apagar dados", async () => {
    const { owner, tenantId } = await makeCompany("Cancelamento");
    await makeAccount(owner, tenantId, "Banco", 50_00);
    const sub = (await currentSubscriptionId(ownerPool() as never, tenantId))!;
    await cancelSubscription(sub, { type: "user", userId: owner.id }, "Fechando a loja");
    expect(await as(owner, tenantId, async (ctx) => ctx.access)).toBe("full");
    await runBillingCycle(new Date(Date.now() + 30 * 86400000));
    const st = (await ownerPool().query("select status from saas.subscriptions where id = $1", [sub])).rows[0].status;
    expect(st).toBe("ended");
    expect(await as(owner, tenantId, async (ctx) => ctx.access)).toBe("read_only");
    expect((await as(owner, tenantId, (ctx) => listAccounts(ctx))).length).toBe(1);
  });
});

describe("administração da plataforma", () => {
  it("rotas administrativas exigem administrador", async () => {
    const u = await makeUser("Comum");
    await expect(runAsAdmin(u.token, null, (a) => metrics(a))).rejects.toThrow(/restrita/);
    await expect(runAsAdmin(null, null, (a) => metrics(a))).rejects.toThrow(/Sessão/);
  });

  it("administrador vê métricas e cadastro, mas não os dados financeiros dos clientes", async () => {
    const admin = await makeUser("Admin");
    await ownerPool().query("insert into saas.platform_admins (user_id, role) values ($1, 'superadmin')", [admin.id]);
    const { owner, tenantId } = await makeCompany("Cliente privado");
    await makeAccount(owner, tenantId, "Conta secreta", 123_45);
    const m = await runAsAdmin(admin.token, null, (a) => metrics(a));
    expect(m.tenants.total).toBeGreaterThan(0);
    const detail = await runAsAdmin(admin.token, null, (a) => tenantDetail(a, tenantId));
    expect(detail.tenant.trade_name).toBe("Cliente privado");
    await rawApp(admin.token, tenantId, async (c) => {
      expect((await c.query("select count(*)::int as n from saas.financial_accounts")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int as n from saas.cash_movements")).rows[0].n).toBe(0);
    });
    // Modo suporte sem concessão: nada visível.
    await rawApp(admin.token, tenantId, async (c) => {
      expect((await c.query("select count(*)::int as n from saas.financial_accounts")).rows[0].n).toBe(0);
    }, true);
    await expect(runAsAdmin(admin.token, null, (a) => enterSupport(a, { tenantId, justification: "Investigar erro reportado" }))).rejects.toThrow(/não concedeu/);
    // Proprietário concede acesso temporário: suporte lê, mas não grava.
    await as(owner, tenantId, (ctx) => grantSupport(ctx, { hours: 2, reason: "Chamado #123 - divergência no saldo" }));
    await runAsAdmin(admin.token, null, (a) => enterSupport(a, { tenantId, justification: "Chamado #123 - análise do saldo" }));
    const seen = await as(admin, tenantId, (ctx) => listAccounts(ctx), true);
    expect(seen.map((x) => x.name)).toEqual(["Conta secreta"]);
    await expect(as(admin, tenantId, (ctx) => createAccount(ctx, { name: "x", kind: "cash", openingBalance: 0, openingDate: ctx.today }), true)).rejects.toThrow();
    const audit = (await ownerPool().query("select count(*)::int as n from saas.audit_log where tenant_id = $1 and action = 'support.enter'", [tenantId])).rows[0].n;
    expect(audit).toBe(1);
  });

  it("MRR considera apenas assinaturas pagantes; avaliações não contam", async () => {
    const admin = await makeUser("Admin MRR");
    await ownerPool().query("insert into saas.platform_admins (user_id, role) values ($1, 'billing')", [admin.id]);
    const before = await runAsAdmin(admin.token, null, (a) => metrics(a));
    const { tenantId } = await makeCompany("MRR Trial");
    const mid = await runAsAdmin(admin.token, null, (a) => metrics(a));
    expect(mid.mrr_cents).toBe(before.mrr_cents);
    await setSubscriptionStatus(tenantId, "active", ", billing_interval = 'yearly', price_cents = 120000");
    const after = await runAsAdmin(admin.token, null, (a) => metrics(a));
    expect(after.mrr_cents - before.mrr_cents).toBe(10000);
    expect(after.arr_cents).toBe(after.mrr_cents * 12);
  });
});
