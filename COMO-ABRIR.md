# Como abrir o programa no seu computador

Você só precisa instalar **uma coisa** (o Node.js) e depois clicar em um arquivo.

## 1. Instale o Node.js (só uma vez)

1. Acesse **https://nodejs.org/pt** e baixe a versão **LTS** (botão verde).
2. Instale clicando em "Avançar" até o fim (pode manter todas as opções padrão).

## 2. Baixe o programa

1. No GitHub, abra o repositório e selecione a branch `claude/saas-financeira-multitenant-u13sgx`.
2. Clique no botão verde **Code** → **Download ZIP**.
3. Descompacte o ZIP em uma pasta (ex.: Documentos). Evite pastas sincronizadas com OneDrive/iCloud.

## 3. Clique para abrir

| Seu computador | Clique duas vezes em |
|---|---|
| Windows | `Iniciar (Windows).bat` — se aparecer "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. |
| Mac | `Iniciar (Mac).command` — na primeira vez, clique com o **botão direito → Abrir → Abrir**. |
| Linux | `iniciar-linux.sh` (ou `bash iniciar-linux.sh` no terminal) |

Uma janela preta (terminal) vai aparecer mostrando o progresso.

* **Na primeira vez** demora alguns minutos: ele baixa os componentes, cria um banco de dados próprio
  dentro da pasta e prepara o programa. Precisa de internet.
* **Nas próximas vezes** abre em poucos segundos.

Quando estiver pronto, o **navegador abre sozinho** na tela de login. Se não abrir, acesse o endereço
mostrado na janela (normalmente http://localhost:3000).

## 4. Entre com os usuários de demonstração

| Para ver… | E-mail | Senha |
|---|---|---|
| O sistema como cliente (Padaria Demonstração) | `dono@demo.local` | `demonstracao123` |
| O painel de administração da plataforma | `admin@demo.local` | `demonstracao123` |

Todos os dados de demonstração são **fictícios**. Você também pode criar uma conta nova pela tela
"Criar conta" e cadastrar sua própria empresa.

## Fechar e recomeçar

* **Fechar:** feche a janela preta (ou pressione `Ctrl + C` nela). Os dados ficam salvos.
* **Começar do zero:** com o programa fechado, apague a pasta oculta `.local-db` dentro da pasta do programa.

> Esta forma de execução é para **conhecer e testar** no seu computador. Para colocar no ar para
> clientes reais, siga `docs/OPERACAO.md`.
