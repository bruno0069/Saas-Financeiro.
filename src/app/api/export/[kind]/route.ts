import { NextResponse, type NextRequest } from "next/server";
import { centsToCsv, toCsv } from "@/lib/csv";
import { addDays, isIsoDate, monthEnd, monthStart } from "@/lib/dates";
import { AppError, fromDbError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { MOVEMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, TITLE_STATUS_LABELS } from "@/domains/finance/labels";
import { listMovements } from "@/domains/finance/movements";
import { cashFlow, realizedByCategory } from "@/domains/finance/reports";
import { listTitles, type TitleFilter } from "@/domains/finance/titles";
import { audit } from "@/domains/finance/shared";
import { exportTenantData } from "@/domains/lgpd/service";
import { runInTenant } from "@/server/context";
import { requireFeature, requirePerm } from "@/server/authz";
import { SESSION_COOKIE, SUPPORT_COOKIE, TENANT_COOKIE } from "@/server/web";

export const dynamic = "force-dynamic";

const date = (v: string | null, fallback: string) => (v && isIsoDate(v) ? v : fallback);

/**
 * Exportações CSV. Executam no tenant autenticado (RLS) e respeitam permissões e plano.
 * A exportação completa (LGPD) continua disponível em modo somente leitura.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const q = req.nextUrl.searchParams;
  const support = req.cookies.get(SUPPORT_COOKIE)?.value;
  const auth = {
    sessionToken: req.cookies.get(SESSION_COOKIE)?.value ?? null,
    tenantId: support ?? req.cookies.get(TENANT_COOKIE)?.value ?? null,
    supportMode: !!support,
  };
  try {
    const out = await runInTenant(auth, async (ctx) => {
      if (kind === "full") {
        if (ctx.supportMode) throw new AppError("Indisponível em modo suporte.", "forbidden", 403);
        const data = await exportTenantData(ctx);
        return { body: JSON.stringify(data, null, 2), type: "application/json", name: `dados-${ctx.tenant.id}.json` };
      }
      requirePerm(ctx, "reports.export");
      requireFeature(ctx, "export.csv");
      if (ctx.supportMode) throw new AppError("Exportação indisponível em modo suporte.", "forbidden", 403);
      let csv: string;
      if (kind === "titles") {
        const direction = q.get("direction") === "receivable" ? "receivable" : "payable";
        const titles = await listTitles(ctx, { direction, status: (q.get("status") as TitleFilter["status"]) ?? "all", q: q.get("q") ?? undefined,
          from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, limit: 2000 });
        csv = toCsv(["Vencimento", "Descrição", "Contato", "Categoria", "Valor", "Pago", "Em aberto", "Situação", "Parcela", "Documento"],
          titles.map((t) => [t.due_date, t.description, t.contact_name, t.category_name, centsToCsv(t.amount_cents), centsToCsv(t.paid_cents),
            centsToCsv(t.open_cents), t.is_overdue ? "Vencido" : TITLE_STATUS_LABELS[t.status], `${t.installment_number}/${t.installment_count}`, t.document_number]));
      } else if (kind === "movements") {
        const mv = await listMovements(ctx, { from: date(q.get("from"), addDays(ctx.today, -30)), to: date(q.get("to"), ctx.today),
          accountId: q.get("accountId") ?? undefined, limit: 5000 });
        csv = toCsv(["Data", "Conta", "Tipo", "Descrição", "Categoria", "Forma", "Entrada", "Saída", "Motivo", "Estornado"],
          mv.map((m) => [m.occurred_on, m.account_name, MOVEMENT_KIND_LABELS[m.kind], m.title_description ?? m.description, m.category_name,
            m.payment_method ? PAYMENT_METHOD_LABELS[m.payment_method] : "", m.direction === "in" ? centsToCsv(m.amount_cents) : "",
            m.direction === "out" ? centsToCsv(m.amount_cents) : "", m.reason, m.reversed ? "Sim" : ""]));
      } else if (kind === "cashflow") {
        const f = await cashFlow(ctx, monthStart(date(q.get("from"), ctx.today)), monthEnd(date(q.get("to"), ctx.today)));
        csv = toCsv(["Mês", "Saldo inicial", "Entradas", "Saídas", "Ajustes", "Saldos iniciais informados", "Saldo final"],
          f.months.map((m) => [m.month, centsToCsv(m.opening_cents), centsToCsv(m.income_cents), centsToCsv(m.expense_cents),
            centsToCsv(m.adjustments_cents), centsToCsv(m.informed_opening_cents), centsToCsv(m.closing_cents)]));
      } else if (kind === "categories") {
        const from = date(q.get("from"), monthStart(ctx.today));
        const to = date(q.get("to"), monthEnd(ctx.today));
        const inc = await realizedByCategory(ctx, from, to, "receivable");
        const exp = await realizedByCategory(ctx, from, to, "payable");
        csv = toCsv(["Tipo", "Categoria", "Valor realizado", "Participação %"], [
          ...inc.rows.map((r) => ["Receita", r.category_name, centsToCsv(r.amount_cents), (r.share * 100).toFixed(1).replace(".", ",")]),
          ...exp.rows.map((r) => ["Despesa", r.category_name, centsToCsv(r.amount_cents), (r.share * 100).toFixed(1).replace(".", ",")]),
        ]);
      } else {
        throw new AppError("Exportação desconhecida.", "not_found", 404);
      }
      await audit(ctx, "export.csv", "export", kind);
      return { body: csv, type: "text/csv; charset=utf-8", name: `${kind}-${ctx.today}.csv` };
    });
    return new NextResponse(out.body, {
      headers: { "Content-Type": out.type, "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    const e = err instanceof AppError ? err : fromDbError(err);
    if (!e) logger.error("export failed", { kind, err: (err as Error).message });
    return new NextResponse(e?.message ?? "Erro ao exportar.", { status: e?.status ?? 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
