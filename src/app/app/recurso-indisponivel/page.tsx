import { EmptyState, LinkButton } from "@/components/ui";

export const metadata = { title: "Recurso indisponível" };

export default async function Unavailable({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return <EmptyState title="Recurso indisponível" description={(m ?? "Este recurso não está disponível no plano atual.").slice(0, 200)} action={<LinkButton href="/app/configuracoes/assinatura">Ver planos</LinkButton>} />;
}
