# Obra360 — Fluxo de Não Conformidade entre Fiscalização e Construtora

> Prompt de implementação. Cada obra pertence a uma construtora contratada por um órgão
> público; a fiscalização analisa inconsistências e as submete formalmente para reparo.

## Contexto do projeto

Repositório em `C:\Users\evert\Obras 3D`. Frontend em `apps/web`: React 18 + TypeScript +
Vite 5 + Tailwind v4 + Zustand + react-router-dom v6. **Não há backend** — tudo persiste em
localStorage via `src/lib/persist.ts`, com auto-save debounced no `src/store.ts`.

Leia antes de codar, para reaproveitar em vez de reinventar:

- `src/types.ts` — `Issue` (já tem `levelId`, `origin`, `floorplanId`/`pinId`, `rdoId`,
  `pose`, `verifications`), `Floorplan`, `Rdo`, `TourPose`
- `src/store.ts` — Zustand, `PERSISTED`, `addIssue`, `verifyIssue`, `requestFlyTo`,
  `requestFlyToPose`
- `src/lib/journey.ts` — consultas que cruzam os módulos
- `src/lib/matterport.ts` — `flyToPose`, screenshot via `Renderer.takeScreenShot`
- `src/components/MatterportViewer.tsx` (exporta `mpState.sdk`), `PlanMini.tsx`,
  `IssuePanel.tsx`, `RichText.tsx`, `ui.tsx`
- `src/pages/Rdo.tsx` e `Report.tsx` — padrão dos documentos imprimíveis

**Design system (obrigatório):** navy `#0E3656`, ação `#0074C8`, marca `#009BFF`, positivo
`#3E8E62`, alerta `#8A6116`, perigo `#B3382E`, fundo `#F2F5F8`. Archivo (display), IBM Plex
Sans (texto), IBM Plex Mono (dados). Bordas de 1px, sem sombras, ícones de traço,
**zero emoji**. Comentários em português explicando o *porquê*.

## 1. Modelo de dados (`src/types.ts`)

`Contractor` (razão social, CNPJ, responsável técnico, CREA, e-mail, preposto),
`Contract` (número, processo, órgão contratante, vigência, valor, fiscal e gestor
designados, portaria, prazos de reparo por severidade). `Project` ganha `contractorId` e
`contract`.

`Issue` é estendida, mantendo compatibilidade com o que já está gravado: `code`
(`NC-2026-014`), `ncStatus`, `norma`, `deadline`, `evidences[]`, `events[]`, `reopenCount`,
`contestation`.

## 2. Máquina de estados — fonte única em `src/lib/nc-flow.ts`

`rascunho → notificada → ciente → em_reparo → reparo_submetido → sanada`, com os ramos
`contestada` e `cancelada`. **Reprovar** não é estado: devolve para `em_reparo` e incrementa
`reopenCount`. **Vencida** é derivado de `deadline < hoje`.

`available(nc, role)` e `apply(nc, action, payload)`. Nenhum componente decide transição por
conta própria, e toda transição grava um evento.

Prazo por severidade (padrão): crítica 2 dias, alta 7, média 15, baixa 30.

## 3. Perfil ativo (sem autenticação)

Seletor no `Shell.tsx`: Fiscalização / Construtora / Gestor. Muda as **ações oferecidas**,
nunca esconde dado. A interface diz que é seletor de demonstração, não login.

## 4. Telas

- **Triagem** — a IA devolve inconsistências candidatas; o fiscal aceita, edita ou descarta.
  A IA nunca abre NC sozinha.
- **Abertura no viewer** — pavimento, ambiente, disciplina, severidade (mostra o prazo),
  norma/cláusula, descrição e **foto obrigatória** com a `pose`.
- **Caixa de entrada da construtora** — ordenada por prazo, com semáforo. Dar ciência,
  iniciar reparo, submeter reparo (foto obrigatória), contestar.
- **Fila de verificação** — par antes/depois lado a lado, ir ao ponto no tour, aprovar
  (com foto) ou reprovar (com motivo).
- **Painel do contrato** — abertas, vencidas, tempo médio de reparo, taxa de reprovação,
  reincidência.

## 5. Documentos imprimíveis

Notificação de Não Conformidade; Comunicado de Reparo Executado; Termo de Verificação e
Encerramento (com o trio abertura / reparo / verificação); Reiteração de notificação.

## 6. Tramitação sem backend

"Enviar à construtora" e "devolver à fiscalização" geram um **pacote de tramitação**: um
`.json` reimportável e um `.html` autocontido com as imagens embutidas. A importação concilia
por `code`, é idempotente e nunca sobrescreve estado mais recente.

## 7. Regras inegociáveis

- Evidência fotográfica obrigatória na abertura, no reparo e na verificação
- Reprovar, cancelar e contestar exigem motivo
- Nada é apagado: cancelamento é estado, com autor e motivo
- Prazo alterado é evento com justificativa
- Toda NC tem autor humano, mesmo quando nasceu de sugestão da IA
- **Não simule assinatura digital** — capture nome, cargo, CREA e data/hora do aceite, e
  diga no documento exatamente o que aquilo é

## 8. Não faça

Backend, autenticação, biblioteca de estado nova. Não quebre Plantas, RDO, Visita guiada,
Viewer nem `lib/journey.ts`. Não invente dados na saída da IA. Sem emoji.

## Critérios de aceite

1. `npx tsc --noEmit` limpo e `npm run build` sem erro
2. Percurso completo no navegador: analisar vista → triagem → aceitar → abrir NC com foto →
   notificar → Construtora → ciência → submeter reparo → Fiscalização → reprovar → submeter
   de novo → aprovar → sanada
3. O Termo de Verificação sai com as três imagens e a trilha completa
4. Exportar tramitação, limpar o localStorage, importar e reencontrar tudo
5. Pendências antigas continuam abrindo, migradas
6. O painel do contrato mostra tempo médio de reparo e reincidência com números reais
