/**
 * Rascunho do cadastro de obra: o que o assistente guarda entre as etapas,
 * a validação de cada etapa e a conversão para o corpo de POST /api/projects.
 */
import type { IssueSeverity } from "../types";
import { cnpjValido, emailValido, onlyDigits, parseBrl } from "./br";

export type ContractorMode = "existente" | "nova" | "depois";

export interface ProjectDraft {
  name: string;
  client: string;
  address: string;
  startsAt: string;
  endsAt: string;
  progressPct: number;
  levels: { key: string; name: string }[];
  contractorMode: ContractorMode;
  contractorId: string;
  contractor: {
    razaoSocial: string;
    cnpj: string;
    responsavelTecnico: string;
    crea: string;
    email: string;
    preposto: string;
  };
  withContract: boolean;
  contract: {
    numero: string;
    processo: string;
    vigenciaInicio: string;
    vigenciaFim: string;
    valor: string;
    fiscalDesignado: string;
    gestorDesignado: string;
    portariaDesignacao: string;
    prazos: Record<IssueSeverity, number>;
  };
  cover: string;
  matterport: string;
}

let seq = 0;
export const levelKey = () => `lv-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function emptyDraft(): ProjectDraft {
  return {
    name: "",
    client: "",
    address: "",
    startsAt: "",
    endsAt: "",
    progressPct: 0,
    levels: ["Térreo", "Pavimento 2", "Cobertura"].map((name) => ({ key: levelKey(), name })),
    contractorMode: "existente",
    contractorId: "",
    contractor: { razaoSocial: "", cnpj: "", responsavelTecnico: "", crea: "", email: "", preposto: "" },
    withContract: true,
    contract: {
      numero: "",
      processo: "",
      vigenciaInicio: "",
      vigenciaFim: "",
      valor: "",
      fiscalDesignado: "",
      gestorDesignado: "",
      portariaDesignacao: "",
      prazos: { critica: 2, alta: 7, media: 15, baixa: 30 },
    },
    cover: "",
    matterport: "",
  };
}

/** Lista de pavimentos de baixo para cima, como a obra é executada. */
export function generateLevels(opts: { subsolos: number; terreo: boolean; acima: number; cobertura: boolean }): string[] {
  const out: string[] = [];
  for (let i = opts.subsolos; i >= 1; i--) out.push(opts.subsolos === 1 ? "Subsolo" : `Subsolo ${i}`);
  if (opts.terreo) out.push("Térreo");
  for (let i = 1; i <= opts.acima; i++) out.push(`Pavimento ${i + (opts.terreo ? 1 : 0)}`);
  if (opts.cobertura) out.push("Cobertura");
  return out;
}

/** Aceita o identificador puro ou o link do showcase (…?m=JKDH2SEKWcv). */
export function extractMatterportId(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const fromUrl = s.match(/[?&]m=([A-Za-z0-9]+)/);
  if (fromUrl) return fromUrl[1];
  const fromPath = s.match(/\/models\/([A-Za-z0-9]+)/);
  if (fromPath) return fromPath[1];
  return s;
}

export const matterportValido = (id: string) => /^[A-Za-z0-9]{6,30}$/.test(id);

export type StepErrors = Record<string, string>;

/** Erros por campo de cada etapa; etapa sem erro pode avançar. */
export function validateStep(step: number, d: ProjectDraft, existingNames: string[]): StepErrors {
  const e: StepErrors = {};
  if (step === 0) {
    const name = d.name.trim().replace(/\s+/g, " ");
    if (name.length < 3) e.name = "Dê um nome com pelo menos 3 caracteres.";
    else if (name.length > 120) e.name = "Use no máximo 120 caracteres.";
    else if (/[/\\?#%]/.test(name)) e.name = "Sem / \\ ? # ou % — o nome vira o endereço da obra.";
    else if (existingNames.some((n) => n.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      e.name = "Já existe uma obra com esse nome.";
    }
    if (!d.client.trim()) e.client = "Informe o órgão contratante ou cliente.";
    if (!d.endsAt) e.endsAt = "Informe a entrega prevista.";
    else if (d.startsAt && d.endsAt < d.startsAt) e.endsAt = "A entrega não pode ser antes do início.";
  }
  if (step === 1) {
    const names = d.levels.map((l) => l.name.trim()).filter(Boolean);
    if (names.length === 0) e.levels = "Cadastre ao menos um pavimento.";
    else if (names.length !== d.levels.length) e.levels = "Há pavimento sem nome.";
    else {
      const lower = names.map((n) => n.toLocaleLowerCase("pt-BR"));
      const dup = lower.find((n, i) => lower.indexOf(n) !== i);
      if (dup) e.levels = `"${names[lower.indexOf(dup)]}" aparece duas vezes.`;
    }
  }
  if (step === 2) {
    if (d.contractorMode === "existente" && !d.contractorId) e.contractorId = "Escolha a contratada.";
    if (d.contractorMode === "nova") {
      if (!d.contractor.razaoSocial.trim()) e.razaoSocial = "Informe a razão social.";
      if (!cnpjValido(d.contractor.cnpj)) {
        e.cnpj = onlyDigits(d.contractor.cnpj).length === 14 ? "CNPJ inválido — confira os dígitos." : "Informe o CNPJ completo.";
      }
      if (d.contractor.email && !emailValido(d.contractor.email)) e.email = "E-mail inválido.";
    }
  }
  if (step === 3 && d.withContract) {
    if (!d.contract.numero.trim()) e.numero = "Informe o número do contrato.";
    const ini = d.contract.vigenciaInicio || d.startsAt;
    const fim = d.contract.vigenciaFim || d.endsAt;
    if (ini && fim && fim < ini) e.vigenciaFim = "O fim da vigência não pode ser antes do início.";
    for (const [k, v] of Object.entries(d.contract.prazos)) {
      if (!Number.isInteger(v) || v < 1 || v > 365) e[`prazo_${k}`] = "1 a 365 dias";
    }
  }
  if (step === 4) {
    const id = extractMatterportId(d.matterport);
    if (id && !matterportValido(id)) e.matterport = "Use o identificador do modelo (letras e números) ou o link do tour.";
  }
  return e;
}

/** Corpo de POST /api/projects. */
export function toPayload(d: ProjectDraft, cover?: string) {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    name: d.name.trim().replace(/\s+/g, " "),
    client: d.client.trim(),
    address: opt(d.address),
    startsAt: opt(d.startsAt),
    endsAt: d.endsAt,
    progressPct: d.progressPct,
    matterportId: opt(extractMatterportId(d.matterport)),
    cover,
    levels: d.levels.map((l) => l.name.trim().replace(/\s+/g, " ")),
    contractor:
      d.contractorMode === "existente"
        ? { id: d.contractorId }
        : d.contractorMode === "nova"
          ? {
              razaoSocial: d.contractor.razaoSocial.trim(),
              cnpj: d.contractor.cnpj,
              responsavelTecnico: opt(d.contractor.responsavelTecnico),
              crea: opt(d.contractor.crea),
              email: opt(d.contractor.email),
              preposto: opt(d.contractor.preposto),
            }
          : null,
    contract: d.withContract
      ? {
          numero: d.contract.numero.trim(),
          processo: opt(d.contract.processo),
          orgaoContratante: d.client.trim(),
          vigenciaInicio: opt(d.contract.vigenciaInicio),
          vigenciaFim: opt(d.contract.vigenciaFim),
          valor: parseBrl(d.contract.valor),
          fiscalDesignado: opt(d.contract.fiscalDesignado),
          gestorDesignado: opt(d.contract.gestorDesignado),
          portariaDesignacao: opt(d.contract.portariaDesignacao),
          prazos: d.contract.prazos,
        }
      : null,
  };
}

export type ProjectPayload = ReturnType<typeof toPayload>;
