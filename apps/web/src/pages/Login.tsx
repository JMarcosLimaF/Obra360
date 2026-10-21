import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { LogoMark, Wordmark } from "../components/ui";
import LidarScan from "../components/LidarScan";

const DEMO_PASSWORD = "demo-demo";

const DEMOS = [
  { role: "Fiscal", name: "Marcos Andrade", email: "marcos@construtorameridiano.com.br" },
  { role: "Contratada", name: "Antônio Barros", email: "antonio@silvaesouza.eng.br" },
  { role: "Gestor", name: "Júlia Ferreira", email: "julia@construtorameridiano.com.br" },
] as const;

export default function Login() {
  const [email, setEmail] = useState<string>(DEMOS[0].email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useApp((s) => s.login);
  const bootError = useApp((s) => s.bootError);
  const navigate = useNavigate();

  const enter = async (address: string, senha: string) => {
    setEmail(address);
    setPassword(senha);
    setBusy(true);
    setError(null);
    const msg = await login(address, senha);
    setBusy(false);
    if (msg) { setError(msg); return; }
    navigate("/obras");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void enter(email, password);
  };

  return (
    <div className="flex h-screen bg-white">
      {/* painel de marca */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink lg:flex lg:w-[55%]">
        <LidarScan />
        {/* garante leitura do texto sobre a animação */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] bg-linear-to-t from-ink via-ink/90 to-transparent" />

        <div className="relative px-14 pt-12">
          <span className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <Wordmark light className="text-2xl" />
          </span>
        </div>

        <div className="relative flex flex-col gap-4 px-14 pb-13">
          <h1 className="max-w-md font-display text-[42px] font-semibold leading-[1.12] tracking-[-0.01em] text-white [text-wrap:pretty]">
            A obra inteira, sem sair da mesa.
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-white/70">
            Documentação visual 360°, não conformidades ancoradas por coordenada e análise
            assistida por IA — um registro datado de cada etapa da obra.
          </p>
          <div className="mt-5 flex items-center gap-2.5">
            <span className="h-0.5 w-7 bg-brand" />
            <span className="font-mono text-[10px] tracking-[0.14em] text-white/50">
              OBRA360 · GESTÃO VISUAL DE OBRAS
            </span>
          </div>
        </div>
      </div>

      {/* formulário */}
      <div className="flex flex-1 flex-col justify-center bg-white px-10 sm:px-20">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-8 w-8" />
          <Wordmark className="text-xl" />
        </span>
        <h2 className="mt-10 font-display text-2xl font-semibold text-ink">Acessar Obra360</h2>
        <p className="mt-2 text-[13px] text-ink-2">Plataforma de gestão visual de obras</p>

        <form onSubmit={submit} className="mt-9 flex max-w-sm flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="label">E-mail</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field h-11 px-3.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field h-11 px-3.5 text-sm"
            />
          </div>
          {(error || bootError) && (
            <p className="text-[13px] text-danger">{error || bootError}</p>
          )}
          <div className="mt-1.5 flex flex-col gap-3.5">
            <button disabled={busy} className="btn btn-lg btn-primary w-full">
              {busy ? "Entrando…" : "Entrar"}
            </button>
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-relaxed text-ink-3">
                Demonstração, senha <span className="font-mono">demo-demo</span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {DEMOS.map((conta) => (
                  <li key={conta.email}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void enter(conta.email, DEMO_PASSWORD)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5 text-left shadow-xs transition hover:-translate-y-px hover:border-[#cfe7fb] hover:bg-brand-soft/50 hover:shadow-sm disabled:opacity-50"
                    >
                      <span className="text-[13px] font-medium text-ink">{conta.role}</span>
                      <span className="truncate font-mono text-[11px] text-ink-3">{conta.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </form>

        <p className="mt-14 font-mono text-[10px] tracking-[0.1em] text-[#A9B8C4]">
          © 2026 OBRA360 · AMBIENTE DE DEMONSTRAÇÃO
        </p>
      </div>
    </div>
  );
}
