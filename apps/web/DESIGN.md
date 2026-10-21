# Obra360 — contrato visual (v2)

Referência para qualquer tela nova ou reforma. Tokens e classes vivem em
`src/index.css`; primitivas React em `src/components/ui.tsx`.

## Direção

Profissional, calmo e arredondado. Fundo claro azulado com brilho da marca,
cartões brancos com canto largo e sombra leve tingida de navy, barra lateral
navy flutuante. Movimento curto e com propósito (entrada em cascata, hover que
levanta, números que contam), sempre respeitando `prefers-reduced-motion`.

## Tipografia

- Texto e títulos: **Plus Jakarta Sans** (`font-sans` / `font-display`).
- Códigos (NC-2026-001, nº de RDO, CNPJ): **JetBrains Mono** (`font-mono`), só onde
  ajuda a ler o código — nunca para rótulos.
- Título de página: `text-[26px] font-bold tracking-[-0.025em]` (use `<PageHeader>`).
- Título de cartão: classe `card-title` (14px semibold).
- Rótulo/metadado: `text-[11.5px] font-medium text-ink-3` (ou `<Micro>`). **Sem**
  `font-mono uppercase tracking-[…]` em rótulos — esse padrão saiu.
- Números grandes: `font-display font-bold tracking-[-0.03em]` + `tabular`.

## Cores (tokens Tailwind)

`ink` `ink-2` `ink-3` · `line` `line-2` `field` · `page` `subtle` · `brand`
`brand-soft` `action` · `positive` `danger` `warn` · `navy-950/900/800/700`.

Tons suaves para avisos (fundo + texto + contorno):

| tom      | fundo          | texto           | contorno (ring)  |
|----------|----------------|-----------------|------------------|
| perigo   | `bg-[#fdeeec]` | `text-danger`   | `ring-[#f5d0cb]` |
| alerta   | `bg-[#fdf4e2]` | `text-warn`     | `ring-[#efdcb0]` |
| positivo | `bg-[#e8f6ed]` | `text-positive` | `ring-[#c4e5d0]` |
| info     | `bg-brand-soft`| `text-action`   | `ring-[#cfe7fb]` |

Nada de hex solto para hover de botão (`hover:bg-[#164a75]` etc.): use as classes.

## Cantos

`rounded` = 10px · `rounded-xl` = 14px · `rounded-2xl` = 18px · `rounded-3xl` = 24px.
Cartões `rounded-2xl`; caixas internas `rounded-xl`; chips `rounded-full`;
botões e campos já vêm arredondados pelas classes.

## Classes de componente

- `card` — cartão base. `card-hover` — levanta no hover. `card-head` — cabeçalho
  com divisória. `card-title`.
- `btn` + `btn-primary` (navy) | `btn-accent` (azul) | `btn-secondary` (branco com
  borda) | `btn-ghost` | `btn-danger`; tamanhos `btn-sm` (32px) e `btn-lg` (44px).
- `field` — input/select/textarea.
- `label` — rótulo de campo.
- `segmented` — trilho de abas/filtros; o item ativo é `bg-white shadow-sm text-ink`.
- `skeleton` — carregamento com brilho.
- `reveal` — entrada em cascata; ordem por `style={{ ["--i" as string]: n }}`
  (limite ~12 itens).
- `tabular` — números alinhados.
- Animações: `animate-page`, `animate-rise`, `animate-fade`, `animate-pop`,
  `animate-grow-x`, `animate-float`.

## Primitivas (`ui.tsx`)

`PageHeader`, `EmptyState`, `CountUp`, `ProgressRing`, `ProgressBar`,
`StatusChip`, `Micro`, `LogoMark`, `Wordmark` e ícones de traço (`Icon*`).
Para diálogos e painéis que entram/saem, `AnimatePresence` + `motion` de
`motion/react`.

## Layout

`Shell` é a rota-layout de tudo que exige login: barra lateral (recolhível, vira
gaveta no mobile) + trilha no topo + `<main>` com cantos de 22px. As telas
ocupam `h-full`; telas de leitura rolam por dentro (`h-full overflow-y-auto`) e
centralizam em `max-w-6xl`/`max-w-7xl` com `px-5 lg:px-8`.

Telas de trabalho em altura cheia (Tour, Plantas, Não conformidades) usam uma
barra de ferramentas branca translúcida no topo e painéis brancos lado a lado.

Sobreposições escuras do tour: vidro —
`rounded-2xl bg-[rgb(8_20_32/0.62)] text-white ring-1 ring-white/10 backdrop-blur-xl shadow-2xl`.
