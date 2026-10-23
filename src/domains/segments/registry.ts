/**
 * Registro de segmentos. Um segmento define CONFIGURAÇÃO INICIAL (categorias, módulos sugeridos,
 * rótulos e indicadores) — nunca altera o núcleo financeiro. Novos segmentos entram aqui.
 */
export type SeedCategory = { name: string; kind: "income" | "expense"; code?: string };

export type SegmentDef = {
  key: string;
  name: string;
  description: string;
  categories: SeedCategory[];
  defaultModules: string[];
  /** Indicadores específicos exibidos no painel (implementados pelo módulo correspondente). */
  kpis: string[];
  labels: { customer: string; sale: string };
  suggestedAccounts: { name: string; kind: "cash" | "checking" | "digital_wallet" | "card_receivables" }[];
};

/** Categorias comuns a todos os segmentos (códigos usados pelo núcleo). */
export const CORE_CATEGORIES: SeedCategory[] = [
  { name: "Outras receitas", kind: "income", code: "core.other_income" },
  { name: "Rendimentos financeiros", kind: "income", code: "core.financial_income" },
  { name: "Taxas de cartão e meios de pagamento", kind: "expense", code: "core.card_fees" },
  { name: "Tarifas bancárias", kind: "expense", code: "core.bank_fees" },
  { name: "Impostos e tributos", kind: "expense", code: "core.taxes" },
  { name: "Aluguel", kind: "expense", code: "core.rent" },
  { name: "Folha de pagamento", kind: "expense", code: "core.payroll" },
  { name: "Energia elétrica", kind: "expense", code: "core.energy" },
  { name: "Água", kind: "expense", code: "core.water" },
  { name: "Internet e telefone", kind: "expense", code: "core.telecom" },
  { name: "Retirada dos sócios (pró-labore)", kind: "expense", code: "core.owner_draw" },
  { name: "Outras despesas", kind: "expense", code: "core.other_expense" },
];

export const SEGMENTS: Record<string, SegmentDef> = {
  padaria: {
    key: "padaria",
    name: "Padaria",
    description: "Padarias, confeitarias e panificadoras.",
    categories: [
      { name: "Vendas no balcão", kind: "income", code: "padaria.vendas_balcao" },
      { name: "Encomendas e festas", kind: "income", code: "padaria.encomendas" },
      { name: "Vendas para revenda (atacado)", kind: "income", code: "padaria.revenda" },
      { name: "Sobra de caixa", kind: "income", code: "padaria.sobra_caixa" },
      { name: "Insumos e matéria-prima", kind: "expense", code: "padaria.insumos" },
      { name: "Produtos para revenda", kind: "expense", code: "padaria.revenda_compra" },
      { name: "Embalagens", kind: "expense", code: "padaria.embalagens" },
      { name: "Gás", kind: "expense", code: "padaria.gas" },
      { name: "Manutenção de equipamentos", kind: "expense", code: "padaria.manutencao" },
      { name: "Quebra de caixa", kind: "expense", code: "padaria.quebra_caixa" },
    ],
    defaultModules: ["padaria.caixa", "padaria.producao"],
    kpis: ["padaria.vendas_por_forma", "padaria.ticket_medio", "padaria.recebiveis_cartao", "padaria.quebra_caixa",
           "padaria.perdas", "padaria.custo_insumos"],
    labels: { customer: "Cliente", sale: "Venda" },
    suggestedAccounts: [
      { name: "Caixa da loja", kind: "cash" },
      { name: "Conta bancária", kind: "checking" },
      { name: "Recebíveis de cartão", kind: "card_receivables" },
    ],
  },
  mercadinho: {
    key: "mercadinho",
    name: "Mercadinho de bairro",
    description: "Mercearias e minimercados.",
    categories: [
      { name: "Vendas de mercadorias", kind: "income", code: "varejo.vendas" },
      { name: "Compra de mercadorias", kind: "expense", code: "varejo.compras" },
      { name: "Embalagens", kind: "expense", code: "varejo.embalagens" },
    ],
    defaultModules: [],
    kpis: [],
    labels: { customer: "Cliente", sale: "Venda" },
    suggestedAccounts: [{ name: "Caixa da loja", kind: "cash" }, { name: "Conta bancária", kind: "checking" }],
  },
  servicos: {
    key: "servicos",
    name: "Empresa de prestação de serviços",
    description: "Prestadores de serviço em geral.",
    categories: [
      { name: "Receita de serviços", kind: "income", code: "servicos.receita" },
      { name: "Contratos recorrentes", kind: "income", code: "servicos.recorrente" },
      { name: "Custos de execução", kind: "expense", code: "servicos.custos" },
      { name: "Comissões", kind: "expense", code: "servicos.comissoes" },
    ],
    defaultModules: [],
    kpis: [],
    labels: { customer: "Cliente", sale: "Serviço" },
    suggestedAccounts: [{ name: "Conta bancária", kind: "checking" }],
  },
  outro: {
    key: "outro",
    name: "Outro segmento",
    description: "Configuração genérica com o núcleo financeiro.",
    categories: [
      { name: "Vendas", kind: "income", code: "generico.vendas" },
      { name: "Compras", kind: "expense", code: "generico.compras" },
    ],
    defaultModules: [],
    kpis: [],
    labels: { customer: "Cliente", sale: "Venda" },
    suggestedAccounts: [{ name: "Caixa", kind: "cash" }, { name: "Conta bancária", kind: "checking" }],
  },
};

export function getSegment(key: string): SegmentDef {
  return SEGMENTS[key] ?? SEGMENTS.outro;
}

export function isSegmentKey(key: string): boolean {
  return key in SEGMENTS;
}

export function seedCategoriesFor(segment: string): SeedCategory[] {
  return [...getSegment(segment).categories, ...CORE_CATEGORIES];
}
