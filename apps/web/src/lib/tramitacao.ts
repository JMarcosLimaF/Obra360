/**
 * A travessia entre as duas organizações, enquanto não existe servidor.
 *
 * Fiscalização e construtora são empresas diferentes, com sistemas diferentes.
 * Hoje, na prática, essa tramitação acontece por e-mail com PDF anexo — então o
 * "enviar" daqui não finge ser uma rede: ele produz um **pacote**. Um `.json`
 * que o outro lado reimporta, e um `.html` autocontido, com as imagens
 * embutidas, que se anexa a um e-mail e abre em qualquer navegador.
 *
 * A reimportação é idempotente e concilia por `code`: vence o lado que tem mais
 * histórico, nunca o mais antigo. Reimportar o mesmo arquivo duas vezes não faz
 * nada — o que é exatamente o comportamento que se espera de um protocolo.
 */
import type { Issue, NcRole, Project } from "../types";
import { NC_ACTION_LABEL, NC_EVIDENCE_LABEL, NC_ROLE_LABEL, NC_STATUS_LABEL } from "../types";
import { contractorById, fmtDate } from "../data/catalog";
import { evidenceTriptych } from "./nc-flow";

const APP = "obra360";
const TIPO = "tramitacao";

export interface Pacote {
  _app: string;
  _tipo: string;
  _versao: number;
  projectId: string;
  projectName: string;
  emitidoEm: string;
  emitidoPor: string;
  papel: NcRole;
  para: NcRole;
  ncs: Issue[];
}

function baixar(nome: string, conteudo: string, mime: string) {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

const carimbo = () => new Date().toISOString().slice(0, 10);

export function exportarPacote(
  ncs: Issue[],
  project: Project,
  meta: { emitidoPor: string; papel: NcRole; para: NcRole },
): void {
  const pacote: Pacote = {
    _app: APP,
    _tipo: TIPO,
    _versao: 1,
    projectId: project.id,
    projectName: project.name,
    emitidoEm: new Date().toISOString(),
    emitidoPor: meta.emitidoPor,
    papel: meta.papel,
    para: meta.para,
    ncs,
  };
  baixar(
    `tramitacao-${project.id}-${carimbo()}.json`,
    JSON.stringify(pacote, null, 2),
    "application/json",
  );
}

export async function lerPacote(file: File): Promise<Pacote> {
  const texto = await file.text();
  const dados = JSON.parse(texto) as Partial<Pacote>;
  if (dados._app !== APP || dados._tipo !== TIPO) {
    throw new Error("Este arquivo não é um pacote de tramitação do Obra360.");
  }
  if (!Array.isArray(dados.ncs)) throw new Error("Pacote sem não conformidades.");
  return dados as Pacote;
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Ofício em HTML autocontido — é o anexo de e-mail. Sem CSS externo, sem fonte
 * remota e com as imagens já em base64, para abrir igual em qualquer máquina,
 * inclusive offline.
 */
export function exportarOficio(
  ncs: Issue[],
  project: Project,
  meta: { emitidoPor: string; papel: NcRole; para: NcRole },
): void {
  const contractor = contractorById(project.contractorId);
  const contract = project.contract;

  const corpo = ncs
    .map((nc) => {
      const t = evidenceTriptych(nc);
      const fotos = [t.abertura, t.reparo, t.verificacao]
        .filter(Boolean)
        .map(
          (e) => `
        <figure>
          <img src="${esc(e!.imageDataUrl)}" alt="">
          <figcaption>${esc(NC_EVIDENCE_LABEL[e!.kind])} · ${esc(
            new Date(e!.createdAt).toLocaleString("pt-BR"),
          )} · ${esc(e!.author)}${e!.note ? ` — ${esc(e!.note)}` : ""}</figcaption>
        </figure>`,
        )
        .join("");

      const historico = (nc.events ?? [])
        .map(
          (e) => `<tr>
            <td>${esc(new Date(e.at).toLocaleDateString("pt-BR"))}</td>
            <td>${esc(NC_ACTION_LABEL[e.action])}</td>
            <td>${esc(e.actor)} · ${esc(NC_ROLE_LABEL[e.role])}</td>
            <td>${esc(e.note ?? "—")}</td>
          </tr>`,
        )
        .join("");

      return `
      <article>
        <h2>${esc(nc.code ?? "")} — ${esc(nc.title)}</h2>
        <p class="meta">
          ${esc(NC_STATUS_LABEL[nc.ncStatus ?? "rascunho"])} ·
          ${esc(nc.local)} · ${esc(nc.discipline)} ·
          severidade ${esc(nc.severity)} ·
          prazo ${nc.deadline ? esc(fmtDate(nc.deadline)) : "—"}
        </p>
        <p>${esc(nc.description)}</p>
        ${nc.norma ? `<p class="norma">Fundamento: ${esc(nc.norma)}</p>` : ""}
        <div class="fotos">${fotos}</div>
        <table><thead><tr><th>Data</th><th>Ato</th><th>Responsável</th><th>Registro</th></tr></thead>
        <tbody>${historico}</tbody></table>
      </article>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tramitação ${esc(project.name)} — ${esc(carimbo())}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#F1F5FA; color:#40546A;
         font:15px/1.6 "IBM Plex Sans","Segoe UI",system-ui,sans-serif; }
  .folha { max-width:820px; margin:0 auto; background:#fff; padding:44px;
           border:1px solid #D8E0E8; }
  h1 { font-size:22px; color:#0E3656; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:16px; color:#0E3656; margin:0 0 4px; }
  header { border-bottom:2px solid #0E3656; padding-bottom:18px; margin-bottom:24px; }
  .eyebrow { font:500 10px/1 ui-monospace,monospace; letter-spacing:.14em;
             text-transform:uppercase; color:#0074C8; margin:0 0 14px; }
  dl { display:grid; grid-template-columns:repeat(2,1fr); gap:8px 24px; margin:16px 0 0; }
  dt { font:400 9.5px/1 ui-monospace,monospace; letter-spacing:.12em;
       text-transform:uppercase; color:#7C8FA0; }
  dd { margin:2px 0 0; font-size:13px; color:#0E3656; }
  article { border:1px solid #D8E0E8; padding:20px; margin-bottom:18px; }
  .meta { font:400 11px/1.5 ui-monospace,monospace; text-transform:uppercase;
          letter-spacing:.06em; color:#7C8FA0; margin:0 0 10px; }
  .norma { font-size:13px; color:#8A6116; }
  .fotos { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
           gap:12px; margin:14px 0; }
  figure { margin:0; }
  img { width:100%; border:1px solid #D8E0E8; display:block; }
  figcaption { font:400 9px/1.4 ui-monospace,monospace; text-transform:uppercase;
               letter-spacing:.06em; color:#7C8FA0; margin-top:4px; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:10px; }
  th { text-align:left; font:400 9.5px/1 ui-monospace,monospace; letter-spacing:.1em;
       text-transform:uppercase; color:#7C8FA0; border-bottom:2px solid #D8E0E8;
       padding:6px 8px 6px 0; }
  td { border-bottom:1px solid #E6ECF2; padding:6px 8px 6px 0; vertical-align:top; }
  footer { margin-top:28px; border-top:1px solid #D8E0E8; padding-top:12px;
           font:400 9.5px/1.6 ui-monospace,monospace; text-transform:uppercase;
           letter-spacing:.06em; color:#7C8FA0; }
  @media print { body { background:#fff; } .folha { border:0; padding:0; max-width:none; } }
</style></head>
<body><div class="folha">
  <header>
    <p class="eyebrow">Obra360 — tramitação de não conformidades</p>
    <h1>${esc(project.name)}</h1>
    <p>${esc(contract?.orgaoContratante ?? project.client)} · ${esc(project.address)}</p>
    <dl>
      <div><dt>Contrato</dt><dd>${esc(contract?.numero ?? "—")}</dd></div>
      <div><dt>Contratada</dt><dd>${esc(contractor?.razaoSocial ?? "—")}</dd></div>
      <div><dt>Emitido por</dt><dd>${esc(meta.emitidoPor)} · ${esc(NC_ROLE_LABEL[meta.papel])}</dd></div>
      <div><dt>Destinatário</dt><dd>${esc(NC_ROLE_LABEL[meta.para])}</dd></div>
      <div><dt>Data</dt><dd>${esc(new Date().toLocaleString("pt-BR"))}</dd></div>
      <div><dt>Peças</dt><dd>${ncs.length}</dd></div>
    </dl>
  </header>
  ${corpo}
  <footer>
    Documento gerado pela plataforma Obra360. Registros eletrônicos de sessão, sem
    certificação ICP-Brasil — a assinatura das partes permanece necessária para efeito contratual.
  </footer>
</div></body></html>`;

  baixar(`tramitacao-${project.id}-${carimbo()}.html`, html, "text/html;charset=utf-8");
}
