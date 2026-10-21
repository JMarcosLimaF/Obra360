import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import Shell, { Splash } from "./components/Shell";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Dashboard from "./pages/Dashboard";
import ViewerPage from "./pages/ViewerPage";
import Issues from "./pages/Issues";
import NaoConformidades from "./pages/NaoConformidades";
import Contrato from "./pages/Contrato";
import Plantas from "./pages/Plantas";
import RdoPage from "./pages/Rdo";
import RdoVisita from "./pages/RdoVisita";
import Report from "./pages/Report";
import { projectById } from "./data/catalog";
import { caminhoDaObra, obraPeloTrecho, ProvedorObra } from "./obra";
import { useApp } from "./store";
import { useEffect, type ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useApp((s) => s.user);
  const ready = useApp((s) => s.catalogReady);
  if (!user) return <Navigate to="/entrar" replace />;
  if (!ready) return <Splash label="Carregando a obra…" />;
  return <>{children}</>;
}

/** Rota da obra: valida o trecho do endereço e entrega o id às telas. */
function ProjectScope() {
  const { obra = "" } = useParams();
  const project = obraPeloTrecho(obra);
  if (!project) return <Navigate to="/obras" replace />;
  return (
    <ProvedorObra id={project.id}>
      <Outlet />
    </ProvedorObra>
  );
}

/** Raiz e rotas desconhecidas: quem já entrou volta para as obras. */
function Landing() {
  const user = useApp((s) => s.user);
  return <Navigate to={user ? "/obras" : "/entrar"} replace />;
}

/** Endereços antigos, com código ou nome em inglês, abrem a página pelo nome da obra. */
function EnderecoAntigo() {
  const params = useParams();
  const { search, hash } = useLocation();
  const project = projectById(params.projectId ?? "");
  if (!project) return <Navigate to="/obras" replace />;
  const resto = (params["*"] ?? "")
    .replace(/^viewer/, "tour")
    .replace(/^issues/, "ocorrencias")
    .replace(/^nc(?=\/|$)/, "nao-conformidades")
    .replace(/^rdo/, "diario")
    .replace(/^report/, "relatorios");
  const pagina = resto === "painel" ? "" : resto;
  return <Navigate to={`${caminhoDaObra(project.id, pagina)}${search}${hash}`} replace />;
}

function Titulo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const nome = pathname.includes("/visita")
      ? "Visita"
      : pathname.includes("/diario")
        ? "Diário de obra"
        : pathname.includes("/tour")
          ? "Tour 360"
          : pathname.includes("/plantas")
            ? "Plantas"
            : pathname.includes("/nao-conformidades")
              ? "Não conformidades"
              : pathname.includes("/ocorrencias")
                ? "Ocorrências"
                : pathname.includes("/relatorios")
                  ? "Relatórios"
                  : pathname.includes("/contrato")
                    ? "Contrato"
                    : pathname.includes("/painel")
                      ? "Painel"
                      : pathname === "/obras"
                        ? "Obras"
                        : pathname.startsWith("/obras/")
                          ? "Painel"
                          : pathname.startsWith("/entrar")
                            ? "Entrar"
                            : "";
    document.title = nome ? `${nome} · Obra360` : "Obra360";
  }, [pathname]);
  return null;
}

export default function App() {
  const status = useApp((s) => s.sessionStatus);
  const restoreSession = useApp((s) => s.restoreSession);
  useEffect(() => { void restoreSession(); }, [restoreSession]);
  if (status === "checking") {
    return <Splash label="Abrindo o Obra360…" />;
  }
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
      <Titulo />
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route path="/login" element={<Navigate to="/entrar" replace />} />
        <Route path="/projects" element={<Navigate to="/obras" replace />} />
        {/* o layout fica montado entre as telas: a barra lateral não pisca ao navegar */}
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route path="/obras" element={<Projects />} />
          <Route path="/obras/:obra" element={<ProjectScope />}>
            <Route index element={<Dashboard />} />
            <Route path="tour" element={<ViewerPage />} />
            <Route path="ocorrencias" element={<Issues />} />
            <Route path="nao-conformidades" element={<NaoConformidades />} />
            <Route path="plantas" element={<Plantas />} />
            <Route path="diario/:rdoId/visita" element={<RdoVisita />} />
            <Route path="diario" element={<RdoPage />} />
            <Route path="contrato" element={<Contrato />} />
            <Route path="relatorios" element={<Report />} />
          </Route>
        </Route>
        <Route path="/p/:projectId/*" element={<RequireAuth><EnderecoAntigo /></RequireAuth>} />
        <Route path="/p/:projectId" element={<RequireAuth><EnderecoAntigo /></RequireAuth>} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}
