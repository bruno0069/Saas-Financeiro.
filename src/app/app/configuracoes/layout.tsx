import Link from "next/link";
import { PageHeader } from "@/components/ui";

const TABS = [
  ["/app/configuracoes", "Empresa e módulos"],
  ["/app/configuracoes/usuarios", "Usuários"],
  ["/app/configuracoes/assinatura", "Assinatura"],
  ["/app/configuracoes/suporte", "Suporte e dados"],
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Configurações" />
      <nav aria-label="Seções de configuração" className="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">{label}</Link>
        ))}
      </nav>
      {children}
    </>
  );
}
