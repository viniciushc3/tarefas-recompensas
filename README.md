# Tarefas e Recompensas

Uma página só, hospedada no GitHub Pages, conversando com uma **planilha do
Google** através do **Apps Script**. Ela marca o que fez no celular dela, você
confere no seu, e as tarefas viram pontos, cofrinho e mesada.

Sem app para instalar, sem loja, sem servidor. A planilha é o banco de dados
**e** o seu painel de administração.

- **Como testar:** `./scripts/testar.sh` (113 testes, sem Google e sem rede)
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

Tarefas e recompensas se criam e editam **no próprio app**, na aba **Editar** do
seu celular: nome, emoji, pontos, horário, recorrência, se precisa da sua
aprovação. Não precisa abrir a planilha para o dia a dia.

A planilha continua sendo a verdade, e no computador ela é melhor para o que é
raro ou em lote: faixas da mesada, conferir histórico, corrigir algo na mão.
Linha digitada lá precisa só do título — o script completa o resto.

| Aba | Para quê |
|---|---|
| `Tarefas` | criar, mudar pontos, horário, recorrência, desativar |
| `Recompensas` | preços, o que entra na loja, a meta grande |
| `Faixas` | os valores da mesada por percentual |
| `Config` | fuso, taxa do cofrinho, janela de atraso, teto de tela, senhas, qualidade da foto |
| `Ocorrencias`, `Extrato`, `Resgates`, `Semanas` | histórico — não precisa mexer |

A planilha também ganha um menu **Tarefas** com atalhos para instalar, gerar os
dias, ver os códigos e rodar um diagnóstico.

### Criar uma tarefa pela planilha

Pelo app é mais rápido (aba **Editar → + Nova tarefa**). Mas se preferir a
planilha, escreva uma linha nova na aba `Tarefas`. **Só o título é
obrigatório** — o resto o script completa sozinho na próxima vez que o app
abrir, e as colunas de escolha são listas suspensas, então não dá para errar a
grafia.

| Coluna | O que é | Em branco vira |
|---|---|---|
| `titulo` | o nome que ela vê | — (obrigatório) |
| `icone` | um emoji; é como ela identifica antes de ler | vazio |
| `tipo` | `extra` paga pontos, `basica` é dever | `extra` |
| `pontos` | quanto paga (0 para `basica`) | `0` |
| `periodo` | `manha`, `tarde`, `noite`, `qualquer` | `qualquer` |
| `recorrencia` | `diaria`, `semana` (seg–sex), `fimdesemana`, `dias`, `avulsa` | `diaria` |
| `dias` | com `dias`: `1,3,5` (0=dom). Com `avulsa`: a data, `2026-12-24` | vazio |
| `precisa_aprovacao` | `sim` manda para a sua fila; `nao` credita na hora | `nao` |
| `precisa_foto` | ela fotografa ao marcar; implica aprovação | `nao` |
| `conta_mesada` | entra no percentual da semana e no streak | `sim` |
| `ativa` | `nao` para de gerar; o histórico fica | `sim` |
| `id`, `criada_em` | o script preenche | — |

Deixe `precisa_aprovacao` em `nao` para o que você vê de qualquer jeito. Se tudo
precisar da sua confirmação, você vira o gargalo e o app morre na terceira
semana.

`criada_em` existe para a tarefa nova **não** nascer com ocorrências atrasadas
nos dias anteriores, que entrariam como não feitas e derrubariam a semana dela.

Para desativar uma tarefa, ponha `ativa` em `nao` — não apague a linha, senão o
histórico perde a referência.

### Criar uma recompensa pela planilha

Mesma ideia na aba `Recompensas`: título e custo bastam.

| Coluna | O que é | Em branco vira |
|---|---|---|
| `titulo`, `icone` | o que ela vê na loja | — / vazio |
| `tipo` | `tela`, `privilegio` ou `meta` | `privilegio` |
| `bolso` | `gastavel` ou `cofrinho` | `gastavel` (`cofrinho` se for `meta`) |
| `custo` | preço em pontos | — (obrigatório) |
| `minutos` | só para `tela`: quantos minutos vale | `0` |

Só `meta` sai do cofrinho — é isso que impede ela de gastar a poupança da meta
grande em tela.

**Conte que a primeira semana vai estar mal calibrada.** Sempre está. O jeito
certo é precificar **de trás pra frente**: decida o máximo de tela que você
aceita num dia perfeito e derive os preços disso. A aba Ajustes do seu app
mostra quanto o catálogo está liberando.

Com o conteúdo inicial: dia útil completo dá 90 a 105 pontos, ou seja 63 a 74
gastáveis — 32 a 37 minutos de tela, dentro de um teto de 40. O cofrinho junta
uns 28 por dia, e a meta de 4.000 leva uns 4 meses e meio.

## Fotos

Uma tarefa pode pedir foto (`precisa_foto`, ou o controle "Pede foto" na aba
Editar). Ao marcar, abre a câmera; a imagem é reduzida a 1200px e vai para uma
pasta no Drive de quem publicou o script. Na sua fila ela aparece acima dos
botões de aprovar.

**A pasta fica sem compartilhamento.** O app não usa link do Drive: pede a
imagem ao próprio script, que só responde a quem tem código, e o script confere
que o arquivo pedido pertence mesmo a uma ocorrência desta planilha — sem essa
conferência, um código daria acesso a qualquer arquivo do seu Drive.

A imagem não viaja junto com o estado; é buscada só quando alguém vai olhar.
E foto exige internet: se não houver, o app diz isso em vez de fingir que
marcou.

**Tamanho.** Medido com uma foto de celular de 3000×4000:

| `qualidade_foto` | Resolução | Tamanho |
|---|---|---|
| `baixa` (padrão) | 480×640 | ~58 KB |
| `media` | 675×900 | ~113 KB |
| `alta` | 900×1200 | ~230 KB |

Baixa basta para responder "a cama está arrumada?", e o tamanho pesa duas
vezes: no envio dela e de novo quando você abre a fila. Troque em
`qualidade_foto`, na aba Config.

## Duas telas, dois temas

A dela é macia, clara ou escura à escolha dela (aba Extrato); a sua é escura.
Tocar no nome, no topo, sai da conta — com confirmação, porque voltar exige a
senha.

## O acesso

O site é público e o endereço do Apps Script está no código dele. **A senha é a
única coisa entre um estranho e os dados da sua família**, fotos inclusive —
repositório público é indexado e varrido por robôs.

Por isso ela não some. O que some é o trabalho de digitar:

- a senha pode ser o que você quiser, escolhida em `codigo_pai` e
  `codigo_filha` na aba Config. Maiúscula não faz diferença
- o app do pai, em Ajustes, monta um **link que já entra**:
  `…/#c=senha`. Mande para o celular dela uma vez; ela abre e nunca mais
  digita nada. O link público continua pedindo senha, e a senha some da barra
  de endereço assim que é guardada

## Quando algo parecer estranho

Abra o site com `#debug` no fim do endereço:

```
https://viniciushc3.github.io/tarefas-recompensas/#debug
```

Aparece uma faixa preta no rodapé registrando cada conversa com a planilha:
quanto demorou e **exatamente** quais tarefas mudaram de estado. Linha em
vermelho é tarefa que voltou para pendente — o sintoma de a tela andar para
trás. Serve para responder com dado em vez de impressão.

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
