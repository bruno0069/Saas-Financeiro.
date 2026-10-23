import { describe, expect, it } from "vitest";
import { applyBps, formatBRL, parseBRL, splitInstallments } from "@/lib/money";
import { addDays, addMonths, isIsoDate, monthEnd, todayIn } from "@/lib/dates";
import { isValidTaxId } from "@/lib/tax-id";
import { toCsv } from "@/lib/csv";
import { effectivePermissions } from "@/domains/access/permissions";
import { accessLevel, monthlyValue } from "@/domains/billing/state-machine";
import { logger } from "@/lib/logger";

describe("dinheiro", () => {
  it("interpreta formatos brasileiros e rejeita inválidos", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 10")).toBe(1000);
    expect(parseBRL("0,5")).toBe(50);
    expect(parseBRL("1234.56")).toBe(123456);
    expect(parseBRL("1.000")).toBe(100000);
    expect(parseBRL("-15,30")).toBe(-1530);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
    expect(parseBRL("")).toBeNull();
  });
  it("formata e divide sem perder centavos", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b)).toBe(10000);
    expect(applyBps(10000, 350)).toBe(350);
  });
});

describe("datas", () => {
  it("valida, soma e respeita fim de mês", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(monthEnd("2026-04-10")).toBe("2026-04-30");
    expect(todayIn("America/Sao_Paulo", new Date("2026-10-24T02:00:00Z"))).toBe("2026-10-23");
  });
});

describe("CPF/CNPJ e CSV", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidTaxId("11222333000181")).toBe(true);
    expect(isValidTaxId("11222333000182")).toBe(false);
    expect(isValidTaxId("52998224725")).toBe(true);
    expect(isValidTaxId("11111111111")).toBe(false);
  });
  it("protege contra injeção de fórmulas e escapa separadores", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(\"x\")", "x;y"], ["-10,50", "ok"]]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"x;y"');
    expect(csv).toContain("-10,50;ok");
  });
});

describe("regras puras", () => {
  it("permissões efetivas não concedem cobrança fora do proprietário", () => {
    const p = effectivePermissions("operator", ["billing.manage", "payables.view", "inexistente"], ["contacts.manage"]);
    expect(p).toContain("payables.view");
    expect(p).not.toContain("billing.manage");
    expect(p).not.toContain("contacts.manage");
  });
  it("política de acesso e normalização de MRR", () => {
    const future = new Date(Date.now() + 86400000);
    expect(accessLevel("past_due", null)).toBe("full");
    expect(accessLevel("suspended", future)).toBe("read_only");
    expect(accessLevel("canceled", future)).toBe("full");
    expect(accessLevel("canceled", new Date(Date.now() - 1000))).toBe("read_only");
    expect(monthlyValue(120000, "yearly")).toBe(10000);
  });
  it("logs removem campos sensíveis", () => {
    expect(logger.redact({ password: "x", nested: { token: "y", amount_cents: 10, ok: 1 } })).toEqual({
      password: "[redacted]", nested: { token: "[redacted]", amount_cents: "[redacted]", ok: 1 },
    });
  });
});
