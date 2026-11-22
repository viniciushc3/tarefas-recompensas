# Tarefas & Recompensas

App de celular para delegar tarefas a uma criança e acompanhar no celular do
responsável. Ela marca o que fez, você confere, e as tarefas cumpridas viram
pontos (tela e privilégios), cofrinho (meta grande) e mesada.

- **Decisões de desenho e regras:** [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md)
- **Esquema:** `supabase/migrations/`
- **Testes das regras:** `tests/regras.sql` (13 casos, Postgres local, sem rede)

## Estado atual

| Parte | Situação |
|---|---|
| Esquema, funções, RLS | pronto e testado |
| Bucket das fotos | pronto |
| Seed calibrado | pronto |
| App (Expo) | scaffold criado, telas pendentes |
| Push notification | pendente |

## Rodar os testes

Não precisa de Supabase nem de internet — sobe um Postgres local, aplica a
migração e roda a bateria de regras:

```bash
./scripts/testar-db.sh
```

## Subir no Supabase

1. Crie o projeto em [supabase.com](https://supabase.com) (o plano gratuito é
   suficiente para duas pessoas).

2. No SQL Editor, rode nesta ordem:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_storage.sql
```

3. Em **Authentication → Users**, crie dois usuários com e-mail e senha: o seu e
   o dela. Copie os dois UUIDs.

4. Cole os UUIDs no topo de `supabase/seed.sql` e rode o arquivo no SQL Editor.

5. Em **Project Settings → API**, copie a URL do projeto e a chave `anon`.

Ela nunca digita senha: o app guarda a sessão dela no armazenamento seguro do
aparelho e entra sozinho.

## Calibração do catálogo

Os preços no seed vêm do teto que você definiu — no máximo ~40 min de tela por
dia. Precifique sempre **de trás pra frente**: decida o máximo aceitável num dia
perfeito e derive os preços disso, nunca o contrário.

Com o seed atual:

| Dia | Pontos | Gastáveis | Equivale a |
|---|---|---|---|
| Dia útil | 90–105 | 63–74 | 32–37 min de tela |
| Fim de semana | 130 | 91 | 46 min de tela |

O cofrinho acumula ~28 pontos/dia, cerca de 850/mês. A meta grande de 4.000
pontos leva aproximadamente 4 meses e meio.

Conte que a primeira semana vai estar mal calibrada — preços são editáveis no app
sem recompilar nada.

## Antes de instalar

Vale conversar com ela antes, e deixá-la escolher duas ou três coisas: quais
privilégios entram no catálogo, qual é a meta grande, qual a foto. Criança que
ajudou a escrever a regra cumpre a regra; criança que recebeu o app pronto testa
onde ele quebra.

E deixe explícito que os R$ 50 continuam sendo o esperado, não um prêmio novo —
caso contrário a mudança é sentida como punição, não como oportunidade.
