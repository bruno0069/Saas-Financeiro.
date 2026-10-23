import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, ownerPool } from "@/server/db/pool";
import { addDays, monthStart, monthEnd } from "@/lib/dates";
import { adjustBalance, listAccounts } from "@/domains/finance/accounts";
import { cancelTitle, createTitle, getTitle, listTitles, settleTitle, updateTitle } from "@/domains/finance/titles";
import { createTransfer, listMovements, reverseMovement } from "@/domains/finance/movements";
import { cashFlow, dashboard, realizedByCategory, realizedByMonth, totalBalance, projection } from "@/domains/finance/reports";
import { as, categoryId, makeAccount, makeCompany, rawApp, type TestUser } from "./helpers";

afterAll(closePools);

let owner: TestUser;
let tenantId: string;
let bank: string;
let cash: string;
let catInsumos: string;
let catVendas: string;
let today: string;

beforeAll(async () => {
  ({ owner, tenantId } = await makeCompany("Padaria Financeiro"));
  bank = await makeAccount(owner, tenantId, "Banco", 10_000_00);
  cash = await makeAccount(owner, tenantId, "Caixa", 500_00, "cash");
  catInsumos = await categoryId(tenantId, "padaria.insumos");
  catVendas = await categoryId(tenantId, "padaria.vendas_balcao");
  today = await as(owner, tenantId, async (ctx) => ctx.today);
});

const run = <T>(fn: Parameters<typeof as<T>>[2]) => as(owner, tenantId, fn);

describe("contas financeiras e saldos iniciais", () => {
  it("registra saldo inicial como movimentação explícita", async () => {
    const accounts = await run((ctx) => listAccounts(ctx));
    expect(accounts.find((a) => a.id === bank)!.balance_cents).toBe(10_000_00);
    const mv = await run((ctx) => listMovements(ctx, { accountId: bank }));
    expect(mv).toHaveLength(1);
    expect(mv[0].kind).toBe("opening_balance");
  });

  it("saldo inicial não conta como receita", async () => {
    const months = await run((ctx) => realizedByMonth(ctx, monthStart(today), monthEnd(today)));
    expect(months.at(-1)!.income_cents).toBe(0);
  });
});

describe("receitas, despesas e baixas", () => {
  it("receita já realizada (baixa imediata) entra no saldo e no resultado", async () => {
    const before = await run((ctx) => totalBalance(ctx));
    await run((ctx) => createTitle(ctx, {
      direction: "receivable", description: "Encomenda festa", categoryId: catVendas, amount: "350,00", dueDate: today,
      settleNow: { accountId: bank, date: today, method: "pix" },
    }));
    expect(await run((ctx) => totalBalance(ctx))).toBe(before + 350_00);
  });

  it("pagamentos parciais atualizam saldo em aberto e situação; excesso é rejeitado", async () => {
    const [id] = await run((ctx) => createTitle(ctx, {
      direction: "payable", description: "Farinha 10 sacos", categoryId: catInsumos, amount: "1.000,00", dueDate: addDays(today, 5),
    }));
    await run((ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "300,00", date: today, method: "pix" }));
    let t = (await run((ctx) => getTitle(ctx, id))).title;
    expect([t.status, t.paid_cents, t.open_cents]).toEqual(["partial", 300_00, 700_00]);
    await expect(run((ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "800,00", date: today }))).rejects.toThrow(/maior que o saldo/);
    await run((ctx) => settleTitle(ctx, { titleId: id, accountId: cash, amount: "700,00", date: today, method: "cash" }));
    t = (await run((ctx) => getTitle(ctx, id))).title;
    expect([t.status, t.paid_cents, t.open_cents]).toEqual(["paid", 1000_00, 0]);
  });

  it("recebimentos parciais em contas a receber", async () => {
    const [id] = await run((ctx) => createTitle(ctx, {
      direction: "receivable", description: "Revenda mercado", categoryId: catVendas, amount: "200,00", dueDate: today,
    }));
    await run((ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "50,00", date: today }));
    const t = (await run((ctx) => getTitle(ctx, id))).title;
    expect([t.status, t.open_cents]).toEqual(["partial", 150_00]);
  });

  it("o banco impede baixa acima do valor mesmo sem passar pelo serviço", async () => {
    const [id] = await run((ctx) => createTitle(ctx, { direction: "payable", description: "Gás", categoryId: catInsumos, amount: "100", dueDate: today }));
    await rawApp(owner.token, tenantId, async (c) => {
      await expect(c.query(
        `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, title_id)
         values ($1, $2, 'out', 100001, current_date, 'settlement', $3)`, [tenantId, bank, id])).rejects.toThrow(/excede/);
    });
    await rawApp(owner.token, tenantId, async (c) => {
      await expect(c.query("update saas.titles set paid_cents = 100 where id = $1", [id])).rejects.toThrow(/permission denied/);
    });
    await rawApp(owner.token, tenantId, async (c) => {
      // A situação não pode ser forçada para "quitado" sem baixa.
      await c.query("update saas.titles set status = 'paid' where id = $1", [id]);
      expect((await c.query("select status from saas.titles where id = $1", [id])).rows[0].status).toBe("open");
    });
  });

  it("parcelamento divide o valor e escalona vencimentos mensalmente", async () => {
    const catManut = await categoryId(tenantId, "padaria.manutencao");
    const ids = await run((ctx) => createTitle(ctx, {
      direction: "payable", description: "Forno novo", categoryId: catManut,
      amount: "1.000,00", dueDate: "2030-01-31", installments: 3,
    }));
    expect(ids).toHaveLength(3);
    const rows = (await ownerPool().query("select amount_cents, due_date, installment_number from saas.titles where id = any($1) order by installment_number", [ids])).rows;
    expect(rows.map((r) => r.amount_cents)).toEqual([333_34, 333_33, 333_33]);
    expect(rows.map((r) => r.due_date)).toEqual(["2030-01-31", "2030-02-28", "2030-03-31"]);
  });

  it("categoria incompatível com a natureza do título é rejeitada", async () => {
    await expect(run((ctx) => createTitle(ctx, { direction: "payable", description: "x", categoryId: catVendas, amount: "1", dueDate: today })))
      .rejects.toThrow(/categoria de despesa/);
  });
});

describe("transferências, estornos e cancelamentos", () => {
  it("transferência entre contas próprias não altera receitas/despesas nem saldo total", async () => {
    const totalBefore = await run((ctx) => totalBalance(ctx));
    const monthBefore = (await run((ctx) => realizedByMonth(ctx, monthStart(today), monthEnd(today)))).at(-1)!;
    await run((ctx) => createTransfer(ctx, { fromAccountId: cash, toAccountId: bank, amount: "100,00", date: today }));
    expect(await run((ctx) => totalBalance(ctx))).toBe(totalBefore);
    const monthAfter = (await run((ctx) => realizedByMonth(ctx, monthStart(today), monthEnd(today)))).at(-1)!;
    expect(monthAfter).toEqual(monthBefore);
  });

  it("estorno de baixa reabre o título e preserva a movimentação original", async () => {
    const catEmb = await categoryId(tenantId, "padaria.embalagens");
    const [id] = await run((ctx) => createTitle(ctx, {
      direction: "payable", description: "Embalagens", categoryId: catEmb, amount: "80,00", dueDate: today,
      settleNow: { accountId: bank, date: today, method: "pix" },
    }));
    const { movements } = await run((ctx) => getTitle(ctx, id));
    const balanceBefore = await run((ctx) => totalBalance(ctx));
    await run((ctx) => reverseMovement(ctx, { movementId: movements[0].id, reason: "Lançado em duplicidade" }));
    const after = await run((ctx) => getTitle(ctx, id));
    expect(after.title.status).toBe("open");
    expect(after.movements).toHaveLength(2);
    expect(after.movements[0].reversed).toBe(true);
    expect(await run((ctx) => totalBalance(ctx))).toBe(balanceBefore + 80_00);
    await expect(run((ctx) => reverseMovement(ctx, { movementId: movements[0].id, reason: "de novo!" }))).rejects.toThrow(/já foi estornada/);
    // Agora o título pode ser cancelado.
    await run((ctx) => cancelTitle(ctx, { id, reason: "Duplicado" }));
    expect((await run((ctx) => getTitle(ctx, id))).title.status).toBe("canceled");
  });

  it("título com baixa não pode ser cancelado nem ter o valor alterado", async () => {
    const [id] = await run((ctx) => createTitle(ctx, { direction: "payable", description: "Luz", categoryId: catInsumos, amount: "90", dueDate: today }));
    await run((ctx) => settleTitle(ctx, { titleId: id, accountId: bank, amount: "10", date: today }));
    await expect(run((ctx) => cancelTitle(ctx, { id, reason: "teste" }))).rejects.toThrow(/Estorne/);
    await expect(run((ctx) => updateTitle(ctx, { id, description: "Luz", categoryId: catInsumos, amount: "95", dueDate: today })))
      .rejects.toThrow(/estorne as baixas/);
  });

  it("estorno de transferência estorna as duas pernas", async () => {
    const trId = await run((ctx) => createTransfer(ctx, { fromAccountId: bank, toAccountId: cash, amount: "40,00", date: today }));
    const legs = (await ownerPool().query("select id from saas.cash_movements where transfer_id = $1 and kind = 'transfer'", [trId])).rows;
    const balances = async () => (await run((ctx) => listAccounts(ctx))).map((a) => [a.name, a.balance_cents]);
    const before = await balances();
    await run((ctx) => reverseMovement(ctx, { movementId: legs[0].id, reason: "Transferência indevida" }));
    const after = await balances();
    const bankBefore = before.find((b) => b[0] === "Banco")![1] as number;
    expect(after.find((b) => b[0] === "Banco")![1]).toBe(bankBefore + 40_00);
    const n = (await ownerPool().query("select count(*)::int as n from saas.cash_movements where transfer_id = $1 and kind = 'reversal'", [trId])).rows[0].n;
    expect(n).toBe(2);
  });

  it("movimentações realizadas são imutáveis (nem o dono das tabelas altera)", async () => {
    const m = (await ownerPool().query("select id from saas.cash_movements where tenant_id = $1 limit 1", [tenantId])).rows[0];
    await expect(ownerPool().query("update saas.cash_movements set amount_cents = 1 where id = $1", [m.id])).rejects.toThrow(/imutáveis/);
    await expect(ownerPool().query("delete from saas.cash_movements where id = $1", [m.id])).rejects.toThrow(/imutáveis/);
  });

  it("ajuste de saldo exige motivo e é auditado", async () => {
    await expect(run((ctx) => adjustBalance(ctx, { accountId: cash, direction: "out", amount: "5", date: today, reason: "" }))).rejects.toThrow(/motivo/);
    const id = await run((ctx) => adjustBalance(ctx, { accountId: cash, direction: "out", amount: "5,00", date: today, reason: "Conferência de caixa" }));
    const a = (await ownerPool().query("select action, reason from saas.audit_log where tenant_id = $1 and entity_id = $2", [tenantId, id])).rows[0];
    expect(a).toEqual({ action: "movement.adjust", reason: "Conferência de caixa" });
  });
});

describe("consistência entre painel, fluxo de caixa e relatórios", () => {
  it("fechamento do fluxo de caixa = soma dos saldos das contas", async () => {
    const flow = await run((ctx) => cashFlow(ctx, monthStart(addDays(today, -60)), monthEnd(today)));
    const accounts = await run((ctx) => listAccounts(ctx, { includeInactive: true }));
    expect(flow.closing_cents).toBe(accounts.reduce((s, a) => s + a.balance_cents, 0));
    const m = flow.months.at(-1)!;
    expect(m.closing_cents).toBe(m.opening_cents + m.net_cents);
    // net = receitas - despesas + ajustes + saldos iniciais informados (transferências se anulam).
    expect(m.net_cents).toBe(m.income_cents - m.expense_cents + m.adjustments_cents + m.informed_opening_cents);
  });

  it("painel usa os mesmos critérios dos relatórios", async () => {
    const d = await run((ctx) => dashboard(ctx));
    const months = await run((ctx) => realizedByMonth(ctx, monthStart(today), monthEnd(today)));
    const byCat = await run((ctx) => realizedByCategory(ctx, monthStart(today), monthEnd(today), "payable"));
    expect(d.month.income_cents).toBe(months.at(-1)!.income_cents);
    expect(d.month.expense_cents).toBe(months.at(-1)!.expense_cents);
    expect(byCat.total_cents).toBe(d.month.expense_cents);
    expect(d.balance_cents).toBe(await run((ctx) => totalBalance(ctx)));
    const open = await run((ctx) => listTitles(ctx, { direction: "payable", status: "open" }));
    expect(d.totals.payable_open).toBe(open.reduce((s, t) => s + t.open_cents, 0));
  });

  it("previsão de caixa = saldo + a receber - a pagar no horizonte", async () => {
    const p = await run((ctx) => projection(ctx, 30));
    const last = p.days.at(-1)!;
    const rec = p.days.reduce((s, x) => s + x.receivable_cents, 0);
    const pay = p.days.reduce((s, x) => s + x.payable_cents, 0);
    expect(last.projected_balance_cents).toBe(p.start_balance_cents + rec - pay);
  });
});
