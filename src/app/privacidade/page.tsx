export const metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-gray-800">
      <h1 className="text-2xl font-semibold">Política de privacidade (LGPD)</h1>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        Modelo inicial para o piloto. Deve ser revisado pelo encarregado (DPO) e por assessoria jurídica.
      </p>
      <h2 className="mt-6 font-semibold">Finalidade e minimização</h2>
      <p>Coletamos apenas os dados necessários para autenticação (nome, e-mail, senha protegida por hash) e para a prestação do serviço de gestão financeira contratado pela empresa.</p>
      <h2 className="mt-6 font-semibold">Papéis</h2>
      <p>A empresa cliente é controladora dos dados que registra (clientes, fornecedores, lançamentos). A plataforma atua como operadora desses dados.</p>
      <h2 className="mt-6 font-semibold">Direitos do titular</h2>
      <p>Na página “Minha conta” é possível exportar seus dados pessoais e solicitar a exclusão da conta. A exclusão anonimiza os dados pessoais; registros financeiros das empresas são preservados pelo prazo exigido pela legislação.</p>
      <h2 className="mt-6 font-semibold">Retenção</h2>
      <p>Dados de empresas com assinatura encerrada permanecem em modo somente leitura pelo prazo configurado pela plataforma (padrão de 365 dias) e depois podem ser excluídos mediante solicitação do proprietário ou procedimento documentado.</p>
      <h2 className="mt-6 font-semibold">Acesso do suporte</h2>
      <p>A equipe de suporte só acessa dados financeiros da empresa com autorização temporária concedida pelo proprietário, em modo somente leitura e com registro de auditoria.</p>
      <h2 className="mt-6 font-semibold">Incidentes</h2>
      <p>Incidentes de segurança são tratados conforme o procedimento descrito na documentação operacional, incluindo comunicação à ANPD e aos titulares quando aplicável.</p>
    </article>
  );
}
