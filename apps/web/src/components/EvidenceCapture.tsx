import { useMemo, useRef, useState } from "react";
import { acervoDeFotos, priorizar, type FotoDoAcervo } from "../lib/acervo";
import { downscaleDataUrl, fileToDataUrl, isBlankFrame } from "../lib/image";
import { useApp } from "../store";
import type { NcEvidence, NcEvidenceKind, TourPose } from "../types";
import { NC_EVIDENCE_LABEL } from "../types";
import { mpState } from "./MatterportViewer";
import { IconCamera, IconCheck, IconClose, IconLayers, IconRotate360, Micro } from "./ui";

/** Seta de envio, no mesmo traço 24 dos ícones de `ui.tsx`. */
const IconUpload = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M12 15V4" />
    <path d="M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

/**
 * Captura da evidência fotográfica exigida em cada etapa do trâmite.
 *
 * Duas fontes, porque a obra tem duas realidades: a fiscalização costuma estar
 * diante do tour e captura a vista exata (guardando a `pose`, para o outro lado
 * conseguir voltar ao mesmo ângulo); a construtora está no canteiro com o
 * celular e envia a foto do serviço. As duas valem — o que não vale é seguir
 * sem imagem, e por isso este componente não tem estado "pular".
 */
export default function EvidenceCapture({
  kind,
  suggestedPose,
  projectId,
  hint,
  value,
  onChange,
}: {
  kind: NcEvidenceKind;
  /** vista da abertura, para orientar quem vai fotografar o mesmo ponto */
  suggestedPose?: TourPose;
  /** obra cujo acervo de fotos fica disponível para reaproveitamento */
  projectId?: string;
  /** contexto para trazer a foto provável primeiro */
  hint?: { rdoId?: string; levelId?: string };
  value: NcEvidence | null;
  onChange: (evidence: NcEvidence | null) => void;
}) {
  const user = useApp((s) => s.user) ?? "";
  const role = useApp((s) => s.activeRole);
  const requestFlyToPose = useApp((s) => s.requestFlyToPose);
  const rdos = useApp((s) => s.rdos);
  const analyses = useApp((s) => s.analyses);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acervoAberto, setAcervoAberto] = useState(false);

  // as imagens que a obra já produziu — visitas do RDO e análises do tour
  const acervo = useMemo(
    () => (projectId ? priorizar(acervoDeFotos(projectId, rdos, analyses), hint ?? {}) : []),
    [projectId, rdos, analyses, hint],
  );

  const build = (imageDataUrl: string, pose?: TourPose): NcEvidence => ({
    id: `ev-img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    imageDataUrl,
    pose,
    author: user,
    role,
    note: value?.note ?? "",
    createdAt: new Date().toISOString(),
  });

  const capturarDoTour = async () => {
    const sdk = mpState.sdk;
    if (!sdk) {
      setError("O tour não está aberto nesta tela. Use o Tour 360 ou envie uma foto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const shot = await sdk.Renderer.takeScreenShot({ width: 1280, height: 720 });
      if (await isBlankFrame(shot)) {
        setError("A cena ainda não renderizou. Espere o tour carregar e capture de novo.");
        return;
      }
      const pose = await sdk.Camera.getPose().catch(() => null);
      const small = await downscaleDataUrl(shot, 1100, 0.82);
      onChange(build(small, pose?.sweep ? { sweep: pose.sweep, rotation: pose.rotation } : undefined));
    } catch {
      setError("Não foi possível capturar a vista do tour.");
    } finally {
      setBusy(false);
    }
  };

  /** Reaproveita uma imagem já registrada, preservando legenda e vista do tour. */
  const usarDoAcervo = (f: FotoDoAcervo) => {
    onChange({
      ...build(f.imageDataUrl, f.pose),
      note: f.caption || f.origem,
    });
    setAcervoAberto(false);
    setError(null);
  };

  const enviarArquivo = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Envie uma imagem (JPG ou PNG).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const small = await downscaleDataUrl(dataUrl, 1100, 0.82);
      onChange(build(small));
    } catch {
      setError("Não foi possível ler o arquivo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-subtle p-3.5 ring-1 ring-inset ring-line-2">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <Micro className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Evidência de {NC_EVIDENCE_LABEL[kind].toLowerCase()} · obrigatória
        </Micro>
        {suggestedPose && (
          <button
            onClick={() => requestFlyToPose(suggestedPose)}
            className="btn btn-ghost btn-sm -mr-1.5 h-7 px-2 text-[11.5px] text-action hover:text-action"
          >
            <IconRotate360 className="h-3.5 w-3.5" />
            ir ao ponto da abertura
          </button>
        )}
      </div>

      {value ? (
        <div className="animate-pop space-y-2.5">
          <div className="group relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-line">
            <img
              src={value.imageDataUrl}
              alt={`Evidência de ${NC_EVIDENCE_LABEL[kind]}`}
              className="block w-full transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]"
            />
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(6_26_46/0.28)_0%,transparent_32%)]" />
            <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-[rgb(8_20_32/0.62)] px-2 py-0.5 text-[10.5px] font-semibold text-white ring-1 ring-white/10 backdrop-blur-xl">
              <IconCheck className="h-3 w-3" />
              {NC_EVIDENCE_LABEL[kind]}
            </span>
            <button
              onClick={() => onChange(null)}
              aria-label="Descartar imagem"
              className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full bg-[rgb(8_20_32/0.62)] text-white ring-1 ring-white/15 backdrop-blur-xl transition duration-200 hover:scale-105 active:scale-95"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            value={value.note}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            placeholder="Legenda da foto (o que ela mostra)"
            className="field text-[12.5px]"
          />
          <Micro className="flex items-center gap-1.5">
            {value.pose ? <IconRotate360 className="h-3.5 w-3.5" /> : <IconCamera className="h-3.5 w-3.5" />}
            {value.pose ? "Vista do tour guardada nesta imagem" : "Foto enviada do dispositivo"}
          </Micro>
        </div>
      ) : (
        <div className="group/zone flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line bg-white/70 px-3 py-4 text-center transition-colors duration-300 hover:border-brand hover:bg-brand-soft/40">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-b from-brand-soft to-white text-action ring-1 ring-inset ring-[#d4ebfb] transition-transform duration-300 ease-out-expo group-hover/zone:-translate-y-0.5 group-hover/zone:scale-105">
            <IconCamera className="h-5 w-5" />
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {acervo.length > 0 && (
              <button
                onClick={() => setAcervoAberto((v) => !v)}
                disabled={busy}
                aria-expanded={acervoAberto}
                className={`btn btn-secondary btn-sm ${acervoAberto ? "border-brand bg-brand-soft text-action hover:border-brand hover:bg-brand-soft" : ""}`}
              >
                <IconLayers className="h-4 w-4" />
                Usar foto já tirada ({acervo.length})
              </button>
            )}
            <button onClick={capturarDoTour} disabled={busy} className="btn btn-secondary btn-sm">
              <IconRotate360 className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              {busy ? "capturando…" : "Capturar a vista do tour"}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-secondary btn-sm">
              <IconUpload className="h-4 w-4" />
              Enviar foto
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarArquivo(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {acervoAberto && !value && (
        <div className="mt-3 max-h-56 animate-pop overflow-y-auto border-t border-line-2 pt-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {acervo.map((f, idx) => (
              <button
                key={f.id}
                onClick={() => usarDoAcervo(f)}
                className="reveal group overflow-hidden rounded-xl bg-white text-left shadow-xs ring-1 ring-line transition-[box-shadow,translate] duration-300 ease-out-expo hover:-translate-y-0.5 hover:shadow-md hover:ring-brand"
                style={{ ["--i" as string]: Math.min(idx, 12) }}
              >
                <span className="block overflow-hidden">
                  <img
                    src={f.imageDataUrl}
                    alt=""
                    className="h-20 w-full object-cover transition-transform duration-500 ease-out-expo group-hover:scale-110"
                  />
                </span>
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[10.5px] font-medium text-ink-3">{f.origem}</span>
                  {f.caption && (
                    <span className="block truncate text-[11px] text-ink-2">{f.caption}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2.5 animate-pop rounded-xl bg-[#fdeeec] px-3 py-2 text-[11.5px] leading-relaxed text-danger ring-1 ring-inset ring-[#f5d0cb]">
          {error}
        </p>
      )}
    </div>
  );
}
