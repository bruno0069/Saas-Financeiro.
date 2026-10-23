import type { Permission } from "../access/permissions";
import type { FeatureKey } from "../billing/catalog";

/**
 * Cada módulo declara requisitos, permissões, dependências e efeitos financeiros.
 * Um módulo só está disponível quando: (1) o plano/override concede a funcionalidade,
 * (2) não está desligado globalmente pela plataforma e (3) a empresa o mantém habilitado.
 */
export type ModuleDef = {
  key: string;
  name: string;
  description: string;
  segments: string[] | "*";
  feature: FeatureKey;
  permissions: Permission[];
  dependsOn: string[];
  financialEffects: string[];
  nav: { href: string; label: string; permission: Permission }[];
};

export const MODULES: Record<string, ModuleDef> = {
  "padaria.caixa": {
    key: "padaria.caixa",
    name: "Fechamento de caixa",
    description: "Registro diário das vendas por forma de pagamento, sangrias, conferência do caixa e recebíveis de cartão.",
    segments: ["padaria"],
    feature: "module.padaria.caixa",
    permissions: ["padaria.caixa.operate", "padaria.caixa.manage"],
    dependsOn: [],
    financialEffects: [
      "Vendas em dinheiro e PIX: conta a receber liquidada no dia, na conta configurada (núcleo: títulos + baixas).",
      "Vendas em cartão/vale: conta a receber pelo valor bruto com vencimento D+N e conta a pagar da taxa da maquininha.",
      "Sangrias: transferência entre contas próprias (caixa → cofre/banco), sem efeito em receitas/despesas.",
      "Diferença de caixa: receita 'Sobra de caixa' ou despesa 'Quebra de caixa', liquidada no caixa.",
      "Estorno do fechamento: estorna baixas e transferências e cancela os títulos gerados.",
    ],
    nav: [{ href: "/app/padaria/caixa", label: "Fechamento de caixa", permission: "padaria.caixa.operate" }],
  },
  "padaria.producao": {
    key: "padaria.producao",
    name: "Produção e margens",
    description: "Fichas técnicas com custo de insumos, margem por produto e registro de perdas (sobras, queimados, vencidos).",
    segments: ["padaria"],
    feature: "module.padaria.producao",
    permissions: ["padaria.producao.view", "padaria.producao.manage"],
    dependsOn: [],
    financialEffects: [
      "Nenhuma movimentação financeira direta. Compras de insumos devem ser lançadas em Contas a pagar (categoria Insumos).",
      "Perdas são indicadores gerenciais valorizados a custo estimado; não geram lançamentos.",
    ],
    nav: [{ href: "/app/padaria/producao", label: "Produção e margens", permission: "padaria.producao.view" }],
  },
};

export function modulesForSegment(segment: string): ModuleDef[] {
  return Object.values(MODULES).filter((m) => m.segments === "*" || m.segments.includes(segment));
}
