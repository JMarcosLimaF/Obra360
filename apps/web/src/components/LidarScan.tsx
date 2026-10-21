import { useEffect, useRef } from "react";

/*
 * Animação do painel de marca do login: uma câmera LiDAR no tripé (estilo
 * Matterport Pro) varre um cômodo em obra visto em modo "dollhouse". A nuvem de
 * pontos surge onde o plano do laser passa; cada elemento reconhecido ganha
 * caixa 3D, segmentação de cor e etiqueta. Canvas 2D puro, sem dependências.
 */

type V3 = [number, number, number];

const TAU = Math.PI * 2;

// cômodo: x ∈ [-HX, HX], z ∈ [-HZ, HZ], y ∈ [0, H] — em metros
const HX = 4;
const HZ = 3;
const H = 2.8;

// paredes, para o "backface culling" do dollhouse (parede de costas some)
const BACK = 1, LEFT = 2, RIGHT = 4, FRONT = 8;
const WALLS: { bit: number; n: V3; c: V3 }[] = [
  { bit: BACK, n: [0, 0, 1], c: [0, H / 2, -HZ] },
  { bit: LEFT, n: [1, 0, 0], c: [-HX, H / 2, 0] },
  { bit: RIGHT, n: [-1, 0, 0], c: [HX, H / 2, 0] },
  { bit: FRONT, n: [0, 0, -1], c: [0, H / 2, HZ] },
];

// estações de escaneamento percorridas em ciclo
const STATIONS: [number, number][] = [[-0.5, 0.2], [0.9, 1.35], [-0.9, -1.1]];

// linha do tempo de cada estação (s)
const START = Math.PI * 0.85; // ângulo inicial do laser no plano xz
const T_BOOT = 0.8;
const T_SWEEP = 9;
const T_HOLD = 3.6;
const T_FADE = 1.4;
const T_SCAN_END = T_BOOT + T_SWEEP;
const T_FADE_START = T_SCAN_END + T_HOLD;
const T_CYCLE = T_FADE_START + T_FADE;

const GREEN = "152,241,152";
const AMBER = "255,181,71";
const BLUE = "0,155,255";

interface Det {
  name: string;
  meta: string;
  conf: number;
  min: V3;
  max: V3;
  nc?: boolean;
}

// a ordem casa com o índice `det` gravado nos pontos em buildCloud()
const DETS: Det[] = [
  { name: "PORTA · P01", meta: "0,90 × 2,10 m", conf: 99.1, min: [-HX, 0, -0.45], max: [-HX + 0.04, 2.1, 0.45] },
  { name: "QUADRO ELÉTRICO", meta: "QD-1 · 60 × 80 cm", conf: 96.4, min: [-3.3, 1.1, -HZ], max: [-2.7, 1.9, -HZ + 0.12] },
  { name: "FISSURA · NC-014", meta: "0,62 m · abertura 1,2 mm", conf: 91.8, min: [-1.7, 0.36, -HZ], max: [-0.9, 1.92, -HZ + 0.02], nc: true },
  { name: "JANELA · J02", meta: "1,60 × 1,20 m", conf: 98.6, min: [0.6, 0.9, -HZ], max: [2.2, 2.1, -HZ + 0.04] },
  { name: "PRUMADA · Ø100", meta: "PVC · h 2,80 m", conf: 94.2, min: [3.64, 0, -2.8], max: [3.8, H, -2.64] },
  { name: "PILAR · P3", meta: "40 × 40 cm", conf: 99.4, min: [2.2, 0, -0.2], max: [2.6, H, 0.2] },
  { name: "PALETE · BLOCOS", meta: "1,20 × 1,00 × 0,90 m", conf: 97.3, min: [-2.9, 0, 1.0], max: [-1.7, 0.9, 2.0] },
];

// grupos de pontos, na ordem em que são gerados e desenhados
const GROUPS = [
  { fill: "rgb(104,152,204)", alpha: 0.36, size: 1.05 }, // piso
  { fill: "rgb(160,200,238)", alpha: 0.5, size: 1.1 }, // paredes
  { fill: "rgb(222,238,255)", alpha: 0.85, size: 1.25 }, // arestas
  { fill: "rgb(112,206,255)", alpha: 0.8, size: 1.3 }, // objetos
  { fill: `rgb(${AMBER})`, alpha: 1, size: 1.6 }, // fissura
];

const BOX_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const BOX_FACES = [
  [0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5],
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - (1 - v) ** 3;
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);
const mod = (a: number, n: number) => ((a % n) + n) % n;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxCorners(min: V3, max: V3): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push([i & 1 ? max[0] : min[0], i & 4 ? max[1] : min[1], i & 2 ? max[2] : min[2]]);
  }
  return out;
}

interface Cloud {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  mask: Uint8Array; // paredes a que o ponto pertence (0 = sempre visível)
  det: Int8Array; // elemento detectado a que o ponto pertence (-1 = nenhum)
  ranges: [number, number][]; // [início, fim) de cada grupo
  detPts: Int32Array; // índices dos pontos com det >= 0
}

function buildCloud(): Cloud {
  const rnd = mulberry32(360);
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], ms: number[] = [], ds: number[] = [];
  const ranges: [number, number][] = [];
  let start = 0;
  const jit = (s: number) => (rnd() - 0.5) * s;
  const add = (x: number, y: number, z: number, m = 0, d = -1) => {
    xs.push(x); ys.push(y); zs.push(z); ms.push(m); ds.push(d);
  };
  const close = () => {
    ranges.push([start, xs.length]);
    start = xs.length;
  };
  // grade com jitter sobre um retângulo paramétrico (u, v)
  const grid = (
    u0: number, u1: number, v0: number, v1: number, step: number,
    put: (u: number, v: number) => void, skip?: (u: number, v: number) => boolean,
  ) => {
    for (let u = u0 + step / 2; u < u1; u += step) {
      for (let v = v0 + step / 2; v < v1; v += step) {
        const uu = u + jit(step * 0.7), vv = v + jit(step * 0.7);
        if (!skip?.(uu, vv)) put(uu, vv);
      }
    }
  };
  const line = (a: V3, b: V3, step: number, m = 0, d = -1) => {
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      add(a[0] + (b[0] - a[0]) * t + jit(0.012), a[1] + (b[1] - a[1]) * t + jit(0.012), a[2] + (b[2] - a[2]) * t + jit(0.012), m, d);
    }
  };
  const poly = (pts: V3[], step: number, m = 0, d = -1, closed = true) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) line(pts[i], pts[(i + 1) % pts.length], step, m, d);
  };
  // superfícies de uma caixa; `faces` escolhe quais (x/X, z/Z = laterais, Y = topo)
  const boxSurf = (a: V3, b: V3, step: number, d: number, faces = "xXzZY") => {
    if (faces.includes("x")) grid(a[2], b[2], a[1], b[1], step, (z, y) => add(a[0], y, z, 0, d));
    if (faces.includes("X")) grid(a[2], b[2], a[1], b[1], step, (z, y) => add(b[0], y, z, 0, d));
    if (faces.includes("z")) grid(a[0], b[0], a[1], b[1], step, (x, y) => add(x, y, a[2], 0, d));
    if (faces.includes("Z")) grid(a[0], b[0], a[1], b[1], step, (x, y) => add(x, y, b[2], 0, d));
    if (faces.includes("Y")) grid(a[0], b[0], a[2], b[2], step, (x, z) => add(x, b[1], z, 0, d));
  };
  const boxEdges = (a: V3, b: V3, step: number, d: number) => {
    const c = boxCorners(a, b);
    for (const [i, k] of BOX_EDGES) line(c[i], c[k], step, 0, d);
  };

  // 0 · piso
  grid(-HX, HX, -HZ, HZ, 0.15, (x, z) => add(x, 0, z));
  close();

  // 1 · paredes, com vãos de janela, porta e o nicho do quadro
  const inWindow = (x: number, y: number) => x > 0.6 && x < 2.2 && y > 0.9 && y < 2.1;
  const inPanel = (x: number, y: number) => x > -3.3 && x < -2.7 && y > 1.1 && y < 1.9;
  const inDoor = (z: number, y: number) => z > -0.45 && z < 0.45 && y < 2.1;
  grid(-HX, HX, 0, H, 0.13, (x, y) => add(x, y, -HZ, BACK), (x, y) => inWindow(x, y) || inPanel(x, y));
  grid(-HZ, HZ, 0, H, 0.13, (z, y) => add(-HX, y, z, LEFT), inDoor);
  grid(-HZ, HZ, 0, H, 0.13, (z, y) => add(HX, y, z, RIGHT));
  grid(-HX, HX, 0, H, 0.13, (x, y) => add(x, y, HZ, FRONT));
  close();

  // 2 · arestas: perímetro do piso, corte das paredes, cantos e esquadrias
  const e = 0.035;
  poly([[-HX, 0, -HZ], [HX, 0, -HZ], [HX, 0, HZ], [-HX, 0, HZ]], e);
  line([-HX, H, -HZ], [HX, H, -HZ], e, BACK);
  line([HX, H, -HZ], [HX, H, HZ], e, RIGHT);
  line([HX, H, HZ], [-HX, H, HZ], e, FRONT);
  line([-HX, H, HZ], [-HX, H, -HZ], e, LEFT);
  line([-HX, 0, -HZ], [-HX, H, -HZ], e, BACK | LEFT);
  line([HX, 0, -HZ], [HX, H, -HZ], e, BACK | RIGHT);
  line([HX, 0, HZ], [HX, H, HZ], e, RIGHT | FRONT);
  line([-HX, 0, HZ], [-HX, H, HZ], e, LEFT | FRONT);
  poly([[0.6, 0.9, -HZ], [2.2, 0.9, -HZ], [2.2, 2.1, -HZ], [0.6, 2.1, -HZ]], 0.03, BACK, 3);
  line([1.4, 0.9, -HZ + 0.01], [1.4, 2.1, -HZ + 0.01], 0.03, BACK, 3);
  poly([[-HX, 0, -0.45], [-HX, 2.1, -0.45], [-HX, 2.1, 0.45], [-HX, 0, 0.45]], 0.03, LEFT, 0, false);
  close();

  // 3 · objetos
  boxSurf([-3.3, 1.1, -HZ], [-2.7, 1.9, -HZ + 0.12], 0.06, 1, "xXZY");
  boxEdges([-3.3, 1.1, -HZ], [-2.7, 1.9, -HZ + 0.12], 0.03, 1);
  for (let y = 0.03; y < H; y += 0.07) {
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + jit(0.3);
      add(3.72 + Math.cos(a) * 0.08, y + jit(0.03), -2.72 + Math.sin(a) * 0.08, 0, 4);
    }
  }
  boxSurf([2.2, 0, -0.2], [2.6, H, 0.2], 0.09, 5, "xXzZ");
  boxEdges([2.2, 0, -0.2], [2.6, H, 0.2], 0.035, 5);
  boxSurf([-2.9, 0, 1.0], [-1.7, 0.9, 2.0], 0.1, 6);
  boxEdges([-2.9, 0, 1.0], [-1.7, 0.9, 2.0], 0.035, 6);
  for (const y of [0.15, 0.4, 0.65]) poly([[-2.9, y, 1.0], [-1.7, y, 1.0], [-1.7, y, 2.0], [-2.9, y, 2.0]], 0.05, 0, 6);
  close();

  // 4 · fissura na parede do fundo (vira a não conformidade)
  const zc = -HZ + 0.01;
  poly([[-1.62, 0.42, zc], [-1.48, 0.7, zc], [-1.52, 0.92, zc], [-1.3, 1.15, zc], [-1.34, 1.38, zc], [-1.12, 1.62, zc], [-0.98, 1.86, zc]], 0.018, BACK, 2, false);
  poly([[-1.3, 1.15, zc], [-1.12, 1.08, zc], [-0.95, 1.13, zc]], 0.018, BACK, 2, false);
  close();

  const det = Int8Array.from(ds);
  const detIdx: number[] = [];
  det.forEach((d, i) => d >= 0 && detIdx.push(i));
  return {
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    mask: Uint8Array.from(ms), det, ranges, detPts: Int32Array.from(detIdx),
  };
}

export default function LidarScan() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const stationRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const ptsRef = useRef<HTMLElement>(null);
  const detRef = useRef<HTMLElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const cloud = buildCloud();
    const N = cloud.x.length;
    const reveal = new Float32Array(N);
    const sx = new Float32Array(N);
    const sy = new Float32Array(N);
    const fresh = new Int32Array(N);
    const visByMask = new Float32Array(16);
    const detT = new Float32Array(DETS.length);
    const detShown = new Uint8Array(DETS.length);
    const corners = DETS.map((d) => boxCorners(d.min, d.max));
    let order: number[] = [];
    let cycle = -1;

    type Rect = { x: number; y: number; w: number; h: number };
    let w = 0, h = 0, dpr = 1;
    let obstacles: Rect[] = [];
    const lastSpot = new Int8Array(DETS.length).fill(-1);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // áreas que as etiquetas não podem cobrir: HUD e logotipo
      obstacles = [{ x: 40, y: 32, w: 190, h: 64 }];
      const hr = hudRef.current?.getBoundingClientRect();
      if (hr) obstacles.push({ x: hr.left - r.left - 8, y: hr.top - r.top - 8, w: hr.width + 16, h: hr.height + 16 });
    };

    // a varredura revela cada ponto quando o laser passa pelo seu azimute
    const setupCycle = (c: number) => {
      cycle = c;
      lastSpot.fill(-1);
      const [px, pz] = STATIONS[c % STATIONS.length];
      for (let i = 0; i < N; i++) {
        const th = Math.atan2(cloud.z[i] - pz, cloud.x[i] - px);
        reveal[i] = T_BOOT + (mod(th - START, TAU) / TAU) * T_SWEEP;
      }
      DETS.forEach((d, i) => {
        const th = Math.atan2((d.min[2] + d.max[2]) / 2 - pz, (d.min[0] + d.max[0]) / 2 - px);
        detT[i] = T_BOOT + (mod(th - START, TAU) / TAU) * T_SWEEP + 0.3;
      });
      order = DETS.map((_, i) => i).sort((a, b) => detT[a] - detT[b]);
    };

    // câmera do observador (orbita devagar em volta do cômodo)
    let C0 = 0, C1 = 0, C2 = 0, r0 = 0, r2 = 0, u0 = 0, u1 = 0, u2 = 0, f0 = 0, f1 = 0, f2 = 0;
    let focal = 1, cx = 0, cy = 0, R = 13.5, el = 0.62;
    const proj = (x: number, y: number, z: number): [number, number, number] => {
      const dx = x - C0, dy = y - C1, dz = z - C2;
      const zc = Math.max(0.1, dx * f0 + dy * f1 + dz * f2);
      const k = focal / zc;
      return [cx + (dx * r0 + dz * r2) * k, cy - (dx * u0 + dy * u1 + dz * u2) * k, zc];
    };

    let hudTick = 0;
    const hud = { status: "", station: "", pct: "", pts: "", det: "" };
    const setText = (node: HTMLElement | null, key: keyof typeof hud, v: string) => {
      if (node && hud[key] !== v) {
        hud[key] = v;
        node.textContent = v;
      }
    };

    const render = (time: number, t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      const yaw = 0.62 + 0.3 * Math.sin(time * 0.07);
      R = 13.5;
      el = 0.62;
      const T: V3 = [0, 0.7, 0];
      C0 = T[0] + R * Math.cos(el) * Math.sin(yaw);
      C1 = T[1] + R * Math.sin(el);
      C2 = T[2] + R * Math.cos(el) * Math.cos(yaw);
      {
        let a = T[0] - C0, b = T[1] - C1, c = T[2] - C2;
        const l = Math.hypot(a, b, c);
        f0 = a / l; f1 = b / l; f2 = c / l;
        // right = normalize(f × up), com up = (0,1,0)
        a = -f2; c = f0;
        const lr = Math.hypot(a, c);
        r0 = a / lr; r2 = c / lr;
        // up = right × f
        u0 = -r2 * f1; u1 = r2 * f0 - r0 * f2; u2 = r0 * f1;
      }
      focal = Math.min(w * 0.94, h * 0.84);
      cx = w * 0.5;
      cy = h * 0.41;

      // visibilidade de cada parede conforme a câmera (dollhouse)
      const wallVis = WALLS.map((wl) => {
        const vx = C0 - wl.c[0], vy = C1 - wl.c[1], vz = C2 - wl.c[2];
        const d = (wl.n[0] * vx + wl.n[1] * vy + wl.n[2] * vz) / Math.hypot(vx, vy, vz);
        return 0.06 + 0.94 * clamp01((d + 0.05) / 0.3);
      });
      for (let m = 0; m < 16; m++) {
        let v = m === 0 ? 1 : 0;
        WALLS.forEach((wl, k) => { if (m & wl.bit) v = Math.max(v, wallVis[k]); });
        visByMask[m] = v;
      }
      const wallVisOf = (bit: number) => wallVis[WALLS.findIndex((wl) => wl.bit === bit)];

      // fases
      const scanning = t >= T_BOOT && t <= T_SCAN_END;
      const fading = t > T_FADE_START;
      const gFade = fading ? 1 - easeInOut(clamp01((t - T_FADE_START) / T_FADE)) : 1;
      const sweep = clamp01((t - T_BOOT) / T_SWEEP);
      const ang = START + sweep * TAU;
      const st = STATIONS[cycle % STATIONS.length];
      const nx = STATIONS[(cycle + 1) % STATIONS.length];
      const mv = fading ? easeInOut(clamp01((t - T_FADE_START) / T_FADE)) : 0;
      const px = st[0] + (nx[0] - st[0]) * mv;
      const pz = st[1] + (nx[1] - st[1]) * mv;
      for (let i = 0; i < DETS.length; i++) detShown[i] = t >= detT[i] + 0.15 ? 1 : 0;

      // superfícies "solidificam" quando o modelo fecha
      const hf = clamp01((t - T_SCAN_END) / 0.9) * gFade;
      if (hf > 0) {
        const quad = (pts: V3[], a: number) => {
          ctx.beginPath();
          pts.forEach((p, i) => {
            const [qx, qy] = proj(p[0], p[1], p[2]);
            if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy);
          });
          ctx.closePath();
          ctx.fillStyle = `rgba(${BLUE},${a})`;
          ctx.fill();
        };
        quad([[-HX, 0, -HZ], [HX, 0, -HZ], [HX, 0, HZ], [-HX, 0, HZ]], 0.06 * hf);
        quad([[-HX, 0, -HZ], [HX, 0, -HZ], [HX, H, -HZ], [-HX, H, -HZ]], 0.07 * hf * wallVisOf(BACK));
        quad([[-HX, 0, -HZ], [-HX, 0, HZ], [-HX, H, HZ], [-HX, H, -HZ]], 0.07 * hf * wallVisOf(LEFT));
        quad([[HX, 0, -HZ], [HX, 0, HZ], [HX, H, HZ], [HX, H, -HZ]], 0.07 * hf * wallVisOf(RIGHT));
        quad([[-HX, 0, HZ], [HX, 0, HZ], [HX, H, HZ], [-HX, H, HZ]], 0.07 * hf * wallVisOf(FRONT));
      }

      // marcadores das estações no piso (os "discos" do Matterport)
      const ring = (x: number, z: number, r: number, stroke: string) => {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const a = (i / 40) * TAU;
          const [qx, qy] = proj(x + Math.cos(a) * r, 0.005, z + Math.sin(a) * r);
          if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy);
        }
        ctx.strokeStyle = stroke;
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      STATIONS.forEach(([x, z]) => ring(x, z, 0.22, "rgba(255,255,255,0.16)"));
      ring(px, pz, 0.5, "rgba(255,255,255,0.4)");
      if (t < 1.6) {
        const p = t / 1.6;
        ring(px, pz, 0.5 + p * 3.4, `rgba(${BLUE},${(1 - p) * 0.55})`);
      }

      // nuvem de pontos
      const near = R - 6, far = R + 6;
      const sizeRef = focal / R;
      let revealed = 0, nFresh = 0;
      for (let g = 0; g < GROUPS.length; g++) {
        const G = GROUPS[g];
        const [a, b] = cloud.ranges[g];
        ctx.fillStyle = G.fill;
        for (let i = a; i < b; i++) {
          const age = t - reveal[i];
          if (age < 0) continue;
          revealed++;
          const dx = cloud.x[i] - C0, dy = cloud.y[i] - C1, dz = cloud.z[i] - C2;
          const zc = dx * f0 + dy * f1 + dz * f2;
          if (zc < 0.1) continue;
          const k = focal / zc;
          const qx = cx + (dx * r0 + dz * r2) * k;
          const qy = cy - (dx * u0 + dy * u1 + dz * u2) * k;
          sx[i] = qx;
          sy[i] = qy;
          if (age < 0.7) fresh[nFresh++] = i;
          const d = cloud.det[i];
          if (d >= 0 && detShown[d]) continue; // desenhado na passada de segmentação
          const dn = clamp01((zc - near) / (far - near));
          ctx.globalAlpha = G.alpha * visByMask[cloud.mask[i]] * (1 - dn * 0.45) * gFade;
          const s = G.size * (k / sizeRef);
          ctx.fillRect(qx - s / 2, qy - s / 2, s, s);
        }
      }

      // segmentação: pontos dos elementos reconhecidos ganham a cor da detecção
      for (const nc of [false, true]) {
        ctx.fillStyle = `rgb(${nc ? AMBER : GREEN})`;
        for (let j = 0; j < cloud.detPts.length; j++) {
          const i = cloud.detPts[j];
          const d = cloud.det[i];
          if (!detShown[d] || !!DETS[d].nc !== nc) continue;
          const tint = clamp01((t - detT[d] - 0.15) / 0.4);
          ctx.globalAlpha = (0.55 + 0.4 * tint) * visByMask[cloud.mask[i]] * gFade;
          const s = nc ? 1.7 : 1.35;
          ctx.fillRect(sx[i] - s / 2, sy[i] - s / 2, s, s);
        }
      }

      // brilho dos pontos recém-capturados
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgb(190,232,255)";
      for (let j = 0; j < nFresh; j++) {
        const i = fresh[j];
        const e = 1 - (t - reveal[i]) / 0.7;
        ctx.globalAlpha = e * e * 0.85 * visByMask[cloud.mask[i]] * gFade;
        const s = 1 + 1.5 * e;
        ctx.fillRect(sx[i] - s / 2, sy[i] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // laser: plano vertical girando a partir do emissor no topo da câmera
      const lensY = 1.78;
      const [lx, ly] = proj(px, lensY, pz);
      if (scanning) {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const tx = ca > 1e-6 ? (HX - px) / ca : ca < -1e-6 ? (-HX - px) / ca : Infinity;
        const tz = sa > 1e-6 ? (HZ - pz) / sa : sa < -1e-6 ? (-HZ - pz) / sa : Infinity;
        const th = Math.min(tx, tz);
        const wall = tx < tz ? (ca > 0 ? RIGHT : LEFT) : sa > 0 ? FRONT : BACK;
        const wv = Math.max(0.25, wallVisOf(wall));
        const hx = px + ca * th, hz = pz + sa * th;
        const [ax, ay] = proj(hx, 0, hz);
        const [bx, by] = proj(hx, H, hz);

        const grad = ctx.createLinearGradient(lx, ly, (ax + bx) / 2, (ay + by) / 2);
        grad.addColorStop(0, `rgba(${BLUE},0.34)`);
        grad.addColorStop(1, `rgba(${BLUE},0.03)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.closePath();
        ctx.fill();

        // raios até os pontos que acabaram de ser atingidos
        ctx.beginPath();
        for (let j = 0; j < nFresh; j += 3) {
          const i = fresh[j];
          if (t - reveal[i] > 0.05) continue;
          ctx.moveTo(lx, ly);
          ctx.lineTo(sx[i], sy[i]);
        }
        ctx.strokeStyle = `rgba(${BLUE},0.1)`;
        ctx.lineWidth = 0.6;
        ctx.stroke();

        // linha de varredura na superfície atingida
        const [fx, fy] = proj(px, 0, pz);
        ctx.strokeStyle = `rgba(${BLUE},0.35)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.lineCap = "round";
        ctx.strokeStyle = `rgba(${BLUE},${0.25 * wv})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.strokeStyle = `rgba(200,236,255,${0.9 * wv})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.lineCap = "butt";
      }
      ctx.globalCompositeOperation = "source-over";

      // câmera LiDAR no tripé
      const bodyAng = scanning ? ang : t < T_BOOT ? START : START + TAU;
      {
        ctx.strokeStyle = "rgba(190,220,250,0.7)";
        ctx.lineWidth = 1.4;
        const [hx, hy] = proj(px, 0.95, pz);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU + 0.35;
          const [qx, qy] = proj(px + Math.cos(a) * 0.45, 0, pz + Math.sin(a) * 0.45);
          ctx.moveTo(hx, hy);
          ctx.lineTo(qx, qy);
        }
        const [tx2, ty2] = proj(px, 1.3, pz);
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx2, ty2);
        ctx.stroke();

        // corpo: caixa girando com o laser, só as faces voltadas ao observador
        const ca = Math.cos(bodyAng), sa = Math.sin(bodyAng);
        const hfw = 0.1, hs = 0.12, y0 = 1.3, y1 = 1.72;
        const bc: V3[] = [];
        for (const yy of [y0, y1]) {
          for (const [fw, sd] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            bc.push([px + ca * hfw * fw - sa * hs * sd, yy, pz + sa * hfw * fw + ca * hs * sd]);
          }
        }
        const faces: { idx: number[]; n: V3; fill: string }[] = [
          { idx: [1, 3, 7, 5], n: [ca, 0, sa], fill: "#123d66" },
          { idx: [0, 2, 6, 4], n: [-ca, 0, -sa], fill: "#0b2b4a" },
          { idx: [2, 3, 7, 6], n: [-sa, 0, ca], fill: "#0f3457" },
          { idx: [0, 1, 5, 4], n: [sa, 0, -ca], fill: "#0f3457" },
          { idx: [4, 5, 7, 6], n: [0, 1, 0], fill: "#1d5385" },
        ];
        const pc = bc.map((p) => proj(p[0], p[1], p[2]));
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(200,230,255,0.6)";
        for (const fc of faces) {
          const c = fc.idx.reduce<V3>((s, i) => [s[0] + bc[i][0] / 4, s[1] + bc[i][1] / 4, s[2] + bc[i][2] / 4], [0, 0, 0]);
          if (fc.n[0] * (C0 - c[0]) + fc.n[1] * (C1 - c[1]) + fc.n[2] * (C2 - c[2]) <= 0) continue;
          ctx.beginPath();
          fc.idx.forEach((i, j) => (j ? ctx.lineTo(pc[i][0], pc[i][1]) : ctx.moveTo(pc[i][0], pc[i][1])));
          ctx.closePath();
          ctx.fillStyle = fc.fill;
          ctx.fill();
          ctx.stroke();
        }

        // módulo LiDAR no topo
        const [ox, oy, oz] = proj(px, y1, pz);
        const [, ty] = proj(px, y1 + 0.12, pz);
        const rx = (0.08 * focal) / oz;
        const ry = rx * Math.sin(el);
        ctx.fillStyle = "#0c2f50";
        ctx.beginPath();
        ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI);
        ctx.lineTo(ox - rx, ty);
        ctx.ellipse(ox, ty, rx, ry, 0, Math.PI, TAU);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#2a6aa3";
        ctx.beginPath();
        ctx.ellipse(ox, ty, rx, ry, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();

        // lente frontal
        const lensP: V3 = [px + ca * (hfw + 0.005), 1.52, pz + sa * (hfw + 0.005)];
        const toC = Math.hypot(C0 - lensP[0], C1 - lensP[1], C2 - lensP[2]);
        const facing = (ca * (C0 - lensP[0]) + sa * (C2 - lensP[2])) / toC;
        if (facing > -0.1) {
          const [qx, qy] = proj(lensP[0], lensP[1], lensP[2]);
          const rr = 4 + 8 * clamp01(facing);
          const g = ctx.createRadialGradient(qx, qy, 0, qx, qy, rr);
          g.addColorStop(0, `rgba(${BLUE},0.9)`);
          g.addColorStop(1, `rgba(${BLUE},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(qx - rr, qy - rr, rr * 2, rr * 2);
          ctx.fillStyle = "rgba(220,242,255,0.95)";
          ctx.fillRect(qx - 1, qy - 1, 2, 2);
        }

        // emissor pulsando enquanto varre
        if (scanning) {
          const pulse = 0.6 + 0.4 * Math.sin(time * 18);
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 10);
          g.addColorStop(0, `rgba(210,240,255,${0.9 * pulse})`);
          g.addColorStop(1, `rgba(${BLUE},0)`);
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = g;
          ctx.fillRect(lx - 10, ly - 10, 20, 20);
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // detecções: caixa 3D que se desenha, flash e etiqueta
      ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = "alphabetic";
      const [gx, gy] = proj(px, 0, pz);
      const [, gTop] = proj(px, 1.9, pz);
      const placed: Rect[] = [...obstacles, { x: gx - 36, y: gTop - 10, w: 72, h: gy - gTop + 22 }];
      let nDet = 0;
      for (const i of order) {
        const dt = t - detT[i];
        if (dt < 0) continue;
        const d = DETS[i];
        const col = d.nc ? AMBER : GREEN;
        const pc = corners[i].map((p) => proj(p[0], p[1], p[2]));
        const ep = easeOut(clamp01(dt / 0.55));

        if (dt < 0.9) {
          ctx.fillStyle = `rgba(${col},${(1 - dt / 0.9) * 0.14 * gFade})`;
          for (const f of BOX_FACES) {
            ctx.beginPath();
            f.forEach((k, j) => (j ? ctx.lineTo(pc[k][0], pc[k][1]) : ctx.moveTo(pc[k][0], pc[k][1])));
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.strokeStyle = `rgba(${col},${0.85 * gFade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of BOX_EDGES) {
          ctx.moveTo(pc[a][0], pc[a][1]);
          ctx.lineTo(pc[a][0] + (pc[b][0] - pc[a][0]) * ep, pc[a][1] + (pc[b][1] - pc[a][1]) * ep);
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${gFade})`;
        for (const p of pc) ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
      }

      // etiquetas por cima de todas as caixas
      for (const i of order) {
        const dt = t - detT[i];
        if (dt < 0) continue;
        const d = DETS[i];
        const col = d.nc ? AMBER : GREEN;
        const la = clamp01((dt - 0.3) / 0.3) * gFade;
        if (la <= 0) continue;
        nDet++;
        const [ax, ay] = proj((d.min[0] + d.max[0]) / 2, d.max[1], (d.min[2] + d.max[2]) / 2);
        const conf = `${(d.conf * easeOut(clamp01((dt - 0.3) / 0.7))).toFixed(1).replace(".", ",")}%`;
        const nameW = ctx.measureText(d.name).width;
        const confW = ctx.measureText("00,0%").width;
        const metaW = ctx.measureText(d.meta).width;
        const bw = Math.max(nameW + confW + 40, metaW + 24);
        const bh = 34;
        // posições candidatas em volta da âncora; fica na última que serviu
        // para a etiqueta não pular de lado a cada quadro
        const spot = (k: number): [number, number] => {
          const ring = k >> 2, q = k & 3;
          const x = q & 1 ? ax - 18 - bw : ax + 18;
          const y = q & 2 ? ay + 14 + ring * (bh + 8) : ay - 44 - ring * (bh + 8);
          return [x, y];
        };
        const free = ([x, y]: [number, number]) =>
          x >= 16 && x + bw <= w - 16 && y >= 24 && y + bh <= h * 0.62 &&
          !placed.some((p) => x < p.x + p.w + 6 && x + bw + 6 > p.x && y < p.y + p.h + 6 && y + bh + 6 > p.y);
        let k = lastSpot[i] >= 0 && free(spot(lastSpot[i])) ? lastSpot[i] : -1;
        for (let c = 0; k < 0 && c < 20; c++) if (free(spot(c))) k = c;
        if (k < 0) k = 0;
        lastSpot[i] = k;
        const [bx, by] = spot(k);
        placed.push({ x: bx, y: by, w: bw, h: bh });

        ctx.globalAlpha = la;
        ctx.strokeStyle = `rgba(${col},0.7)`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx > ax ? bx : bx + bw, by > ay ? by : by + bh);
        ctx.stroke();
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath();
        ctx.arc(ax, ay, 2.2, 0, TAU);
        ctx.fill();
        if (d.nc) {
          const p = (time * 0.9) % 1;
          ctx.strokeStyle = `rgba(${col},${(1 - p) * 0.8})`;
          ctx.beginPath();
          ctx.arc(ax, ay, 3 + p * 12, 0, TAU);
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(6,27,46,0.82)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = `rgba(${col},0.55)`;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.fillStyle = `rgb(${col})`;
        ctx.fillRect(bx + 8, by + 9, 6, 6);
        const typed = Math.ceil(d.name.length * clamp01((dt - 0.3) / 0.45));
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText(d.name.slice(0, typed), bx + 20, by + 15);
        ctx.fillStyle = `rgb(${col})`;
        ctx.textAlign = "right";
        ctx.fillText(conf, bx + bw - 8, by + 15);
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(d.meta, bx + 8, by + 28);
        ctx.globalAlpha = 1;
      }

      // HUD em DOM, atualizado a cada poucos quadros
      if (hudTick++ % 4 === 0) {
        const status = t < T_BOOT ? "INICIALIZANDO" : scanning ? "VARREDURA LiDAR" : fading ? "REPOSICIONANDO" : "MODELO 3D GERADO";
        const n = STATIONS.length;
        setText(statusRef.current, "status", status);
        setText(stationRef.current, "station", `ESTAÇÃO ${String((cycle % n) + 1).padStart(2, "0")}/${String(n).padStart(2, "0")}`);
        setText(pctRef.current, "pct", `${Math.round(sweep * 100)}%`);
        setText(ptsRef.current, "pts", Math.round(revealed * 293.7).toLocaleString("pt-BR"));
        setText(detRef.current, "det", String(nDet));
        if (barRef.current) barRef.current.style.transform = `scaleX(${sweep})`;
      }
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!w || !h) return;
      const time = Math.max(0, (now - t0) / 1000);
      const c = Math.floor(time / T_CYCLE);
      if (c !== cycle) setupCycle(c);
      render(time, time - c * T_CYCLE);
    };
    // sem movimento: mostra o modelo pronto, estático
    const still = () => {
      if (!w || !h) return;
      if (cycle < 0) setupCycle(0);
      render(0, T_SCAN_END + 1.5);
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) still();
    });
    ro.observe(canvas);
    resize();
    if (reduce) still();
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div ref={hudRef} className="absolute right-14 top-12 w-[190px] font-mono text-[10px] tracking-[0.12em] text-white/50">
        <div className="flex items-center gap-2 text-white/85">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
          </span>
          <span ref={statusRef}>VARREDURA LiDAR</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span ref={stationRef}>ESTAÇÃO 01/03</span>
          <span ref={pctRef} className="text-white/85">0%</span>
        </div>
        <div className="mt-1.5 h-px w-full bg-white/15">
          <div ref={barRef} className="h-px origin-left bg-brand" style={{ transform: "scaleX(0)" }} />
        </div>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1">
          <dt>PONTOS</dt>
          <dd ref={ptsRef} className="text-right text-white/85">0</dd>
          <dt>ELEMENTOS</dt>
          <dd ref={detRef} className="text-right text-white/85">0</dd>
          <dt>PRECISÃO</dt>
          <dd className="text-right text-white/85">±20 mm</dd>
        </dl>
      </div>
    </div>
  );
}
