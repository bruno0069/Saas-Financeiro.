import { EmptyState, LinkButton } from "@/components/ui";

export const metadata = { title: "Acesso negado" };

export default function Denied() {
  return <EmptyState title="Você não tem permissão para acessar esta área" description="Peça ao proprietário ou a quem administra os usuários da empresa para ajustar suas permissões." action={<LinkButton href="/app" variant="secondary">Voltar</LinkButton>} />;
}
