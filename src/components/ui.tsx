import Link from "next/link";
import { formatBRL } from "@/lib/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "positive" | "negative" | "warning" }) {
  const toneClass = { default: "text-gray-900", positive: "text-emerald-700", negative: "text-red-700", warning: "text-amber-700" }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={cx("mt-1 text-xl font-semibold tabular sm:text-2xl", toneClass)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function Money({ cents, signed, className }: { cents: number; signed?: boolean; className?: string }) {
  const tone = signed ? (cents < 0 ? "text-red-700" : cents > 0 ? "text-emerald-700" : "") : "";
  return <span className={cx("tabular whitespace-nowrap", tone, className)}>{formatBRL(cents)}</span>;
}

const badgeTones = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
};
export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", badgeTones[tone])}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-gray-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "success"; children: React.ReactNode }) {
  const t = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", t)}>{children}</div>;
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60",
  secondary: "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-60",
  danger: "inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60",
  ghost: "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50",
};

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof btn }) {
  return <Link href={href} className={btn[variant]}>{children}</Link>;
}

export const inputClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export function Field({ label, name, hint, error, required, children }: { label: string; name?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-800">
        {label} {required ? <span className="text-red-600" aria-hidden>*</span> : <span className="font-normal text-gray-400">(opcional)</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <td className={cx("px-4 py-2 align-top", right && "text-right", className)}>{children}</td>;
}

/** Barra horizontal simples para comparativos (sem biblioteca de gráficos). */
export function Bar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "red" | "green" }) {
  const pct = max > 0 ? Math.max(2, Math.round((Math.abs(value) / max) * 100)) : 0;
  const color = { brand: "bg-brand-500", red: "bg-red-500", green: "bg-emerald-500" }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-gray-100" aria-hidden>
      <div className={cx("h-2 rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
