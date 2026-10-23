import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <Link href="/app" className="text-brand-700 hover:underline">Ir para o painel</Link>
    </div>
  );
}
