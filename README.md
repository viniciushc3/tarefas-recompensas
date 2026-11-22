# Tarefas e Recompensas

Uma página só, hospedada no GitHub Pages, conversando com uma **planilha do
Google** através do **Apps Script**. Ela marca o que fez no celular dela, você
confere no seu, e as tarefas viram pontos, cofrinho e mesada.

Sem app para instalar, sem loja, sem servidor. A planilha é o banco de dados
**e** o seu painel de administração.

- **Como testar:** `./scripts/testar.sh` (44 testes, sem Google e sem rede)
- **As decisões de desenho:** [`docs/regras.md`](docs/regras.md)

## As três moedas

| | O que é | De onde vem | Para que serve |
|---|---|---|---|
| **Saldo gastável** | 70% de cada ganho | tarefas extras aprovadas | tela e privilégios |
| **Cofrinho** | 30% de cada ganho, automático | tarefas extras aprovadas | só a meta grande |
| **Mesada** | trilha separada, em reais | percentual da semana | dinheiro |

A divisão 70/30 é automática. Ela não precisa ter disciplina de poupar — a
estrutura poupa por ela.

## Montar (uma vez)

**1. A planilha.** Crie uma planilha nova no Google Sheets. Em
**Extensões → Apps Script**, apague o conteúdo e cole
[`apps-script/Codigo.gs`](apps-script/Codigo.gs) inteiro. Salve.

**2. Instalar.** No editor de script, escolha a função `instalar` e clique em
**Executar**. Autorize quando pedir. Ele cria as abas, as tarefas, as
recompensas, as faixas da mesada e mostra **os dois códigos de acesso** —
anote.

**3. Publicar.** **Implantar → Nova implantação → App da Web**:

- Executar como: **eu**
- Quem pode acessar: **qualquer pessoa**

Copie a URL que termina em `/exec`.

> "Qualquer pessoa" assusta, mas é necessário: o celular dela não faz login no
> Google. Quem tem a URL e não tem código não consegue nada — toda ação exige
> um código válido, e são 8 caracteres de 32 possíveis.

**4. O site.** Em **Settings → Pages** do repositório, ligue o Pages na branch
`main`. O endereço fica `https://SEU-USUARIO.github.io/tarefas-recompensas/`.

**5. Nos celulares.** Abra o endereço no Chrome e digite o código da pessoa.
Depois use **⋮ → Adicionar à tela inicial** — vira ícone e abre em tela cheia,
igual a um app.

A URL do passo 3 já está fixa na constante `API_URL`, no topo do `<script>` do
`index.html`. Se você publicar uma implantação nova, troque ali. Um endereço
digitado no aparelho tem prioridade sobre o fixo, o que serve para apontar um
celular para outra planilha sem mexer no código.

## Viver com isso

Tudo que você vai querer mudar está **na planilha**, não no código:

| Aba | Para quê |
|---|---|
| `Tarefas` | criar, mudar pontos, horário, recorrência, desativar |
| `Recompensas` | preços, o que entra na loja, a meta grande |
| `Faixas` | os valores da mesada por percentual |
| `Config` | fuso, taxa do cofrinho, janela de atraso, teto de tela, códigos |
| `Ocorrencias`, `Extrato`, `Resgates`, `Semanas` | histórico — não precisa mexer |

A planilha também ganha um menu **Tarefas** com atalhos para instalar, gerar os
dias e ver os códigos.

**Conte que a primeira semana vai estar mal calibrada.** Sempre está. O jeito
certo é precificar **de trás pra frente**: decida o máximo de tela que você
aceita num dia perfeito e derive os preços disso. A aba Ajustes do seu app
mostra quanto o catálogo está liberando.

Com o conteúdo inicial: dia útil completo dá 90 a 105 pontos, ou seja 63 a 74
gastáveis — 32 a 37 minutos de tela, dentro de um teto de 40. O cofrinho junta
uns 28 por dia, e a meta de 4.000 leva uns 4 meses e meio.

## O que o app não faz

Não libera tempo de tela automaticamente — o Family Link não tem API pública.
O app é o **placar e o contrato**: ele diz que ela tem 45 minutos acumulados, e
você libera na mão. O botão "Já liberei" é só o seu registro de que fez.

## Antes de instalar

Converse com ela antes, e deixe-a escolher duas ou três coisas: quais
privilégios entram no catálogo, qual é a meta grande, qual o emoji. Criança que
ajudou a escrever a regra cumpre a regra; criança que recebeu o app pronto testa
onde ele quebra.

E deixe explícito que os R$ 50 continuam sendo o esperado, não um prêmio novo.
