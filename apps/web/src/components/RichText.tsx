/**
 * Renderizador do texto que a IA devolve.
 *
 * O modelo responde em markdown — títulos, listas, tabelas e ênfase. Jogar isso
 * num `<pre>` produz um bloco cru e ilegível; aqui o texto vira hierarquia
 * visual sem trazer uma biblioteca de markdown (e sem `dangerouslySetInnerHTML`,
 * já que o conteúdo vem de fora).
 */

type Block =
  | { kind: "heading"; level: number; num?: string; title: string; body: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "para"; text: string };

/** `# Título` / `## Título` — o modelo usa ATX quando o texto é longo. */
const ATX = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
/** `1. **Título** — corpo` ou `**Título:** corpo` */
const BOLD_HEADING = /^\s*(?:(\d+)\s*[.)]\s*)?\*\*(.+?)\*\*\s*[—–:-]?\s*([\s\S]*)$/;
/** `1. Título — corpo` (sem negrito), com título curto */
const PLAIN_HEADING = /^\s*(\d+)\s*[.)]\s*([^—–:]{2,60}?)\s*[—–:]\s*(.+)$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const ORDERED = /^\s*(\d+)\s*[.)]\s+(.+)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;

const cells = (line: string): string[] =>
  line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let bullets: string[] = [];
  let ordered: string[] = [];
  const flush = () => {
    if (bullets.length) { blocks.push({ kind: "bullets", items: bullets }); bullets = []; }
    if (ordered.length) { blocks.push({ kind: "ordered", items: ordered }); ordered = []; }
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) { flush(); continue; }

    if (RULE.test(line)) { flush(); blocks.push({ kind: "rule" }); continue; }

    // tabela: cabeçalho + linha separadora + corpo
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const atx = line.match(ATX);
    if (atx) {
      flush();
      const inner = atx[2].match(BOLD_HEADING);
      const title = (inner ? `${inner[2]} ${inner[3]}` : atx[2]).replace(/\*\*/g, "").trim();
      const num = title.match(/^(\d+)[.)]\s*/)?.[1];
      blocks.push({
        kind: "heading",
        level: atx[1].length,
        num,
        title: title.replace(/^\d+[.)]\s*/, "").replace(/:$/, ""),
        body: "",
      });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) { if (ordered.length) flush(); bullets.push(bullet[1]); continue; }

    const bold = line.match(BOLD_HEADING);
    const ord = line.match(ORDERED);
    // `1. texto` só vira item de lista quando não é um título numerado
    if (ord && !bold && !PLAIN_HEADING.test(line)) {
      if (bullets.length) flush();
      ordered.push(ord[2]);
      continue;
    }
    flush();

    if (bold) {
      blocks.push({ kind: "heading", level: 3, num: bold[1], title: bold[2].replace(/:$/, ""), body: bold[3] });
      continue;
    }
    const plain = line.match(PLAIN_HEADING);
    if (plain) {
      blocks.push({ kind: "heading", level: 3, num: plain[1], title: plain[2], body: plain[3] });
      continue;
    }

    // continuação do parágrafo anterior, quando houver
    const last = blocks.at(-1);
    if (last?.kind === "para") last.text += " " + line.trim();
    else blocks.push({ kind: "para", text: line.trim() });
  }
  flush();
  return blocks;
}

/** Aplica **negrito**, *itálico* e `código` dentro de uma linha. */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded-md bg-subtle px-1 py-px font-mono text-[12px] text-ink ring-1 ring-inset ring-line-2">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });
}

/** Seções sobre não conformidade ganham destaque — é o que o engenheiro procura. */
const isAlert = (title: string) => /não\s*conformidad|risco|seguran/i.test(title);

const HEAD_CLASS: Record<number, string> = {
  1: "text-[15px] font-bold tracking-[-0.015em]",
  2: "text-[13.5px] font-semibold tracking-[-0.01em]",
  3: "text-[13px] font-semibold",
};

/** Triângulo de alerta, no mesmo traço dos ícones de `ui.tsx`. */
function AlertGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 translate-y-[2px]" aria-hidden>
      <path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function RichText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parse(text);
  if (blocks.length === 0) return null;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === "rule") return <hr key={i} className="border-t border-line-2" />;

        if (b.kind === "heading") {
          const alert = isAlert(b.title);
          const size = HEAD_CLASS[Math.min(b.level, 3)];
          return (
            <section
              key={i}
              className={alert ? "rounded-xl bg-[#fdeeec]/70 px-3.5 py-2.5 ring-1 ring-inset ring-[#f5d0cb]" : ""}
            >
              <h4 className={`mb-1 flex items-start gap-2 text-ink ${size} ${b.level === 1 ? "border-b border-line-2 pb-2" : ""}`}>
                {b.num && (
                  <span
                    className={`mt-px grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[10.5px] font-bold tabular ${
                      alert ? "bg-white/80 text-danger ring-1 ring-inset ring-[#f5d0cb]" : "bg-brand-soft text-action"
                    }`}
                  >
                    {b.num}
                  </span>
                )}
                {alert && !b.num && <span className="text-danger"><AlertGlyph /></span>}
                <span className={alert ? "text-danger" : ""}>{b.title}</span>
              </h4>
              {b.body.trim() && (
                <p className="text-[13.5px] leading-relaxed text-ink-2">{inline(b.body)}</p>
              )}
            </section>
          );
        }

        if (b.kind === "table") {
          return (
            <div key={i} className="overflow-x-auto rounded-xl bg-white ring-1 ring-inset ring-line">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead>
                  <tr className="bg-subtle">
                    {b.head.map((h, j) => (
                      <th key={j} className="border-b border-line px-3 py-2 text-[12px] font-semibold text-ink">{inline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j} className="border-b border-line-2 transition-colors last:border-0 hover:bg-subtle/60">
                      {row.map((c, k) => (
                        <td key={k} className="px-3 py-2 align-top leading-relaxed text-ink-2">{inline(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (b.kind === "ordered") {
          return (
            <ol key={i} className="flex flex-col gap-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="relative pl-7 text-[13.5px] leading-relaxed text-ink-2">
                  <span className="absolute left-0 top-[0.15em] grid h-[19px] min-w-[19px] place-items-center rounded-full bg-subtle px-1 text-[10.5px] font-bold tabular text-ink-2 ring-1 ring-inset ring-line">
                    {j + 1}
                  </span>
                  {inline(item)}
                </li>
              ))}
            </ol>
          );
        }

        if (b.kind === "bullets") {
          return (
            <ul key={i} className="flex flex-col gap-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="relative pl-5 text-[13.5px] leading-relaxed text-ink-2">
                  <span className="absolute left-1 top-[0.62em] h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_0_3px_rgb(0_155_255/0.14)]" />
                  {inline(item)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="text-[13.5px] leading-relaxed text-ink-2">{inline(b.text)}</p>
        );
      })}
    </div>
  );
}

/** Versão compacta para prévias em lista — só o texto, sem hierarquia. */
export function plainPreview(text: string, max = 180): string {
  const flat = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !RULE.test(l) && !TABLE_SEP.test(l))
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+)?(?:\d+\s*[.)]\s*)?/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .join(" · ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
