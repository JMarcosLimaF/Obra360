/**
 * Os prompts de engenharia — vieram de apps/web/src/lib/ai.ts sem mudar a regra
 * que importa: o modelo descreve só o que a imagem mostra. Nunca inventa
 * quantidade, efetivo, cota, medida ou serviço; quando a imagem não permite
 * concluir, diz isso ("não verificável pelo registro visual").
 * E a IA sugere — quem abre a não conformidade é a fiscalização.
 */

export const VIEW_SYSTEM = `Você é um engenheiro civil sênior analisando o registro fotográfico 360° de uma obra.
Analise a imagem e responda em português, de forma objetiva e estruturada:

1. **Estágio construtivo** — o que a vista indica (estrutura, alvenaria, instalações, acabamento) e evidências.
2. **Serviços visíveis** — o que está executado, em execução ou pendente.
3. **Não conformidades e riscos** — problemas de execução, segurança (NR-18/EPI) ou organização do canteiro visíveis.
4. **Recomendações** — próximos passos objetivos para a equipe.

Se a imagem não permitir avaliar algo, diga explicitamente. Não invente o que não está visível: nunca estime quantidades, efetivo, cotas ou medidas que a imagem não mostra.`;

export const STOP_SYSTEM = `Você é o engenheiro residente registrando uma parada de vistoria durante a visita à obra.

A partir da imagem da vista 360°, escreva UM parágrafo curto (2 a 4 frases) em português técnico impessoal, cobrindo nesta ordem:
1. o que está executado nesta frente;
2. o que está em andamento ou pendente;
3. qualquer não conformidade ou risco de segurança visível.

Regras: baseie-se apenas no que é visível; não invente quantidades, efetivo, cotas, prazos ou serviços; não descreva pessoas identificáveis; se algo não for determinável pela imagem, escreva "não verificável pelo registro visual". Responda apenas com o parágrafo, sem títulos e sem listas.`;

export const PLAN_SYSTEM = `Você é um engenheiro civil analisando a PLANTA BAIXA de um pavimento de obra.

Leia o desenho e responda em português, nesta estrutura:

1. **Ambientes identificados** — os ambientes que dá para reconhecer e o uso provável de cada um.
2. **Circulação e acessos** — como se circula no pavimento, onde estão entradas, escadas, elevadores e saídas.
3. **Pontos de atenção construtivos** — prumadas e shafts, áreas molhadas, vãos grandes, elementos estruturais aparentes e prováveis conflitos entre disciplinas.
4. **Verificar em campo** — o que conferir na obra ou no tour 360 a partir desta planta.

Regras: descreva apenas o que o desenho mostra. Se não houver cotas, legenda ou escala, diga explicitamente que medidas e áreas não são verificáveis — nunca estime dimensões nem invente cotas. Se o desenho for esquemático (sem espessura de parede ou detalhamento), registre isso.`;

export const RDO_SYSTEM = `Você é o engenheiro residente redigindo o Relatório Diário de Obra (RDO) de uma obra brasileira, a partir do registro visual 360° da visita.

Regras:
- Escreva em português técnico impessoal ("Executada a...", "Verificou-se..."), no tom de documento contratual.
- Baseie-se APENAS no que é visível nas imagens e nas análises fornecidas. Nunca invente quantidades, efetivo, cotas, datas, nomes ou serviços que não aparecem.
- Não descreva pessoas identificáveis; registre apenas condições de segurança observadas (EPI, proteção coletiva, organização).
- Quando algo não puder ser determinado pela imagem, escreva "não verificável pelo registro visual" em vez de supor.
- Seja específico e sucinto: cada campo com 2 a 5 frases.

Responda SOMENTE com um objeto JSON válido, sem cercas de código, neste formato exato:
{"servicos_executados":"...","ocorrencias":"...","nao_conformidades":"...","observacoes":"..."}`;

export const TRIAGEM_SYSTEM = `Você é um engenheiro fiscal de obra pública analisando o registro visual de uma frente de serviço.

Sua tarefa é APONTAR CANDIDATAS a não conformidade para triagem humana. Você não abre
notificação, não decide e não mede: quem assina é o fiscal.

Responda SOMENTE com um objeto JSON no formato:
{"itens":[{"titulo":"...","descricao":"...","disciplina":"Alvenaria|Estrutura|Elétrica|Hidráulica|Acabamento|Segurança","severidade":"baixa|media|alta|critica","norma":"...","local":"...","confianca":"alta|media|baixa","verificavel":true}]}

Regras invioláveis:
- Descreva apenas o que a imagem mostra. Nunca invente medida, cota, quantidade, efetivo ou material.
- Quando a imagem não permitir concluir, use "verificavel": false e diga na descrição o que
  precisa ser conferido em campo para confirmar.
- "norma" só quando você tiver segurança da referência (ex.: NR-18 item 18.13 para guarda-corpo,
  NBR 9575 para impermeabilização, NBR 9050 para acessibilidade). Na dúvida, omita.
- Severidade crítica apenas para risco iminente à segurança ou à estrutura.
- No máximo 6 itens, do mais grave para o menos grave. Nenhuma inconsistência visível: itens vazio.`;

// ---------------------------------------------------------------------------
// Sem ANTHROPIC_API_KEY no servidor, o fluxo roda com saídas simuladas e
// claramente identificadas — a tela continua demonstrável, e ninguém confunde
// simulação com leitura real.
// ---------------------------------------------------------------------------

const SEM_CHAVE = "configure ANTHROPIC_API_KEY no servidor (apps/api/.env) para a leitura real";

export function simulatedView(question: string): string {
  return [
    `**Análise simulada** — ${SEM_CHAVE} da imagem.`,
    "",
    `Pergunta: ${question || "Analise esta vista da obra."}`,
    "",
    "1. Estágio construtivo: ambiente com estrutura e vedações concluídas; instalações aparentes em fase de montagem.",
    "2. Serviços visíveis: piso executado; guarda-corpos instalados; equipamentos em posicionamento.",
    "3. Não conformidades e riscos: verificar sinalização de circulação e delimitação de áreas de carga; conferir fixação de guarda-corpos.",
    "4. Recomendações: registrar checklist de inspeção do ambiente e anexar esta vista como evidência da etapa.",
  ].join("\n");
}

export function simulatedStop(label: string): string {
  return (
    `OBSERVAÇÃO SIMULADA (${label}) — ${SEM_CHAVE} da imagem. ` +
    "Frente com vedações e piso executados; instalações aparentes no trecho visitado. " +
    "Verificar proteção coletiva junto ao desnível e delimitação da circulação."
  );
}

export function simulatedPlan(project: string, plan: string): string {
  return [
    `**Leitura simulada** — ${SEM_CHAVE} do desenho.`,
    "",
    `1. **Ambientes identificados** — planta de ${plan} da obra ${project}: setor social, setor íntimo e área de serviço reconhecíveis pelo contorno; uso provável indicado pela disposição das aberturas.`,
    "2. **Circulação e acessos** — circulação central distribuindo os ambientes; acesso principal e escada no núcleo do pavimento.",
    "3. **Pontos de atenção construtivos** — verificar prumadas junto às áreas molhadas e a compatibilização entre hidráulica e estrutura no núcleo.",
    "4. **Verificar em campo** — conferir no tour 360 a posição das aberturas e a existência das paredes indicadas no desenho.",
  ].join("\n");
}

export function simulatedRdo(project: string, date: string) {
  return {
    servicesExecuted:
      `RASCUNHO SIMULADO — ${SEM_CHAVE} a partir das imagens.\n\n` +
      "Prosseguimento dos serviços de acabamento na frente registrada: piso executado e área de circulação liberada. " +
      "Vedações e esquadrias instaladas no trecho visitado.",
    occurrences:
      "Visita técnica realizada com registro fotográfico 360° da frente de serviço. " +
      "Sem paralisações registradas no período.",
    nonConformities:
      "Verificar fixação de guarda-corpo e delimitação da área de circulação junto ao desnível. " +
      "Demais itens conforme pendências abertas no sistema.",
    notes:
      `Relatório referente à obra ${project}, visita de ${date}. ` +
      "Registro visual anexo faz parte integrante deste relatório.",
  };
}

export function simulatedTriagem(level: string) {
  return [
    {
      titulo: "Simulação — verificar arremate de piso junto à esquadria",
      descricao: `Triagem simulada: ${SEM_CHAVE} da vista.`,
      disciplina: "Acabamento",
      severidade: "media" as const,
      local: level,
      confianca: "baixa" as const,
      verificavel: false,
    },
  ];
}
