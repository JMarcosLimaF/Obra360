# Obra360 — Plataforma de Gestão de Obras com Imersão 360°

Documentação visual e gestão de obras de construção civil por captura fotográfica 360°.
Cada visita à obra gera uma **captura** — um conjunto de panoramas posicionados sobre a
planta baixa. O usuário navega em primeira pessoa (estilo Matterport/Street View) e volta
no tempo comparando o mesmo ponto em datas diferentes.

## Estrutura do monorepo

```
.
├── README.md
├── docs/
│   ├── architecture.md      # Diagrama de arquitetura (Mermaid) + decisões técnicas
│   └── backlog.md           # Backlog priorizado do MVP em formato de tickets
├── db/
│   └── schema.sql           # DDL completo: PostGIS, RLS multi-tenant, auditoria
├── workers/
│   └── processing/          # Worker Python: nadir patch, tiles, keyframes, SfM
│       ├── worker.py
│       ├── contract.md      # Contrato da fila de jobs (JSON)
│       └── requirements.txt
└── apps/
    └── web/                 # Frontend React + TS + Vite + Three.js (MVP funcional)
```

## Rodando

O frontend é React + TypeScript + Tailwind (`apps/web`). A API é Node + TypeScript (`apps/api`). O processamento de imagem 360 continua em Python (`workers/processing`).

```bash
# 1. API — aplica o schema no Supabase e a obra de demonstração
cd apps/api && npm install && npm run dev

# 2. interface
cd apps/web && npm install && npm run dev
```

O banco e o login são o projeto Supabase (`apps/api/.env`: URL, publishable key, secret key e JWKS). Abra http://localhost:5199. Senha de demonstração: `demo-demo`.

| E-mail | Papel |
|---|---|
| marcos@construtorameridiano.com.br | Fiscalização |
| antonio@silvaesouza.eng.br | Construtora |
| julia@construtorameridiano.com.br | Gestor |

O MVP usa dados mock em memória (1 construtora, 2 obras, pendências, curva S) e o
**Matterport como fonte 360** do viewer — cada obra tem um `matterportId` vinculado.

### Telas

| Rota | Tela |
|---|---|
| `/login` | Login (simulado) |
| `/projects` | Seleção de obra |
| `/p/:projectId` | Dashboard da obra (avanço, curva S, **situação por pavimento**, visitas, pendências) |
| `/p/:projectId/viewer` | **Viewer 360** — tour Matterport embutido + marcação de pendência por coordenada 3D + análise da vista por IA |
| `/p/:projectId/plantas` | **Plantas** — pranchas do pavimento lidas pela IA e marcação de ocorrência sobre o desenho |
| `/p/:projectId/nc` | **Não conformidades** — o trâmite entre fiscalização e construtora, com triagem por IA, evidências, prazos e peças do processo |
| `/p/:projectId/contrato` | **Contrato e desempenho** — dados do contrato e da contratada, prazos vencidos, tempo médio de reparo, reincidência |
| `/p/:projectId/issues` | Lista de pendências filtrável (visão de tabela das mesmas peças) |
| `/p/:projectId/rdo` | **Diário de Obra (RDO)** — clima, efetivo, serviços, não conformidades, anexo fotográfico do tour e documento imprimível |
| `/p/:projectId/rdo/:rdoId/visita` | **Visita guiada** — o tour ao lado do caderno de campo: registra frentes, redige observações com IA e volta ao ponto exato |
| `/p/:projectId/report` | **Relatório de acompanhamento** — resumo, situação por pavimento, plantas, análises 360, diários e pendências com aging (imprimível → PDF) |

## Como os módulos se ligam

Quatro telas contam pedaços da mesma obra: a **planta** diz o que deveria existir, o
**tour 360** mostra o que existe, o **diário de obra** conta o que aconteceu no dia e a
**pendência** cobra o que falta. O que costura os quatro é o **pavimento** — toda
pendência, prancha e frente de visita carrega um `levelId`, e é por ele que o painel e
o relatório conseguem falar de "Pavimento 2" com uma linha só.

```
  PLANTA ──marcar ponto──► PENDÊNCIA ◄──marcar no tour── TOUR 360
     ▲                        │  ▲                          ▲
     └──vincular vista────────┼──┴───ir ao ponto────────────┘
                             │
                    DIÁRIO DE OBRA (verifica em campo)
                             │
              PAINEL  +  RELATÓRIO DE ACOMPANHAMENTO
```

**Procedência e trilha de volta.** Toda pendência guarda de onde nasceu (`origin`:
tour, planta, RDO ou cadastro) e os ponteiros para lá — `floorplanId`/`pinId`, `rdoId`,
coordenada 3D e vista do tour. Na lista de Pendências isso vira a coluna
*Origem e trilha*: "ver no tour →", "ver na planta →", "RDO nº 002 →".

**A planta dentro do tour.** Sem backend não existe alinhamento automático entre a nuvem
de pontos e o desenho, e fingir que existe seria pior do que não ter. Então quem faz o
vínculo é quem está na obra: no viewer há uma planta flutuante com **vincular vista** —
você está numa vista do tour, aponta no desenho onde está, e o ponto guarda *aquela*
vista (sweep + rotação). A partir daí um clique no ponto traz a câmera de volta, do
viewer ou da tela de Plantas. Ponto a ponto, a planta vira o índice de navegação do 360.

**O ciclo da cobrança fecha na visita.** Na visita guiada, a frente de serviço ativa
mostra *Pendências desta frente* — as que já estavam abertas naquele pavimento — com
"ver no tour", "em execução", "concluída", "verificada" e "reprovada". Cada toque grava
uma **verificação** na pendência (RDO, data, situação) e sai impressa no documento do
dia, na seção *Pendências verificadas nesta visita*. É a trilha de auditoria que
transforma o RDO em prova.

### Viewer 360 = Matterport + SDK for Embeds

O viewer embute o tour Matterport da obra (`matterportId`; no mock, `Q3tJNr4Moyx`).
Com uma **Matterport SDK key** (gratuita: my.matterport.com → Settings → Developer
Tools → SDK Key Management), configurada no botão ⚙ do viewer, habilitam-se:

- **📍 Marcar local** — mire o cursor em qualquer ponto do tour e confirme: o sistema
  captura a coordenada 3D (`Pointer.intersection`), abre o formulário de pendência e
  cria um **tag** no modelo (`Tag.add`). A pendência fica ancorada por coordenada.
- **✨ Analisar com IA** — captura a vista atual (`Renderer.takeScreenShot`) e envia
  ao Claude (vision) com prompt de engenharia civil: estágio construtivo, serviços
  visíveis, não conformidades/riscos (NR-18) e recomendações. As análises ficam no
  painel lateral, no dashboard e entram no relatório PDF com a imagem.

O texto que a IA devolve vem em markdown (títulos, seções numeradas, negrito, listas e
tabelas) e é renderizado por `components/RichText.tsx` — sem biblioteca de markdown e sem
`dangerouslySetInnerHTML`, já que o conteúdo vem de fora. Seções sobre não
conformidade, risco ou segurança ganham destaque em vermelho, que é o que o
engenheiro procura primeiro.

A chave da **API Anthropic** habilita a análise real; sem ela o fluxo
roda com uma análise simulada claramente identificada. Nota: no MVP a chamada de IA
sai do browser (chave do usuário, localStorage) — em produção vai para o backend.

### Chaves de API

As chaves ficam em `apps/web/.env.local` (fora do controle de versão), e o que for
digitado na engrenagem do viewer tem prioridade sobre elas:

```
VITE_ANTHROPIC_KEY=sk-ant-...
VITE_MP_SDK_KEY=...
```

Alterar o arquivo exige reiniciar o `npm run dev` — o Vite lê o `.env` no boot. Aviso:
variáveis `VITE_*` são **embutidas no bundle**, então a chave fica legível para quem
tiver o `dist` ou a página. Isso é aceitável só neste MVP local; em produção a chamada
vai para o backend e a chave nunca chega ao cliente.

### Diário de Obra (RDO) redigido a partir do tour

O RDO segue o formato usado em obra no Brasil: identificação, condições do tempo e
praticabilidade por período, efetivo, equipamentos, serviços executados, ocorrências,
não conformidades, anexo fotográfico e assinaturas de contratada e fiscalização.

O botão **Redigir com o tour** envia ao Claude as vistas 360° que você analisou no
viewer (imagem + análise anterior) e devolve o rascunho dos campos de relato. O
prompt proíbe inventar quantidades, efetivo ou serviços não visíveis e manda escrever
"não verificável pelo registro visual" quando a imagem não permite concluir — a
responsabilidade técnica continua sendo de quem assina.

### Visita guiada — o RDO é a caminhada

Em vez de escrever o relatório longe do tour, a visita guiada põe os dois na mesma
tela: o tour à esquerda (com as ferramentas de marcação) e o caderno de campo à
direita. A visita é uma caminhada por frentes de serviço.

**Fotografe quantas vistas quiser.** O obturador fica sobre o tour (ou tecla `F`) e
captura a vista atual a qualquer momento — a primeira foto abre a frente, as demais
se acumulam nela. Cada foto guarda a posição da câmera e recebe **legenda** e
**classificação**: panorâmica, detalhe, não conformidade, serviço encoberto ou
segurança. Fotos disparadas antes de a cena renderizar são recusadas, para não
entrar quadro preto no anexo probatório.

A IA redige a observação da frente lendo **o conjunto** de fotos, e o botão
"redigir com as N fotos" refaz o texto quando a frente ganha mais registros.

Clicar em "ir ao ponto desta foto" faz a câmera **voar de volta à vista exata**
(`Sweep.moveTo` com o sweep e a rotação salvos). Ao final, **Compor RDO** consolida
as frentes nos campos do relatório.

No documento, o anexo sai numerado e legendado — *"Foto 04 — Térreo · Serviço
encoberto — Prumada hidráulica antes do fechamento do shaft"* — e as fotos marcadas
como encoberto ganham uma **seção própria de registro de serviços encobertos**, que é
o dossiê do que ficou atrás da parede.

O roteiro é pré-carregado com os pavimentos da obra ("2 de 3 frentes"), então não
existe página em branco nem risco de esquecer uma frente.

### Plantas — a referência do que deveria existir

Sem planta, a plataforma registra apenas o que existe; com ela, passa a haver o
confronto entre projeto e obra. O módulo carrega as pranchas do pavimento (as três
exportadas do próprio modelo Matterport, em `public/plantas/`, ou qualquer PNG/JPG
enviado) e faz duas coisas:

- **Analisar planta** — o Claude lê o desenho e devolve ambientes identificados,
  circulação e acessos, pontos de atenção construtivos e o que conferir em campo. O
  prompt proíbe estimar dimensões: se não há escala, cotas ou legenda, o modelo diz
  isso em vez de inventar. A leitura de uma prancha leva de 30 segundos a alguns
  minutos, então a resposta vem em **streaming** — o texto aparece enquanto é escrito,
  com o relógio ao lado, e nunca parece travado.
- **Marcar ponto** — clique sobre o desenho para fixar uma marcação em coordenada
  relativa (sobrevive ao zoom), com título e nota. O botão **Criar pendência** promove
  a marcação a uma ocorrência da obra, com o local já preenchido
  ("Pavimento 1 · Pátio — conferir caimento"); o pino fica vermelho quando tem
  pendência ligada.

## Ciclo da não conformidade

Cada obra pertence a uma **construtora contratada por um órgão público**. Quem opera o
sistema é a **fiscalização**: ela analisa as inconsistências e as submete formalmente à
contratada para reparo. Isso muda o vocabulário e o rigor — o artefato deixa de ser
"pendência" e passa a ser **não conformidade**, com número (`NC-2026-014`), base normativa,
prazo imposto pela severidade e consequência contratual.

```
  rascunho ──notificar──► notificada ──ciência──► ciente ──► em reparo
                                                                │
                                            submeter reparo ────┤
                                                                ▼
                              reprovar ◄──── reparo submetido ────► aprovar ──► SANADA
                                 │                    │
                                 └──► volta a em reparo (reincidência +1)

  ramos: contestada (decidida pelo gestor)   ·   cancelada (improcedente, com motivo)
```

A máquina de estados vive inteira em `src/lib/nc-flow.ts` e é a **fonte única** do trâmite:
nenhuma tela decide transição por conta própria. `available(nc, papel)` diz o que aquele
papel pode fazer agora, e `apply` valida, exige o que a regra exige, grava o evento e
recalcula o prazo. Duas escolhas de modelagem que valem registrar: **reprovar não é
estado** (é um evento que devolve a NC para reparo e incrementa a reincidência) e
**vencida não é estado** (é derivado de `deadline < hoje`).

### Abrir a peça no tour

Ao confirmar o ponto no retículo, a vista é **congelada no mesmo instante** — imagem,
coordenada 3D e pose saem do mesmo momento. Pedir a foto num passo seguinte abria uma
janela em que a câmera podia girar, e a evidência deixava de mostrar o ponto que a peça
ancora. A **mira é queimada no pixel** (`markPoint` em `lib/image.ts`): quem recebe a
notificação por e-mail vê onde está o defeito sem precisar do sistema.

### Corrigir é ato, não edição

Rascunho se edita à vontade. Peça já emitida se **retifica**: exige a razão por escrito, o
conteúdo muda e a retificação entra no histórico com autor e data. A severidade fica
travada depois da notificação, porque é ela que define o prazo já concedido — para mexer
no prazo existe *prorrogar*.

### Aceitar sem registro do reparo

Se a contratada submeteu sem foto (ou o registro veio por e-mail), a peça mostra o alerta e
o aceite **exige justificativa escrita** — o botão fica travado até ela existir. Aceitar em
silêncio um reparo do qual não há prova é o atalho que derruba a medição na auditoria.

### Volume

Busca por número, título, local, disciplina ou norma. **Notificar em lote** os rascunhos de
uma visita, com relatório do que foi e do que ficou para trás por falta de foto. E, na lista
e no detalhe, *com quem está a bola e há quantos dias* — a métrica que mostra quem está
segurando o processo.

### Uma única fonte de verdade

Toda mudança de estado passa por `apply` — **não existe caminho alternativo**. O card do
viewer, o editor do RDO e a visita guiada já tiveram atalhos próprios que escreviam
`status` sem tocar `ncStatus`; o resultado era uma peça afirmando duas coisas ao mesmo
tempo ("resolvido" no painel, ainda na fila de verificação na tela de NC). Esses atalhos
foram removidos: o viewer leva à peça, o editor do RDO leva à peça, e a visita guiada opera
o trâmite de verdade.

Pelo mesmo motivo existe **uma só trilha de auditoria**. A antiga lista `verifications[]`
foi absorvida por `events[]`: um ato praticado durante uma visita carrega o `rdoId`, então
o documento do RDO e o relatório de acompanhamento leem o mesmo fato em vez de duas
memórias parciais. Acervos antigos são convertidos na migração.

### Verificar em campo, com a foto da frente

Na visita guiada, a frente ativa lista as não conformidades daquele pavimento. O que a
contratada submeteu ganha **verificada** e **reprovar**; o resto leva à peça. Aceitar exige
o registro da conferência — e a foto que você acabou de tirar na frente é usada como essa
evidência. Sem foto, o aceite é recusado com a razão na tela.

### Os dois lados da mesa

No topo da tela há **Atuando como: Fiscalização / Construtora / Gestor**. Ele muda as
**ações oferecidas**, nunca esconde dado — transparência é o produto. É um seletor de
demonstração, não autenticação, e a interface diz isso.

| Papel | O que faz |
|---|---|
| Fiscalização | notifica, prorroga, reitera prazo vencido, aprova, reprova, cancela |
| Construtora | dá ciência, informa início, submete o reparo, contesta |
| Gestor | decide a contestação — procedente cancela, improcedente devolve ao reparo |

### Evidência obrigatória e o par antes/depois

Não há trâmite sem imagem: a **abertura**, o **reparo** e a **verificação** exigem foto. As
três aparecem lado a lado na peça e saem impressas no termo de encerramento.

Três fontes, porque a obra tem três situações:

- **Usar foto já tirada** — o acervo que a obra já produziu (fotos das visitas do RDO e
  vistas analisadas no tour), com as da visita e do pavimento corrente na frente. A imagem
  entra com a legenda escrita em campo e com a vista do tour de onde saiu, então o botão
  *ir a esta vista* continua funcionando. Obrigar a refotografar o que já foi fotografado é
  retrabalho — e produz duas imagens do mesmo defeito em horários diferentes, que é
  exatamente o tipo de inconsistência que atrapalha numa auditoria.
- **Capturar a vista do tour** — guarda o `sweep` e a rotação para o outro lado voltar ao
  mesmo ângulo.
- **Enviar foto** — o celular da construtora no canteiro.

Na visita guiada, a última foto da frente ativa já vem preenchida como evidência de
abertura da nova NC. E, na peça, cada espaço vazio do tríptico oferece **anexar imagem** ao
papel que responde por ele — fiscalização na abertura e na verificação, construtora no
reparo. Anexar não muda o estado, mas é ato: entra na trilha como *Evidência anexada*.

### Triagem: a IA propõe, a fiscalização assina

Em **Triagem por IA**, o modelo lê a vista e devolve candidatas a não conformidade com
disciplina, severidade e norma provável — marcando `conferir em campo` quando a imagem não
permite concluir. Cada candidata precisa de aceite humano, e a peça nasce em rascunho com o
nome de quem aceitou. Uma NC aberta por robô não sustenta notificação contratual.

### As peças do processo

Notificação de não conformidade · Comunicado de reparo executado · Termo de verificação e
encerramento · Reiteração de notificação. Todas imprimíveis (Ctrl+P → PDF), com
identificação do contrato, destinatário, fundamento, prazo, registro fotográfico e
histórico completo da tramitação. O rodapé diz o que o aceite eletrônico deste ambiente é
e o que não é: **não há certificação ICP-Brasil**, e simular isso derrubaria o documento na
primeira contestação.

### Tramitação entre organizações, sem servidor

Fiscalização e construtora são empresas diferentes. Hoje, na prática, essa troca acontece
por e-mail com PDF anexo — então **Enviar tramitação** não finge ser uma rede: produz um
`.json` que o outro lado reimporta e um `.html` autocontido, com as imagens embutidas, para
anexar ao e-mail. A importação concilia por `code`, é idempotente (reimportar o mesmo
arquivo não faz nada) e nunca sobrescreve o lado com mais histórico.

### Persistência sem backend

Pendências, análises, RDOs e sessão ficam no `localStorage` e sobrevivem ao recarregar.
As capturas do tour são reduzidas antes de gravar (miniatura ~45 KB no lugar do
screenshot cheio) para caber na cota do navegador; se ela encher mesmo assim, o app
avisa em vez de falhar em silêncio. No Diário de Obra há **Backup** e **Restaurar**
(.json) — a rede de segurança enquanto o backend não existe.

## Backend real (fase seguinte)

O schema em `db/schema.sql` é aplicável direto em Supabase/Postgres (requer PostGIS).
O contrato do worker está em `workers/processing/contract.md`. Ver `docs/architecture.md`
para o desenho completo e `docs/backlog.md` para a ordem de ataque.
