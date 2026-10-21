# Contrato da fila de processamento

Fila: Redis + BullMQ. O backend Node enfileira; workers Python consomem via
`bullmq` (pacote Python oficial) ou leitura direta das estruturas Redis.

## Filas

| Fila | Job | Gatilho |
|---|---|---|
| `pano.process` | processar 1 panorama (foto fixa) | upload concluído |
| `capture.walkthrough` | processar 1 vídeo 360 | upload concluído (fase 2) |
| `capture.temporal` | alinhar captura N com N-1 | todos os panoramas da captura prontos |

## `pano.process` — payload

```json
{
  "job_id": "uuid",
  "panorama_id": "uuid",
  "capture_id": "uuid",
  "org_id": "uuid",
  "storage_key": "org/obra/captura/pano_0007.jpg",
  "options": {
    "nadir_patch": true,
    "blur_faces": true,
    "horizon_stabilize": true,
    "tile_format": "avif",
    "preview_width": 2048,
    "tile_size": 512,
    "max_level": 4
  }
}
```

## `pano.process` — resultado (publicado em `pano.process.result`)

```json
{
  "job_id": "uuid",
  "panorama_id": "uuid",
  "status": "done",
  "preview_key": ".../preview_2048.avif",
  "tiles_key": ".../tiles/",
  "width_px": 11968,
  "height_px": 5984,
  "nadir_patched": true,
  "faces_blurred": true,
  "faces_found": 2,
  "timings_ms": { "download": 900, "nadir": 400, "blur": 1200, "tiles": 6500 }
}
```

## `capture.walkthrough` — payload (fase 2)

```json
{
  "job_id": "uuid",
  "capture_id": "uuid",
  "org_id": "uuid",
  "video_key": "org/obra/captura/walk.mp4",
  "level": {
    "floorplan_key": "org/obra/planta_pav3.png",
    "px_per_meter": 42.5,
    "anchors": [
      { "video_t_s": 3.0,   "plan_x_m": 4.2,  "plan_y_m": 1.1 },
      { "video_t_s": 610.0, "plan_x_m": 28.7, "plan_y_m": 14.3 }
    ]
  },
  "imu_key": "org/obra/captura/walk.imu.jsonl",
  "options": { "keyframe_min_displacement_m": 2.0, "sfm_backend": "colmap" }
}
```

Progresso é reportado incrementalmente (o app mostra "processando 340 frames — 12 min
restantes"):

```json
{ "job_id": "uuid", "stage": "sfm", "progress_pct": 45, "eta_s": 720, "frames_done": 154, "frames_total": 340 }
```

## Regras de idempotência e falha

- Todo job é idempotente: chaves de saída derivam do hash do conteúdo de entrada; re-execução sobrescreve com bytes idênticos.
- 3 tentativas com backoff exponencial; na terceira falha, `captures.status = 'failed'` e evento para o autor.
- Fallback do SfM (fase 2): se o registro falhar num trecho, os keyframes daquele trecho recebem pose por interpolação IMU entre as âncoras vizinhas e `pose_source = 'imu'`, `pose_conf` baixa — a UI destaca pontos de baixa confiança para correção manual.
