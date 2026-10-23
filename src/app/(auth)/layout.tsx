import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold text-brand-700">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden>R$</span>
        Gestão Financeira
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
    </div>
  );
}
