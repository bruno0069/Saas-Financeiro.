import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, ownerPool } from "@/server/db/pool";
import { addDays } from "@/lib/dates";
import { listAccounts } from "@/domains/finance/accounts";
import { realizedByCategory, totalBalance } from "@/domains/finance/reports";
import { setModuleEnabled } from "@/domains/tenants/service";
import * as caixa from "@/domains/padaria/caixa";
import * as producao from "@/domains/padaria/producao";
import { padariaKpis } from "@/domains/padaria/kpis";
import { as, addMember, makeAccount, makeCompany, type TestUser } from "./helpers";

afterAll(closePools);

let owner: TestUser;
let tenantId: string;
let register: string;
let bank: string;
let cards: string;
let today: string;

const balances = async () => Object.fromEntries((await as(owner, tenantId, (ctx) => listAccounts(ctx))).map((a) => [a.name, a.balance_cents]));

beforeAll(async () => {
  ({ owner, tenantId } = await makeCompany("Padaria Módulo"));
  register = await makeAccount(owner, tenantId, "Caixa loja", 200_00, "cash");
  bank = await makeAccount(owner, tenantId, "Banco", 0);
  cards = await makeAccount(owner, tenantId, "Recebíveis", 0, "card_receivables");
  today = await as(owner, tenantId, async (ctx) => ctx.today);
  await as(owner, tenantId, (ctx) => caixa.saveSettings(ctx, {
    pixAccountId: bank, cardAccountId: cards, safeAccountId: bank,
    debitDays: 1, creditDays: 30, voucherDays: 30, debitFeePct: "1.5", creditFeePct: "3.5", voucherFeePct: "5",
  }));
});

describe("fechamento de caixa", () => {
  it("cálculo da diferença de caixa", () => {
    expect(caixa.computeClosing({ openingFloat: 200_00, cashSales: 1000_00, withdrawals: 500_00, countedCash: 690_00,
      pixSales: 0, debitSales: 0, creditSales: 0, voucherSales: 0 })).toEqual({ expectedCash: 700_00, difference: -10_00, totalSales: 1000_00 });
  });

  it("gera efeitos financeiros pelos serviços centrais", async () => {
    const op = await addMember(owner, tenantId, "operator");
    const before = await balances();
    const id = await as(op, tenantId, (ctx) => caixa.createClosing(ctx, {
      closingDate: today, registerName: "Caixa 1", registerAccountId: register,
      openingFloat: "200,00", cashSales: "1.000,00", pixSales: "400,00", debitSales: "300,00", creditSales: "500,00", voucherSales: "0",
      withdrawals: "500,00", countedCash: "690,00", ticketCount: "100",
    }));
    const after = await balances();
    // Caixa: + 1000 vendas - 500 sangria - 10 quebra.
    expect(after["Caixa loja"] - before["Caixa loja"]).toBe(490_00);
    // Banco: + 400 PIX + 500 sangria (transferência).
    expect(after["Banco"] - before["Banco"]).toBe(900_00);
    // Cartões ainda não liquidados.
    expect(after["Recebíveis"] - before["Recebíveis"]).toBe(0);
    const titles = (await ownerPool().query(
      "select direction, amount_cents, status, due_date from saas.titles where source_ref_id = $1 order by direction, amount_cents", [id])).rows;
    expect(titles).toEqual(expect.arrayContaining([
      { direction: "receivable", amount_cents: 300_00, status: "open", due_date: addDays(today, 1) },
      { direction: "receivable", amount_cents: 500_00, status: "open", due_date: addDays(today, 30) },
      { direction: "payable", amount_cents: 4_50, status: "open", due_date: addDays(today, 1) },
      { direction: "payable", amount_cents: 17_50, status: "open", due_date: addDays(today, 30) },
      { direction: "payable", amount_cents: 10_00, status: "paid", due_date: today },
    ]));
    // Sangria é transferência: não aparece como despesa.
    const exp = await as(owner, tenantId, (ctx) => realizedByCategory(ctx, today, today, "payable"));
    expect(exp.rows.map((r) => r.category_name)).toEqual(["Quebra de caixa"]);
    const k = await as(owner, tenantId, (ctx) => padariaKpis(ctx));
    expect(k.caixa!.sales_total_cents).toBe(2200_00);
    expect(k.caixa!.average_ticket_cents).toBe(22_00);
    expect(k.caixa!.cash_shortage_cents).toBe(10_00);
    expect(k.caixa!.card_receivables_open_cents).toBe(800_00);
  });

  it("não permite dois fechamentos do mesmo caixa no mesmo dia", async () => {
    await expect(as(owner, tenantId, (ctx) => caixa.createClosing(ctx, {
      closingDate: today, registerName: "caixa 1", registerAccountId: register, openingFloat: "0", cashSales: "10",
      pixSales: "0", debitSales: "0", creditSales: "0", voucherSales: "0", withdrawals: "0", countedCash: "10",
    }))).rejects.toThrow(/Já existe/);
  });

  it("confirmação de repasse liquida bruto e taxa: entra o valor líquido", async () => {
    const pending = await as(owner, tenantId, (ctx) => caixa.pendingCardReceivables(ctx));
    const debit = pending.find((p) => p.amount_cents === 300_00)!;
    expect(debit.fee_cents).toBe(4_50);
    const before = await balances();
    await as(owner, tenantId, (ctx) => caixa.confirmCardSettlement(ctx, { titleId: debit.id, date: today }));
    const after = await balances();
    expect(after["Recebíveis"] - before["Recebíveis"]).toBe(295_50);
    expect((await as(owner, tenantId, (ctx) => caixa.pendingCardReceivables(ctx))).find((p) => p.id === debit.id)).toBeUndefined();
  });

  it("operador não pode estornar fechamento; estorno pelo gerente desfaz todos os efeitos", async () => {
    const op = await addMember(owner, tenantId, "operator");
    const total0 = await as(owner, tenantId, (ctx) => totalBalance(ctx));
    const id = await as(op, tenantId, (ctx) => caixa.createClosing(ctx, {
      closingDate: addDays(today, -1), registerName: "Caixa 2", registerAccountId: register, openingFloat: "100", cashSales: "300",
      pixSales: "50", debitSales: "100", creditSales: "0", voucherSales: "0", withdrawals: "200", countedCash: "205",
    }));
    expect(await as(owner, tenantId, (ctx) => totalBalance(ctx))).toBe(total0 + 355_00);
    await expect(as(op, tenantId, (ctx) => caixa.reverseClosing(ctx, { id, reason: "lançado errado" }))).rejects.toThrow(/permissão/);
    const mgr = await addMember(owner, tenantId, "manager");
    await as(mgr, tenantId, (ctx) => caixa.reverseClosing(ctx, { id, reason: "Valores digitados errados" }));
    expect(await as(owner, tenantId, (ctx) => totalBalance(ctx))).toBe(total0);
    const st = (await ownerPool().query("select distinct status from saas.titles where source_ref_id = $1", [id])).rows.map((r) => r.status);
    expect(st).toEqual(["canceled"]);
    // Depois do estorno é possível refazer o fechamento do mesmo caixa/dia.
    await as(op, tenantId, (ctx) => caixa.createClosing(ctx, {
      closingDate: addDays(today, -1), registerName: "Caixa 2", registerAccountId: register, openingFloat: "100", cashSales: "300",
      pixSales: "0", debitSales: "0", creditSales: "0", voucherSales: "0", withdrawals: "0", countedCash: "400",
    }));
  });

  it("módulo desabilitado pela empresa bloqueia o uso", async () => {
    await as(owner, tenantId, (ctx) => setModuleEnabled(ctx, "padaria.caixa", false));
    await expect(as(owner, tenantId, (ctx) => caixa.listClosings(ctx, today, today))).rejects.toThrow(/desabilitado/);
    await as(owner, tenantId, (ctx) => setModuleEnabled(ctx, "padaria.caixa", true));
  });
});

describe("produção e margens", () => {
  it("calcula custo unitário, margem e perdas", async () => {
    const farinha = await as(owner, tenantId, (ctx) => producao.saveIngredient(ctx, { name: "Farinha", unit: "kg", packQuantity: "25", packCost: "100,00" }));
    const fermento = await as(owner, tenantId, (ctx) => producao.saveIngredient(ctx, { name: "Fermento", unit: "kg", packQuantity: "0,5", packCost: "10,00" }));
    const pid = await as(owner, tenantId, (ctx) => producao.saveProduct(ctx, {
      name: "Pão francês", saleUnit: "un", salePrice: "0,80", yieldQuantity: "100",
      items: [{ ingredientId: farinha, quantity: "5" }, { ingredientId: fermento, quantity: "0,1" }],
    }));
    const p = (await as(owner, tenantId, (ctx) => producao.listProducts(ctx))).find((x) => x.id === pid)!;
    // 5kg × R$4,00 + 0,1kg × R$20,00 = R$22,00 por fornada de 100 → R$0,22/un.
    expect(p.batch_cost_cents).toBe(22_00);
    expect(p.unit_cost_cents).toBe(22);
    expect(p.margin_cents).toBe(58);
    expect(p.margin_pct).toBeCloseTo(0.725);
    await as(owner, tenantId, (ctx) => producao.registerLoss(ctx, { lossDate: today, productId: pid, quantity: "50", reason: "sobra" }));
    const k = await as(owner, tenantId, (ctx) => producao.kpis(ctx));
    expect(k.losses_month_cents).toBe(11_00);
    // Perda não gera movimentação financeira.
    const n = (await ownerPool().query("select count(*)::int as n from saas.cash_movements where tenant_id = $1 and description ilike '%perda%'", [tenantId])).rows[0].n;
    expect(n).toBe(0);
  });
});
