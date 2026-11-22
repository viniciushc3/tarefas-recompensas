# As regras, e por que são assim

## Tarefa básica x extra

- **básica**: dever. Conta para o percentual da mesada e para o streak, não paga
  pontos.
- **extra**: paga pontos.

A separação evita a criança que pergunta "quanto eu ganho pra isso?" antes de
escovar os dentes. Para inverter, é só pôr pontos numa tarefa básica na
planilha — nada no código proíbe.

## Mesada: semanal, escalonada, com piso

| Cumprido na semana | Semana | No mês |
|---|---|---|
| < 50% | R$ 5,00 | — |
| 50–69% | R$ 8,50 | — |
| 70–84% | **R$ 12,50** | **R$ 50 — o que ela já recebe hoje** |
| ≥ 85% | R$ 15,00 | até R$ 60 |

Três decisões deliberadas:

**Semanal, não mensal.** Mês é longe demais para 9 anos, e uma semana ruim no
dia 5 contaminaria os outros 25 dias. Quatro fechamentos = quatro recomeços.

**O piso nunca é zero.** Se ela pudesse zerar, no dia em que isso ficasse
matematicamente garantido ela pararia de fazer tudo pelo resto da semana.

**Os R$ 50 ficam em 70%, não em 95%.** Ela já recebe esse dinheiro hoje, sem
condição nenhuma. Exigir quase perfeição para manter o que já era dela é sentido
como punição, não como oportunidade — e funciona por três semanas, até virar
birra. Em 70% a mensagem é "o normal continua normal, e dá para subir".

Semana marcada como paga não é recalculada.

## Ciclo da tarefa

```
      (geração do dia)
             │
             ▼
   ┌───── pendente ─────┐
   │         │          │
   │ marcar  │ passou   ▼
   │         │ do prazo  expirada  (conta como não feita)
   ▼
precisa de aprovação?
   │            │
  não          sim
   │            │
   ▼            ▼
aprovada ◄── marcada ──► recusada
(credita)   (sua fila)       │
                             └──► pode marcar de novo, dentro do prazo
```

A **janela de atraso** (2 dias) existe por um motivo prático: ela **vai**
esquecer de marcar algo que fez. Sem a janela o streak quebra injustamente e o
app é abandonado no segundo mês.

**Desmarcar** é o mesmo gesto no sentido contrário, dentro da mesma janela, e
devolve exatamente os pontos que a tarefa pagou (um lançamento de estorno, já
que o extrato nunca apaga nada). Nenhum dos dois sentidos pede confirmação:
cada um desfaz o outro. A única recusa é quando os pontos já foram gastos —
saldo negativo confundiria mais do que ajudaria.

## Geração dos dias

`garantirDias()` roda a cada chamada e gera um **intervalo** de 14 dias para
trás, não só hoje.

Isso não é zelo. Se ela ficar cinco dias sem abrir, os dias do meio nunca
teriam ocorrência, o denominador da mesada ficaria menor e o percentual sairia
**inflado** — ela receberia mesada cheia por uma semana que não cumpriu.
Gerando para trás, o dia que ela não abriu nasce pendente e expira como não
feito.

Pelo mesmo raciocínio, mas na direção oposta: nenhuma ocorrência é criada para
**antes de a tarefa existir** (`criada_em`). Sem isso, no dia em que você
instala, os 14 dias anteriores nasceriam e expirariam como não feitos, e a
primeira semana apareceria como 11% cumprida — parecendo fracasso antes de ela
ter tido chance de fazer qualquer coisa.

## Snapshots

Cada ocorrência guarda o título, o emoji, os pontos e as regras **do dia em que
nasceu**. Mudar o preço de uma tarefa hoje não reescreve o histórico de ontem.
Vale o mesmo para resgates.

Isso importa na prática porque você vai mexer nos preços várias vezes no
primeiro mês.

## Extrato só cresce

Nunca existe edição de saldo. Saldo é a **soma** da aba `Extrato`.

- aprovar credita (`ganho`), dividido 70/30
- resgatar debita no **pedido** (`gasto`) e devolve na recusa ou cancelamento
  (`devolucao`) — reserva, para evitar "aprovado mas sem saldo" quando ela pede
  duas coisas ao mesmo tempo
- corrigir erro é lançamento novo (`ajuste`), com **motivo obrigatório**

Uma ocorrência paga no máximo uma vez, mesmo que a aprovação seja chamada duas
vezes. Uma planilha é um livro-caixa por natureza; essa parte ficou mais simples
do que seria num banco de dados.

## Papéis

O código de acesso define quem é, e **quem confere é o script**, não a página.
A filha não aprova tarefa, não ajusta pontos, não fecha semana e não recebe o
link da planilha — mesmo que mexa no app, que é um arquivo HTML público.

A URL do app da web é pública por necessidade (o celular dela não faz login no
Google). A barreira é o código: 8 caracteres de um alfabeto de 32.

## Offline, e sincronização invisível

A página é local-first. Ela desenha do `localStorage` e guarda as marcações numa
fila, que sobe quando a rede volta.

**A sincronização não aparece na tela.** Nada de "enviando", "esperando
internet" ou selo em cada cartão: isso contava para uma criança de 9 anos um
problema que não é dela, e fazia a tela se mexer sozinha depois do toque. O
estado vai para um atributo do `body`, que só os testes leem. O que ela vê é
erro de regra — "passou do prazo", "você já gastou esses pontos" — e mais nada.

Três regras sustentam isso:

1. **A tela nunca anda para trás.** Quando a resposta chega, o que ainda está
   na fila é reaplicado por cima dela. Sem isso, uma resposta que já estava a
   caminho chegava sem as marcações recentes e apagava quatro toques da tela.
2. **Só redesenha se mudou.** Compara um resumo do que está desenhado antes e
   depois; quase sempre o servidor só confirma o que ela já viu, e aí não se
   toca na tela.
3. **Nada pesado no caminho do toque.** O cartão tocado é repintado sozinho, e
   a gravação do estado no aparelho fica para 400ms depois.

Erro de regra do servidor descarta o item da fila — insistir não ajudaria. Erro
de rede mantém, e uma ação feita durante um envio dispara outro envio assim que
o primeiro termina.

## Fotos

Tarefa com `precisa_foto` abre a câmera ao ser marcada e sempre vai para a fila
de aprovação — foto que ninguém olha não serve para nada.

A imagem é reduzida no celular (1200px, qualidade 65%) antes de subir: foto de
celular tem de 3 a 8 MB, e isso é a diferença entre esperar dois segundos e
esperar meio minuto no 4G.

Fica no Drive **sem compartilhamento**. O app busca a imagem pelo próprio
script, protegido pelo código, e o script confere que o arquivo pedido pertence
a uma ocorrência desta planilha. Sem essa conferência, quem tivesse um código
poderia ler qualquer arquivo do Drive de quem publicou — o script roda como
essa pessoa.

Desmarcar guarda a foto: remarcar a mesma tarefa no mesmo dia não pede outra.

## Arredondamento

A divisão do cofrinho arredonda **a favor dela**: 25 pontos viram 18 gastáveis e
7 no cofrinho, não 17 e 8. Uma tarefa de 1 ponto não some.
