# Modelo de dados e regras

## As três moedas

| | O que é | De onde vem | Para que serve |
|---|---|---|---|
| **Saldo gastável** | 70% de cada ganho | tarefas extras aprovadas | tela e privilégios |
| **Cofrinho** | 30% de cada ganho, automático | tarefas extras aprovadas | só a meta grande |
| **Mesada** | trilha separada, em reais | percentual da semana cumprido | dinheiro |

A divisão 70/30 é automática no crédito. Ela não precisa ter disciplina de poupar —
a estrutura poupa por ela. O resto da divisão inteira vai para o lado gastável
(50 pontos → 35 gastáveis + 15 no cofrinho), sempre a favor dela.

A mesada **não** sai do saldo de pontos. Se saísse, a mesma tarefa seria paga duas
vezes e o orçamento ficaria imprevisível.

## Tarefa básica x extra

- **básica** (`kind='basic'`, 0 pontos): dever. Conta para o percentual da mesada e
  para o streak, não paga pontos.
- **extra** (`kind='extra'`): paga pontos.

A separação é o que evita a criança que pergunta "quanto eu ganho pra isso?" antes
de escovar os dentes. Se você quiser inverter, é só pôr pontos numa tarefa básica —
não há nada no esquema que proíba.

## Mesada: fechamento semanal

`close_week()` conta as ocorrências da semana marcadas com
`counts_for_allowance` e calcula `aprovadas / elegíveis`. Pendente, recusada,
expirada ou em análise **não** contam como feitas.

| Cumprido na semana | Semana | No mês |
|---|---|---|
| < 50% | R$ 5,00 | — |
| 50–69% | R$ 8,50 | — |
| 70–84% | **R$ 12,50** | **R$ 50 — o que ela já recebe hoje** |
| ≥ 85% | R$ 15,00 | até R$ 60 |

Duas decisões deliberadas:

1. **Semanal, não mensal.** Mês é longe demais para 9 anos, e uma semana ruim no
   dia 5 contaminaria os outros 25 dias. Quatro fechamentos = quatro recomeços.
2. **O piso nunca é zero.** Se ela pudesse zerar, no dia em que isso ficasse
   matematicamente garantido ela pararia de fazer tudo pelo resto da semana.

Os R$ 50 ficam na faixa de 70%, não de 95%, de propósito: exigir quase perfeição
para ganhar o que ela já ganhava faz ela se sentir roubada.

Semana com `status='paid'` não é recalculada — `close_week` recusa.

## Ciclo de vida da ocorrência

```
                  (geração do dia)
                         │
                         ▼
   ┌──────────────────  pending  ──────────────────┐
   │                      │                        │
   │ claim_occurrence     │ passou da janela       │
   │                      ▼                        │
   │                   expired  (conta como não feita)
   ▼
precisa de aprovação?
   │               │
  não             sim
   │               │
   ▼               ▼
approved ◄──── claimed ────► rejected
(credita)      (sua fila)        │
                                 └─► claim_occurrence de novo
                                     (segunda chance, dentro da janela)
```

A janela de atraso (`late_window_days`, padrão 2) existe por um motivo prático: ela
**vai** esquecer de marcar uma tarefa que fez. Sem a janela, o streak quebra
injustamente e o app é abandonado no segundo mês.

## Por que não tem cron

`ensure_catch_up()` é chamada quando o app abre e gera um **intervalo** de dias
(padrão: últimos 14 + hoje), não só hoje.

Isso não é zelo: se ela ficar cinco dias sem abrir o app, os dias do meio nunca
teriam ocorrência, o denominador da mesada ficaria menor e o percentual sairia
**inflado** — ela receberia mesada cheia por uma semana que não cumpriu. Gerando
para trás, o dia que ela não abriu nasce `pending` e expira como não feito.

`close_week()` também gera os 7 dias da semana antes de contar, pelo mesmo motivo.

A geração é idempotente pelo `unique (task_id, profile_id, local_date)`, e nunca
cria ocorrência para antes de a tarefa existir (`created_at`).

## Datas locais, nunca timestamp

`task_occurrences.local_date` é `date`, resolvida no fuso da família
(`families.timezone`). Indexar o dia por timestamp UTC é a origem clássica do bug
"a tarefa pulou de dia".

## Snapshots

Cada ocorrência guarda `title_snapshot`, `points_snapshot`, `kind_snapshot`,
`counts_for_allowance_snapshot`, `requires_*_snapshot`. Mudar o preço de uma tarefa
hoje **não** reescreve o histórico de ontem. Vale o mesmo para resgates
(`cost_snapshot`).

Isso é importante na prática porque **a precificação vai estar errada na primeira
semana** — sempre está — e você vai mexer nos preços várias vezes no primeiro mês.

## Extrato imutável

Nunca existe `UPDATE saldo`. Só `INSERT` em `ledger_entries`, com motivo e
referência. Saldo = soma (`v_balances`).

- aprovar credita (`earn`)
- resgatar debita no **pedido** (`spend`) e devolve na recusa ou cancelamento
  (`refund`) — reserva, para evitar o caso chato de "aprovado mas sem saldo"
  quando ela pede duas coisas ao mesmo tempo
- corrigir erro é um lançamento novo (`adjust`), que **exige motivo**

Um índice único parcial garante no banco que uma ocorrência paga no máximo uma
vez, por mais que o app chame aprovar duas vezes.

## Segurança

A filha **lê** tudo da família e **escreve** em nada. A superfície de escrita dela
são três funções: `claim_occurrence`, `request_redemption`, `cancel_redemption`.

`task_occurrences`, `redemptions` e `ledger_entries` não têm política de escrita
nem grant de escrita — só as funções `SECURITY DEFINER` mexem nelas. A migração
revoga o `ALL` que o Supabase concede por padrão em tabelas novas, para que o RLS
não seja a única linha de defesa.

Com 9 anos isso é exagero. Com 11 e um amigo esperto que sabe que um APK pode ser
inspecionado, não é.

## O que o app NÃO faz

Não libera tempo de tela automaticamente. O Family Link não tem API pública, e o
Screen Time do iOS exige entitlement especial da Apple. O app é o **placar e o
contrato**: ele diz que ela tem 45 minutos acumulados, e você libera na mão.

`fulfill_redemption()` existe para você marcar que entregou de fato.
