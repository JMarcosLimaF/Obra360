# Backlog priorizado — MVP (fase 1, 8–10 semanas)

Formato: `[prioridade] TICKET — descrição · critério de aceite`
P0 = bloqueia o piloto · P1 = necessário para vender · P2 = polimento

## Épico A — Fundação (semanas 1–2)

- **[P0] A1 — Schema + RLS**: aplicar `db/schema.sql` no Supabase; seeds de dev. · Testes de RLS provando isolamento entre 2 orgs e restrição do papel `empreiteiro`.
- **[P0] A2 — Auth e papéis**: login e-mail/senha + convite por e-mail com papel. · Usuário convidado como `visitante` não consegue criar pendência.
- **[P0] A3 — CRUD obra/pavimento**: criar obra, subir planta (PDF→PNG server-side), definir escala (2 pontos + distância real). · Planta renderiza no minimapa com `px_per_meter` correto.
- **[P1] A4 — Upload resumível**: tus no storage; retomada após queda de rede. · Upload de 500 MB sobrevive a 3 quedas simuladas.

## Épico B — Captura ponto fixo (semanas 2–4)

- **[P0] B1 — Marcação de waypoints na planta**: engenheiro marca/nomeia pontos e liga vizinhos (grafo). · Grafo persiste em `waypoint_links` na primeira captura.
- **[P0] B2 — Fluxo de captura mobile (PWA)**: selecionar waypoint → disparar câmera (ou anexar arquivo) → fila offline. · Captura completa de 10 pontos sem internet, sync ao voltar.
- **[P0] B3 — Worker `pano.process`**: nadir patch, blur LGPD, preview, tiles (código em `workers/processing`). · Panorama de 11k px processa em < 30 s; preview < 200 KB.
- **[P1] B4 — Status de processamento na UI**: barra de progresso por captura via canal `job.progress`. · Usuário vê % e ETA sem recarregar.

## Épico C — Viewer (semanas 3–6) — núcleo do produto

- **[P0] C1 — Viewer esférico**: Three.js, preview-first + tiles progressivos, drag/zoom. · Primeiro frame < 2 s em 4G simulado.
- **[P0] C2 — Navegação por waypoints**: setas no chão para vizinhos, transição com fade. · Andar 5 pontos sem tocar no minimapa.
- **[P0] C3 — Minimapa**: planta + pontos + cone de visão; clique pula para o ponto. · Cone acompanha o yaw em tempo real.
- **[P0] C4 — Timeline temporal**: trocar data mantendo waypoint + yaw/pitch/fov (via `temporal_links`). · Alternar 4 datas sem “pular” de posição.
- **[P0] C5 — Comparação split-screen**: duas datas, câmeras sincronizadas (pan/zoom espelhados). · Arrastar em qualquer lado move os dois; datas independentes.
- **[P1] C6 — Link público**: token com expiração + marca d'água. · Link expirado retorna 410.

## Épico D — Pendências (semanas 5–7)

- **[P0] D1 — Pin ancorado**: duplo clique no panorama cria pin (yaw/pitch + posição na planta) com título, disciplina, responsável, prazo, severidade. · Pin reaparece no mesmo lugar ao voltar e em outras datas do mesmo ponto.
- **[P0] D2 — Ciclo de status**: aberto → em execução → aguardando verificação → resolvido, com evidência foto no fechamento. · Histórico completo em `issue_events`.
- **[P0] D3 — Lista filtrável**: por obra, pavimento, responsável, disciplina, status, atraso. · Filtro “vencidas” cruza `due_date` com hoje.
- **[P1] D4 — Notificações**: e-mail ao responsável na atribuição e D-1 do prazo. · Empreiteiro sem conta recebe link restrito à pendência dele.

## Épico E — Avanço e relatório (semanas 7–9)

- **[P1] E1 — EAP mínima**: importar EAP via XLSX; registrar % por serviço/pavimento com captura como lastro. · Curva S planejado × realizado no dashboard.
- **[P0] E2 — Relatório de visita PDF**: capa, resumo do período, panoramas selecionados, pendências abertas, comparativos antes/depois. · PDF gerado em < 20 s e anexável a e-mail.
- **[P2] E3 — Dossiê de serviço encoberto**: seleção de panoramas “antes de fechar” por ambiente, com data e autor certificados. · Exportação com hash do conteúdo no rodapé.

## Épico F — Piloto (semanas 9–10)

- **[P0] F1 — Obra piloto**: captura semanal real, 3 pavimentos, medir tempo/1.000 m². · Meta: < 8 min/1.000 m²; % de capturas sem correção manual registrado.
- **[P1] F2 — Telemetria de adoção**: capturas/obra/mês, pendências/captura, tempo de resolução. · Dashboard interno com as métricas de produto.

## Fora do MVP (explicitamente)

Reconstrução 3D densa (dollhouse), medição por nuvem de pontos, BIM bidirecional,
apps nativos separados, SLAM/walkthrough (fase 2), IA de detecção de etapa (fase 3).
