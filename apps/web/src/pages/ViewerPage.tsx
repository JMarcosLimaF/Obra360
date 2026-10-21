import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useObraId } from "../obra";
import MatterportViewer from "../components/MatterportViewer";
import IssuePanel from "../components/IssuePanel";
import PlanMini from "../components/PlanMini";
import { useApp } from "../store";
import { projectById } from "../data/catalog";
import { EmptyState, IconAlert, IconClose, IconRotate360 } from "../components/ui";

export default function ViewerPage() {
  const projectId = useObraId();
  const project = projectById(projectId);
  const pendingAnchor = useApp((s) => s.pendingAnchor);
  const issues = useApp((s) => s.issues);
  const flyToIssueId = useApp((s) => s.flyToIssueId);
  const [showPanel, setShowPanel] = useState(false);

  // ao voar para uma pendência, recolhe o drawer para o tour aparecer
  useEffect(() => {
    if (flyToIssueId) setShowPanel(false);
  }, [flyToIssueId]);

  if (!project) return null;

  if (!project.matterportId) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="card w-full max-w-md animate-rise">
          <EmptyState icon={<IconRotate360 className="h-6 w-6" />} title="Esta obra ainda não tem um tour 360 vinculado.">
            Cadastre o identificador do modelo Matterport da obra para habilitar o tour.
          </EmptyState>
        </div>
      </div>
    );
  }

  const openCount = issues.filter(
    (i) => i.projectId === projectId && i.status !== "resolvido",
  ).length;

  return (
    <div className="flex h-full md:gap-3 md:p-3 lg:p-0">
      <div className="relative min-w-0 flex-1 overflow-hidden bg-navy-950 md:rounded-[22px] md:shadow-lg md:ring-1 md:ring-navy-950/10">
        <MatterportViewer modelId={project.matterportId} projectId={projectId} />

        {/* a planta como índice de navegação do tour */}
        <PlanMini projectId={projectId} />

        {/* mobile: painel como drawer */}
        <button
          onClick={() => setShowPanel((v) => !v)}
          aria-label={`Não conformidades (${openCount})`}
          title={`Não conformidades (${openCount})`}
          className="absolute right-3 top-4 z-30 flex h-11 items-center gap-2 rounded-2xl bg-[rgb(8_20_32/0.62)] px-3 text-[12.5px] font-semibold text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl transition-colors duration-200 hover:bg-[rgb(8_20_32/0.78)] md:hidden"
        >
          <IconAlert className="h-4 w-4 text-white/80" />
          <span className="hidden min-[700px]:inline">Não conformidades</span>
          <span className={`min-w-[22px] rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular ${openCount ? "bg-[#e5484d] text-white" : "bg-white/15 text-white/80"}`}>
            {openCount}
          </span>
        </button>
        <AnimatePresence>
          {(showPanel || pendingAnchor) && (
            <motion.div
              key="drawer"
              initial={{ x: "105%" }}
              animate={{ x: 0 }}
              exit={{ x: "105%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="absolute inset-y-0 right-0 z-30 md:hidden"
            >
              <div className="h-full overflow-hidden rounded-l-[22px] shadow-2xl ring-1 ring-navy-950/10">
                <IssuePanel projectId={projectId} />
              </div>
              <button
                onClick={() => setShowPanel(false)}
                aria-label="Fechar painel"
                className="absolute -left-11 top-4 grid h-9 w-9 place-items-center rounded-full bg-[rgb(8_20_32/0.62)] text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl transition-colors hover:bg-[rgb(8_20_32/0.78)]"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* desktop: painel fixo */}
      <div className="hidden min-h-0 overflow-hidden rounded-[22px] shadow-sm ring-1 ring-line/70 md:block">
        <IssuePanel projectId={projectId} />
      </div>
    </div>
  );
}
