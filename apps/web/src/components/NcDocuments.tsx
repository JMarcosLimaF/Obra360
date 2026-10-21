import { contractorById, fmtDate, levelsOf } from "../data/catalog";
import { evidenceTriptych, daysLeft } from "../lib/nc-flow";
import { TODAY } from "../lib/journey";
import type { Issue, NcEvidence, Project } from "../types";
import { NC_ACTION_LABEL, NC_EVIDENCE_LABEL, NC_STATUS_LABEL, NC_ROLE_LABEL } from "../types";
import { Micro, Wordmark } from "./ui";

/* ícones locais no mesmo traço da grade 24 de ui.tsx */
const traco = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const IconArrowLeft = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </svg>
);
const IconPrinter = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M7 9V3.5h10V9" />
    <rect x="3.5" y="9" width="17" height="8" rx="2.5" />
    <path d="M7 14h10v6.5H7z" />
  </svg>
);

export type NcDocKind = "notificacao" | "reparo" | "termo" | "reiteracao";

export const NC_DOC_LABEL: Record<NcDocKind, string> = {
  notificacao: "Notificação de não conformidade",
  reparo: "Comunicado de reparo executado",
  termo: "Termo de verificação e encerramento",
  reiteracao: "Reiteração de notificação",
};

const SEV_LABEL: Record<Issue["severity"], string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

/**
 * As peças que o trâmite gera.
 *
 * Um apontamento só produz efeito contratual quando vira documento: com número,
 * destinatário, fundamento, prazo e assinatura. Aqui eles saem no mesmo padrão
 * do relatório de acompanhamento — imprimíveis com Ctrl+P.
 *
 * O rodapé diz, sem eufemismo, o que o aceite eletrônico deste ambiente é e o
 * que ele não é. Simular certificação digital seria o tipo de atalho que
 * derruba o documento na primeira contestação.
 */
export default function NcDocument({
  nc,
  project,
  kind,
  onBack,
}: {
  nc: Issue;
  project: Project;
  kind: NcDocKind;
  onBack: () => void;
}) {
  const contractor = contractorById(project.contractorId);
  const contract = project.contract;
  const levels = levelsOf(project.id);
  const level = levels.find((l) => l.id === nc.levelId);
  const tript = evidenceTriptych(nc);
  const events = nc.events ?? [];
  const ciencia = events.find((e) => e.action === "dar_ciencia");
  const submissao = events.filter((e) => e.action === "submeter_reparo").at(-1);
  const encerramento = events.find((e) => e.to === "sanada");
  const atraso = daysLeft(nc, TODAY);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 print:max-w-none print:px-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <button onClick={onBack} className="group btn btn-ghost -ml-2 text-action hover:text-ink">
            <IconArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
            Voltar à não conformidade
          </button>
          <button onClick={() => window.print()} className="btn btn-primary">
            <IconPrinter className="h-4 w-4" />
            Gerar PDF (imprimir)
          </button>
        </div>

        <div className="animate-rise rounded-3xl bg-white p-6 text-ink shadow-lg ring-1 ring-line/70 sm:p-10 print:animate-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
          <header className="mb-7 border-b-2 border-ink pb-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <Wordmark />
              <span className="rounded-full bg-brand-soft px-3 py-1 text-[11.5px] font-semibold text-action ring-1 ring-inset ring-[#cfe7fb] print:bg-transparent print:px-0 print:py-0 print:ring-0">
                {NC_DOC_LABEL[kind]}
              </span>
            </div>
            <h1 className="font-display text-[22px] font-bold leading-snug tracking-[-0.02em]">
              {nc.code} — {nc.title}
            </h1>
            <p className="mt-1 text-sm text-ink-2">{project.name} · {project.address}</p>
            <div className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-subtle p-4 text-xs ring-1 ring-inset ring-line-2 sm:grid-cols-4 print:grid-cols-4 print:rounded-none print:bg-transparent print:p-0 print:ring-0">
              <Field label="Contrato">{contract?.numero ?? "—"}</Field>
              <Field label="Processo">{contract?.processo ?? "—"}</Field>
              <Field label="Emitido em">{fmtDate(TODAY)}</Field>
              <Field label="Situação">{NC_STATUS_LABEL[nc.ncStatus ?? "rascunho"]}</Field>
            </div>
          </header>

          {/* destinatário / emitente */}
          <Sec n="1" title={kind === "reparo" ? "Emitente" : "Destinatário"}>
            {contractor ? (
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 print:grid-cols-2 print:gap-y-1">
                <Field label="Contratada">{contractor.razaoSocial}</Field>
                <Field label="CNPJ">{contractor.cnpj}</Field>
                <Field label="Responsável técnico">
                  {contractor.responsavelTecnico} · {contractor.crea}
                </Field>
                <Field label="Preposto na obra">{contractor.preposto}</Field>
                <Field label="Órgão contratante">{contract?.orgaoContratante ?? project.client}</Field>
                <Field label="Fiscal designado">
                  {contract?.fiscalDesignado ?? "—"}
                  {contract?.portariaDesignacao ? ` · ${contract.portariaDesignacao}` : ""}
                </Field>
              </div>
            ) : (
              <p className="text-sm text-ink-3">Construtora não cadastrada nesta obra.</p>
            )}
          </Sec>

          {/* identificação */}
          <Sec n="2" title="Identificação da não conformidade">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3 print:grid-cols-3 print:gap-y-2">
              <Field label="Local">{level?.name ?? "—"}{nc.local ? ` · ${nc.local}` : ""}</Field>
              <Field label="Disciplina">{nc.discipline}</Field>
              <Field label="Severidade">{SEV_LABEL[nc.severity]}</Field>
              <Field label="Aberta em">{fmtDate(nc.createdAt.slice(0, 10))}</Field>
              <Field label="Prazo de reparo">{nc.deadline ? fmtDate(nc.deadline) : "—"}</Field>
              <Field label="Reincidências">{nc.reopenCount ?? 0}</Field>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{nc.description}</p>
          </Sec>

          {/* fundamentação */}
          <Sec n="3" title="Fundamentação">
            <p className="text-sm leading-relaxed text-ink-2">
              {nc.norma
                ? `A exigência tem por base ${nc.norma}.`
                : "Exigência fundamentada nas especificações técnicas do projeto e nas obrigações contratuais da contratada."}
              {contract && ` Contrato ${contract.numero}, processo ${contract.processo}.`}
            </p>
          </Sec>

          {/* registro fotográfico conforme o tipo */}
          {kind === "notificacao" && (
            <Sec n="4" title="Registro fotográfico da não conformidade">
              <Shot ev={tript.abertura} />
            </Sec>
          )}

          {kind === "reparo" && (
            <Sec n="4" title="Registro fotográfico do reparo executado">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
                <Shot ev={tript.abertura} />
                <Shot ev={tript.reparo} />
              </div>
              {submissao?.note && (
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{submissao.note}</p>
              )}
            </Sec>
          )}

          {kind === "termo" && (
            <Sec n="4" title="Registro fotográfico — abertura, reparo e verificação">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:grid-cols-3">
                <Shot ev={tript.abertura} />
                <Shot ev={tript.reparo} />
                <Shot ev={tript.verificacao} />
              </div>
            </Sec>
          )}

          {kind === "reiteracao" && (
            <Sec n="4" title="Situação do prazo">
              <p className="text-sm leading-relaxed text-ink-2">
                A notificação original fixou o prazo de reparo em{" "}
                <b className="font-semibold text-ink">{nc.deadline ? fmtDate(nc.deadline) : "—"}</b>.
                {atraso !== null && atraso < 0 && (
                  <>
                    {" "}O prazo encontra-se vencido há{" "}
                    <b className="font-semibold text-danger">{Math.abs(atraso)} dias</b> sem que a
                    contratada tenha submetido o reparo à verificação.
                  </>
                )}
              </p>
              <div className="mt-3">
                <Shot ev={tript.abertura} />
              </div>
            </Sec>
          )}

          {/* providência */}
          <Sec n="5" title="Providência exigida">
            <p className="text-sm leading-relaxed text-ink-2">
              {kind === "termo" ? (
                <>
                  Verificada em campo a correção da não conformidade, fica a peça{" "}
                  <b className="font-semibold text-positive">encerrada</b>
                  {encerramento && ` em ${fmtDate(encerramento.at.slice(0, 10))}`}.
                  {(nc.reopenCount ?? 0) > 0 && (
                    <> O reparo foi reprovado {nc.reopenCount} vez(es) antes do aceite, o que fica
                    registrado para efeito de avaliação de desempenho da contratada.</>
                  )}
                </>
              ) : kind === "reparo" ? (
                <>
                  A contratada comunica a execução do reparo e submete o serviço à verificação da
                  fiscalização, permanecendo a peça aberta até o aceite formal.
                </>
              ) : (
                <>
                  Fica a contratada notificada a sanar a não conformidade até{" "}
                  <b className="font-semibold text-ink">
                    {nc.deadline ? fmtDate(nc.deadline) : "o prazo a ser fixado"}
                  </b>
                  , submetendo o serviço corrigido à verificação da fiscalização com o respectivo
                  registro fotográfico. O descumprimento do prazo sujeita a contratada às sanções
                  previstas no instrumento contratual, sem prejuízo da glosa dos serviços não
                  conformes na medição do período.
                </>
              )}
            </p>
          </Sec>

          {/* histórico */}
          {events.length > 0 && (
            <Sec n="6" title="Histórico da tramitação">
              <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-line text-left">
                    {["Data", "Ato", "Responsável", "Registro"].map((h) => (
                      <th
                        key={h}
                        className="py-2 pr-2 text-[11px] font-semibold text-ink-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-line-2 align-top last:border-b-0 print:last:border-b">
                      <td className="whitespace-nowrap py-2 pr-2 tabular-nums">
                        {new Date(e.at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-2 pr-2 font-semibold">{NC_ACTION_LABEL[e.action]}</td>
                      <td className="py-2 pr-2 text-ink-2">
                        {e.actor}
                        <span className="text-ink-3"> · {NC_ROLE_LABEL[e.role]}</span>
                      </td>
                      <td className="py-2 text-ink-2">{e.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Sec>
          )}

          {/* assinaturas */}
          <section className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2 print:grid-cols-2">
            <Signature
              titulo={kind === "reparo" ? "Contratada — responsável técnico" : "Fiscalização"}
              nome={
                kind === "reparo"
                  ? contractor?.responsavelTecnico ?? ""
                  : contract?.fiscalDesignado ?? ""
              }
              cargo={kind === "reparo" ? contractor?.crea ?? "" : contract?.portariaDesignacao ?? ""}
            />
            <Signature
              titulo={kind === "reparo" ? "Fiscalização — recebimento" : "Contratada — ciência"}
              nome={kind === "reparo" ? contract?.fiscalDesignado ?? "" : contractor?.preposto ?? ""}
              cargo={
                kind !== "reparo" && ciencia
                  ? `Ciência registrada em ${new Date(ciencia.at).toLocaleString("pt-BR")}`
                  : ""
              }
            />
          </section>

          <footer className="mt-8 border-t border-line pt-4 text-[10.5px] leading-relaxed text-ink-3">
            Documento gerado pela plataforma Obra360. Os aceites registrados neste
            documento são registros eletrônicos de sessão, sem certificação ICP-Brasil — a
            assinatura das partes permanece necessária para efeito contratual.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Shot({ ev }: { ev?: NcEvidence }) {
  if (!ev) {
    return (
      <div className="grid h-32 place-items-center rounded-xl border border-dashed border-field bg-subtle/70 text-[11.5px] text-ink-3 print:bg-transparent">
        sem registro
      </div>
    );
  }
  return (
    <figure className="break-inside-avoid">
      <img src={ev.imageDataUrl} alt="" className="w-full rounded-xl border border-line print:rounded" />
      <figcaption className="mt-1.5 text-[10.5px] font-medium leading-snug text-ink-3">
        {NC_EVIDENCE_LABEL[ev.kind]} · {new Date(ev.createdAt).toLocaleString("pt-BR")} · {ev.author}
        {ev.note && ` — ${ev.note}`}
      </figcaption>
    </figure>
  );
}

function Sec({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 flex items-baseline gap-1.5 font-display text-[15px] font-bold tracking-[-0.01em]">
        <span className="tabular text-action">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Micro className="block">{label}</Micro>
      <p className="mt-0.5 text-[12.5px] font-medium text-ink print:text-xs">{children}</p>
    </div>
  );
}

function Signature({ titulo, nome, cargo }: { titulo: string; nome: string; cargo: string }) {
  return (
    <div>
      <div className="h-12 border-b border-ink" />
      <p className="mt-2 text-[11px] font-semibold text-ink-3">{titulo}</p>
      {nome && <p className="mt-0.5 text-xs font-semibold text-ink">{nome}</p>}
      {cargo && <p className="text-[11px] text-ink-2">{cargo}</p>}
    </div>
  );
}
