"""
Obra360 — worker de processamento de panoramas.

Consome a fila `pano.process` (ver contract.md), executa o pipeline:
  download → estabilização de horizonte → nadir patch → blur de rostos (LGPD)
  → preview 2048px → tiles piramidais AVIF → publica resultado.

Fase 1 (ponto fixo). Os estágios de walkthrough/SfM da fase 2 têm stubs no fim
do arquivo com o contrato já definido.

Execução:  python worker.py  (variáveis REDIS_URL, STORAGE_* no ambiente)
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import pyvips
import redis

log = logging.getLogger("obra360.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

QUEUE = "pano.process"
RESULT_CHANNEL = "pano.process.result"
PROGRESS_CHANNEL = "job.progress"


# ---------------------------------------------------------------------------
# Storage — trocar por S3/Supabase Storage em produção
# ---------------------------------------------------------------------------

class Storage:
    def __init__(self, root: str):
        self.root = root

    def get(self, key: str) -> bytes:
        with open(os.path.join(self.root, key), "rb") as f:
            return f.read()

    def put(self, key: str, data: bytes) -> str:
        path = os.path.join(self.root, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return key


# ---------------------------------------------------------------------------
# Estágios do pipeline
# ---------------------------------------------------------------------------

def stabilize_horizon(img: np.ndarray, roll_deg: float | None) -> np.ndarray:
    """Corrige roll da câmera deslocando a imagem equiretangular verticalmente.

    Para roll pequeno (<3°), um shift vertical proporcional é indistinguível da
    reprojeção completa e ~100x mais barato. Acima disso, reprojeta via remap.
    """
    if not roll_deg or abs(roll_deg) < 0.2:
        return img
    h, w = img.shape[:2]
    if abs(roll_deg) < 3.0:
        shift = int(round(h * roll_deg / 180.0))
        return np.roll(img, shift, axis=0)
    # Reprojeção completa: rotaciona a esfera em torno do eixo de visada
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lon = (xx / w) * 2 * np.pi - np.pi
    lat = np.pi / 2 - (yy / h) * np.pi
    x = np.cos(lat) * np.cos(lon)
    y = np.sin(lat)
    z = np.cos(lat) * np.sin(lon)
    r = np.deg2rad(roll_deg)
    y2 = y * np.cos(r) - z * np.sin(r)
    z2 = y * np.sin(r) + z * np.cos(r)
    lat2 = np.arcsin(np.clip(y2, -1, 1))
    lon2 = np.arctan2(z2, x)
    map_x = ((lon2 + np.pi) / (2 * np.pi) * w).astype(np.float32)
    map_y = ((np.pi / 2 - lat2) / np.pi * h).astype(np.float32)
    return cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def patch_nadir(img: np.ndarray, frac: float = 0.13) -> np.ndarray:
    """Cobre o corpo do operador no nadir com preenchimento por inpainting.

    O tripé/corpo ocupa o fundo da equiretangular (últimas ~13% das linhas).
    Inpaint com o conteúdo do anel imediatamente acima produz um "chão" plausível
    sem logotipo — suficiente até a fase de nadir logo configurável por tenant.
    """
    h = img.shape[0]
    band = int(h * frac)
    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    mask[h - band:, :] = 255
    small = cv2.resize(img, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    smask = cv2.resize(mask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    filled = cv2.inpaint(small, smask, 5, cv2.INPAINT_TELEA)
    filled = cv2.resize(filled, (img.shape[1], h), interpolation=cv2.INTER_LINEAR)
    out = img.copy()
    # transição suave entre imagem original e área preenchida
    feather = np.linspace(0, 1, band)[:, None, None]
    out[h - band:, :] = (img[h - band:, :] * (1 - feather) + filled[h - band:, :] * feather).astype(np.uint8)
    return out


def blur_faces(img: np.ndarray) -> tuple[np.ndarray, int]:
    """LGPD: detecta e borra rostos. Detector Haar como baseline; trocar por
    RetinaFace/YOLOv8-face em produção (equiretangular distorce rostos no topo)."""
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(24, 24))
    out = img.copy()
    for (x, y, w, h) in faces:
        pad = int(0.25 * max(w, h))
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        roi = out[y0:y1, x0:x1]
        k = max(9, (2 * ((x1 - x0) // 6) + 1))
        out[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (k, k), 0)
    return out, len(faces)


def make_preview(img: np.ndarray, width: int, fmt: str) -> bytes:
    h = int(img.shape[0] * width / img.shape[1])
    small = cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA)
    return _encode(small, fmt, quality=55)


def make_tiles(img: np.ndarray, tile_size: int, max_level: int, fmt: str) -> dict[str, bytes]:
    """Pirâmide equiretangular: nível L tem largura width/2^(max_level-L).
    Chave: tiles/{level}/{col}_{row}.{fmt}. Tiles são imutáveis (cache infinito)."""
    tiles: dict[str, bytes] = {}
    full_w = img.shape[1]
    for level in range(max_level + 1):
        scale = 2 ** (max_level - level)
        w = max(tile_size, full_w // scale)
        h = w // 2
        lvl = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        for row in range(0, h, tile_size):
            for col in range(0, w, tile_size):
                tile = lvl[row:row + tile_size, col:col + tile_size]
                key = f"tiles/{level}/{col // tile_size}_{row // tile_size}.{fmt}"
                tiles[key] = _encode(tile, fmt, quality=60)
    return tiles


def _encode(img: np.ndarray, fmt: str, quality: int) -> bytes:
    """Codifica via pyvips (AVIF/WebP são muito mais rápidos que OpenCV aqui)."""
    vi = pyvips.Image.new_from_array(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if fmt == "avif":
        return vi.heifsave_buffer(Q=quality, compression="av1")
    if fmt == "webp":
        return vi.webpsave_buffer(Q=quality)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes()


# ---------------------------------------------------------------------------
# Job runner
# ---------------------------------------------------------------------------

@dataclass
class Ctx:
    r: redis.Redis
    storage: Storage
    timings: dict[str, int] = field(default_factory=dict)

    def timed(self, name: str):
        ctx = self
        class _T:
            def __enter__(self): self.t0 = time.monotonic()
            def __exit__(self, *a): ctx.timings[name] = int((time.monotonic() - self.t0) * 1000)
        return _T()

    def progress(self, job_id: str, stage: str, pct: int):
        self.r.publish(PROGRESS_CHANNEL, json.dumps(
            {"job_id": job_id, "stage": stage, "progress_pct": pct}))


def process_panorama(ctx: Ctx, job: dict[str, Any]) -> dict[str, Any]:
    opts = job.get("options", {})
    base = os.path.dirname(job["storage_key"]) + f"/{job['panorama_id']}"

    with ctx.timed("download"):
        raw = ctx.storage.get(job["storage_key"])
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"imagem ilegível: {job['storage_key']}")
    if img.shape[1] != img.shape[0] * 2:
        raise ValueError("esperada equiretangular 2:1")
    ctx.progress(job["job_id"], "decode", 10)

    if opts.get("horizon_stabilize", True):
        with ctx.timed("horizon"):
            img = stabilize_horizon(img, job.get("imu_roll_deg"))

    nadir_done = False
    if opts.get("nadir_patch", True):
        with ctx.timed("nadir"):
            img = patch_nadir(img)
            nadir_done = True
    ctx.progress(job["job_id"], "nadir", 35)

    faces_found = 0
    if opts.get("blur_faces", True):
        with ctx.timed("blur"):
            img, faces_found = blur_faces(img)
    ctx.progress(job["job_id"], "lgpd", 50)

    fmt = opts.get("tile_format", "avif")
    with ctx.timed("preview"):
        preview_key = ctx.storage.put(
            f"{base}/preview_{opts.get('preview_width', 2048)}.{fmt}",
            make_preview(img, opts.get("preview_width", 2048), fmt))
    ctx.progress(job["job_id"], "preview", 65)

    with ctx.timed("tiles"):
        tiles = make_tiles(img, opts.get("tile_size", 512), opts.get("max_level", 4), fmt)
        for key, data in tiles.items():
            ctx.storage.put(f"{base}/{key}", data)
    ctx.progress(job["job_id"], "tiles", 100)

    return {
        "job_id": job["job_id"],
        "panorama_id": job["panorama_id"],
        "status": "done",
        "preview_key": preview_key,
        "tiles_key": f"{base}/tiles/",
        "width_px": img.shape[1],
        "height_px": img.shape[0],
        "nadir_patched": nadir_done,
        "faces_blurred": faces_found > 0,
        "faces_found": faces_found,
        "timings_ms": ctx.timings,
    }


def main() -> None:
    r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    storage = Storage(os.environ.get("STORAGE_ROOT", "./storage"))
    log.info("worker iniciado — fila %s", QUEUE)
    while True:
        _, payload = r.blpop(QUEUE)  # produção: BullMQ worker com lock/retry
        job = json.loads(payload)
        ctx = Ctx(r=r, storage=storage)
        try:
            result = process_panorama(ctx, job)
        except Exception as exc:  # noqa: BLE001 — resultado de falha vai para a fila
            log.exception("job %s falhou", job.get("job_id"))
            result = {"job_id": job.get("job_id"), "panorama_id": job.get("panorama_id"),
                      "status": "failed", "error": str(exc)}
        r.publish(RESULT_CHANNEL, json.dumps(result))
        log.info("job %s → %s", job.get("job_id"), result["status"])


# ---------------------------------------------------------------------------
# Fase 2 — stubs com contrato definido (ver contract.md)
# ---------------------------------------------------------------------------

def extract_keyframes_by_displacement(video_key: str, imu_key: str, min_disp_m: float) -> list[dict]:
    """Extrai keyframes por deslocamento estimado (IMU + fluxo óptico), não por tempo.
    Retorna [{"t_s": float, "frame_key": str, "est_disp_m": float}, ...]."""
    raise NotImplementedError("fase 2")


def run_sfm(keyframes: list[dict], anchors: list[dict], backend: str = "colmap") -> list[dict]:
    """SfM esparso (COLMAP sequential matcher) + alinhamento ao frame da planta via
    âncoras manuais (Umeyama 2D). Retorna poses [{"frame_key", "x_m", "y_m",
    "heading_deg", "conf"}]. Fallback por interpolação IMU quando um trecho falha."""
    raise NotImplementedError("fase 2")


def temporal_align(capture_id: str, prev_capture_id: str) -> list[dict]:
    """Casa panoramas da captura atual com a anterior: 1º por waypoint_code igual,
    2º por proximidade na planta (< 1,5 m), 3º (fase 3) por registro de features."""
    raise NotImplementedError("fase 2")


if __name__ == "__main__":
    main()
