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
| Esquema, funções, RLS | pronto e testado (15 casos) |
| Bucket das fotos | pronto |
| Seed calibrado | pronto |
| App dela (Hoje, Loja, Meta, Extrato) | pronto |
| App seu (Fila, Tarefas, Preços, Mesada) | pronto |
| Lógica de streak e mesada | pronto e testado (20 casos) |
| Push notification | pendente |
| Build do APK (EAS) | pendente |

## Rodar os testes

Nenhum dos dois precisa de Supabase nem de internet.

Regras do banco (sobe um Postgres local, aplica a migração e exercita as
regras, incluindo os casos de RLS):

```bash
./scripts/testar-db.sh
```

Lógica do app (streak, percentual da semana, faixas de mesada, datas):

```bash
cd mobile && ./scripts/testar-logica.sh
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

6. No app, crie o `.env`:

```bash
cd mobile && cp .env.example .env
```

Preencha com os dois valores do passo anterior. Enquanto isso não existir, o
app abre numa tela explicando o que falta em vez de quebrar.

## Rodar o app

```bash
cd mobile && npx expo start
```

Abra pelo Expo Go nos dois celulares. Cada um entra com o seu e-mail; depois
disso o app abre sozinho — ela nunca digita senha, porque a sessão fica guardada
no aparelho.

Para instalar de verdade (APK, sem loja), o próximo passo é o EAS Build.

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
