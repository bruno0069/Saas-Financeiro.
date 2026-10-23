import { expect, test, type Page } from "@playwright/test";

// Usa os dados fictícios de `npm run db:seed`.
const OWNER = { email: "dono@demo.local", password: "demonstracao123" };

// Entra uma única vez por execução e reaproveita os cookies: o login tem limite de tentativas por e-mail.
let cookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | null = null;

async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto("/app");
    return;
  }
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(OWNER.email);
  await page.getByLabel("Senha").fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|empresas)/);
  if (page.url().includes("/empresas")) {
    await page.getByRole("button", { name: "Acessar" }).first().click();
    await page.waitForURL(/\/app/);
  }
  cookies = await page.context().cookies();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "a página não deve ter rolagem horizontal").toBeLessThanOrEqual(1);
}

test("rotas protegidas redirecionam para o login", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("painel e telas principais carregam com dados persistidos e sem rolagem horizontal", async ({ page }, info) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Painel financeiro" })).toBeVisible();
  await expect(page.getByText("Saldo em contas")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/${info.project.name}-painel.png`, fullPage: true });
  for (const [path, heading] of [
    ["/app/pagar", "Contas a pagar"], ["/app/receber", "Contas a receber"], ["/app/contas", "Contas e saldos"],
    ["/app/lancamentos", "Movimentações"], ["/app/fluxo-de-caixa", "Fluxo de caixa"], ["/app/relatorios", "Relatórios"],
    ["/app/padaria/caixa", "Fechamento de caixa"], ["/app/padaria/producao", "Produção e margens"], ["/app/configuracoes", "Configurações"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/${info.project.name}${path.replaceAll("/", "-")}.png`, fullPage: true });
  }
});

test("lança despesa já paga e ela aparece em movimentações", async ({ page }, info) => {
  await login(page);
  await page.goto("/app/pagar?novo=1");
  const desc = `Embalagens E2E ${info.project.name} ${Date.now()}`;
  await page.getByLabel("Descrição").fill(desc);
  await page.getByLabel("Valor total").fill("123,45");
  await page.getByLabel("Categoria").selectOption({ label: "Embalagens" });
  await page.getByLabel(/Já foi pago/).check();
  await page.locator("#settleAccountId").selectOption({ label: "Banco do Bairro" });
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByText("Lançamento registrado e baixado.")).toBeVisible();
  await page.goto("/app/lancamentos");
  await expect(page.getByText(desc)).toBeVisible();
});

test("menu móvel abre e navega", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "somente no celular");
  await login(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Contas a receber" }).click();
  await expect(page.getByRole("heading", { name: "Contas a receber" })).toBeVisible();
});
