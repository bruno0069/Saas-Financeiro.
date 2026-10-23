export const metadata = { title: "Termos de uso" };

export default function TermsPage() {
  return (
    <article className="prose mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed text-gray-800">
      <h1 className="text-2xl font-semibold">Termos de uso</h1>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        Modelo inicial para o piloto. Deve ser revisado por assessoria jurídica antes da comercialização.
      </p>
      <h2 className="mt-6 font-semibold">1. Serviço</h2>
      <p>Plataforma de gestão financeira gerencial para pequenos negócios. Os indicadores apresentados são gerenciais e não substituem demonstrações contábeis oficiais nem a orientação de um contador.</p>
      <h2 className="mt-6 font-semibold">2. Assinatura</h2>
      <p>O acesso é concedido por assinatura conforme o plano contratado. Em caso de atraso, após o período de carência, a conta passa a somente leitura; os dados não são apagados por inadimplência e podem ser exportados.</p>
      <h2 className="mt-6 font-semibold">3. Cancelamento</h2>
      <p>O cancelamento pode ser feito a qualquer momento e vale ao fim do período pago. Após o encerramento, os dados permanecem disponíveis para consulta e exportação pelo prazo de retenção informado na política de privacidade.</p>
      <h2 className="mt-6 font-semibold">4. Responsabilidades</h2>
      <p>O cliente é responsável pela veracidade dos lançamentos e pela gestão dos usuários que convida.</p>
    </article>
  );
}
