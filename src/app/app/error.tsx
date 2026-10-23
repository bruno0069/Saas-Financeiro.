"use client";

import { EmptyState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="Não foi possível carregar esta página"
      description={`Tente novamente. Se o problema continuar, informe ao suporte o código ${error.digest ?? "—"}.`}
      action={<button onClick={reset} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Tentar novamente</button>} />
  );
}
