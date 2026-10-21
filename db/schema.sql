-- ============================================================================
-- Obra360 — DDL completo (PostgreSQL 15+ / Supabase)
-- Multi-tenant por organização, PostGIS para geometria, RLS em todas as tabelas.
-- Convenção: auth.uid() vem do Supabase Auth (JWT).
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- Tenancy e papéis
-- ----------------------------------------------------------------------------

create type member_role as enum ('owner', 'gestor', 'engenheiro', 'campo', 'empreiteiro', 'visitante');

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  -- LGPD: borrar rostos automaticamente no processamento
  blur_faces  boolean not null default true,
  created_at  timestamptz not null default now()
);

create table org_members (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null, -- auth.users(id)
  role        member_role not null default 'visitante',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Helper: organizações do usuário autenticado (usada em todas as policies)
create or replace function auth_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;

create or replace function auth_role_in(p_org uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from org_members where org_id = p_org and user_id = auth.uid()
$$;

-- ----------------------------------------------------------------------------
-- Obra → pavimento → captura → panorama
-- ----------------------------------------------------------------------------

create table projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  client_name text,
  address     text,
  location    geometry(Point, 4326),          -- lat/lng da obra
  starts_at   date,
  ends_at     date,
  status      text not null default 'ativa',  -- ativa | pausada | concluida
  created_at  timestamptz not null default now()
);
create index on projects (org_id);
create index projects_location_gix on projects using gist (location);

create table levels (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null,                 -- "Pavimento 3", "Subsolo", "Fachada"
  sort_order    int  not null default 0,
  floorplan_key text,                          -- storage key do PDF/PNG da planta
  -- extent da planta em coordenadas locais (metros); pins/panoramas usam esse frame
  extent        geometry(Polygon),             -- SRID 0 = frame local da planta
  px_per_meter  numeric,                       -- calibração raster → metros
  created_at    timestamptz not null default now()
);
create index on levels (project_id);

create type processing_status as enum ('uploading', 'queued', 'processing', 'done', 'failed');

create table captures (
  id            uuid primary key default gen_random_uuid(),
  level_id      uuid not null references levels(id) on delete cascade,
  captured_at   timestamptz not null,
  author_id     uuid not null,                 -- auth.users(id)
  mode          text not null default 'fixed', -- fixed | walkthrough
  status        processing_status not null default 'uploading',
  progress_pct  int not null default 0,        -- progresso do processamento (UI)
  notes         text,
  created_at    timestamptz not null default now()
);
create index on captures (level_id, captured_at desc);

create table panoramas (
  id             uuid primary key default gen_random_uuid(),
  capture_id     uuid not null references captures(id) on delete cascade,
  waypoint_code  text,                          -- "P07" (fase 1: ponto fixo)
  storage_key    text not null,                 -- original equiretangular
  tiles_key      text,                          -- prefixo dos tiles piramidais
  preview_key    text,                          -- 2048x1024 AVIF (primeiro frame)
  position       geometry(Point) not null,      -- x,y no frame local da planta (metros)
  heading_deg    numeric not null default 0,    -- azimute do centro da imagem
  width_px       int,
  height_px      int,
  nadir_patched  boolean not null default false,
  faces_blurred  boolean not null default false,
  pose_source    text not null default 'manual',-- manual | imu | sfm
  pose_conf      numeric,                       -- confiança do posicionamento 0..1
  embedding      vector(512),                   -- busca visual (pgvector; opcional no MVP)
  created_at     timestamptz not null default now()
);
create index on panoramas (capture_id);
create index panoramas_pos_gix on panoramas using gist (position);

-- Grafo de navegação dentro de uma captura (vizinhança de waypoints)
create table waypoint_links (
  panorama_a uuid not null references panoramas(id) on delete cascade,
  panorama_b uuid not null references panoramas(id) on delete cascade,
  distance_m numeric,
  primary key (panorama_a, panorama_b),
  check (panorama_a <> panorama_b)
);

-- Mesmo ponto físico em capturas diferentes (viagem no tempo)
create table temporal_links (
  panorama_current  uuid not null references panoramas(id) on delete cascade,
  panorama_previous uuid not null references panoramas(id) on delete cascade,
  method            text not null default 'waypoint', -- waypoint | sfm_registration | proximity
  confidence        numeric,
  primary key (panorama_current, panorama_previous)
);

-- ----------------------------------------------------------------------------
-- Pendências (issues) e inspeções
-- ----------------------------------------------------------------------------

create type issue_status as enum ('aberto', 'em_execucao', 'aguardando_verificacao', 'resolvido');
create type issue_severity as enum ('baixa', 'media', 'alta', 'critica');

create table issues (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  panorama_id  uuid references panoramas(id) on delete set null,
  -- âncora esférica no panorama + posição na planta (redundante de propósito:
  -- o pin sobrevive mesmo se o panorama for arquivado)
  yaw_deg      numeric,
  pitch_deg    numeric,
  plan_pos     geometry(Point),
  title        text not null,
  description  text,
  discipline   text,                            -- alvenaria, elétrica, hidráulica...
  kind         text not null default 'pendencia', -- pendencia | observacao | inspecao
  severity     issue_severity not null default 'media',
  status       issue_status not null default 'aberto',
  assignee_id  uuid,
  due_date     date,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index on issues (project_id, status);
create index on issues (assignee_id) where status <> 'resolvido';

create table issue_events (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references issues(id) on delete cascade,
  author_id   uuid not null,
  event_type  text not null,        -- comentario | mudanca_status | atribuicao | anexo
  body        text,
  attachment_key text,              -- foto de evidência (antes/depois)
  old_status  issue_status,
  new_status  issue_status,
  created_at  timestamptz not null default now()
);
create index on issue_events (issue_id, created_at);

create table inspections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  level_id    uuid references levels(id) on delete set null,
  capture_id  uuid references captures(id) on delete set null,
  name        text not null,
  discipline  text,
  status      text not null default 'em_andamento',
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table checklist_items (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  label         text not null,
  sort_order    int not null default 0,
  result        text,               -- conforme | nao_conforme | na
  issue_id      uuid references issues(id) on delete set null,
  checked_by    uuid,
  checked_at    timestamptz
);

-- ----------------------------------------------------------------------------
-- Avanço físico (EAP / curva S)
-- ----------------------------------------------------------------------------

create table wbs_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  parent_id   uuid references wbs_items(id) on delete cascade,
  code        text not null,        -- "03.02.01"
  name        text not null,        -- "Alvenaria pav. tipo"
  weight      numeric not null default 1,
  planned_start date,
  planned_end   date,
  unique (project_id, code)
);

create table progress_entries (
  id          uuid primary key default gen_random_uuid(),
  wbs_item_id uuid not null references wbs_items(id) on delete cascade,
  level_id    uuid references levels(id) on delete set null,
  capture_id  uuid references captures(id) on delete set null, -- lastro visual
  pct         numeric not null check (pct >= 0 and pct <= 100),
  measured_at date not null,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);
create index on progress_entries (wbs_item_id, measured_at);

-- ----------------------------------------------------------------------------
-- Relatórios, links públicos, auditoria
-- ----------------------------------------------------------------------------

create table reports (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null default 'visita',  -- visita | rdo | servico_encoberto
  period_from date,
  period_to   date,
  payload     jsonb not null default '{}',     -- seleção de panoramas/pins
  pdf_key     text,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table public_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  scope       text not null default 'viewer',  -- viewer | report
  expires_at  timestamptz,
  watermark   boolean not null default true,
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  user_id     uuid,
  action      text not null,       -- capture.create, issue.update, panorama.delete...
  entity      text not null,
  entity_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS — isolamento por tenant
-- ----------------------------------------------------------------------------

alter table organizations   enable row level security;
alter table org_members     enable row level security;
alter table projects        enable row level security;
alter table levels          enable row level security;
alter table captures        enable row level security;
alter table panoramas       enable row level security;
alter table waypoint_links  enable row level security;
alter table temporal_links  enable row level security;
alter table issues          enable row level security;
alter table issue_events    enable row level security;
alter table inspections     enable row level security;
alter table checklist_items enable row level security;
alter table wbs_items       enable row level security;
alter table progress_entries enable row level security;
alter table reports         enable row level security;
alter table public_links    enable row level security;
alter table audit_log       enable row level security;

-- Organizações: membro vê a própria
create policy org_select on organizations for select
  using (id in (select auth_org_ids()));

create policy org_members_select on org_members for select
  using (org_id in (select auth_org_ids()));
create policy org_members_admin on org_members for all
  using (auth_role_in(org_id) in ('owner', 'gestor'))
  with check (auth_role_in(org_id) in ('owner', 'gestor'));

-- Projetos: leitura para membros; escrita para owner/gestor
create policy projects_select on projects for select
  using (org_id in (select auth_org_ids()));
create policy projects_write on projects for all
  using (auth_role_in(org_id) in ('owner', 'gestor'))
  with check (auth_role_in(org_id) in ('owner', 'gestor'));

-- Cascatas via project → org
create or replace function project_org(p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from projects where id = p_project
$$;

create policy levels_select on levels for select
  using (project_org(project_id) in (select auth_org_ids()));
create policy levels_write on levels for all
  using (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro'))
  with check (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro'));

create or replace function level_org(p_level uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_org(project_id) from levels where id = p_level
$$;

-- Capturas: campo pode criar; NINGUÉM edita/deleta depois de 'done' (imutabilidade)
create policy captures_select on captures for select
  using (level_org(level_id) in (select auth_org_ids()));
create policy captures_insert on captures for insert
  with check (auth_role_in(level_org(level_id)) in ('owner','gestor','engenheiro','campo'));
create policy captures_update on captures for update
  using (status <> 'done'
         and auth_role_in(level_org(level_id)) in ('owner','gestor','engenheiro','campo'));
create policy captures_delete on captures for delete
  using (status <> 'done' and auth_role_in(level_org(level_id)) = 'owner');

create or replace function capture_org(p_capture uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select level_org(level_id) from captures where id = p_capture
$$;

create policy panoramas_select on panoramas for select
  using (capture_org(capture_id) in (select auth_org_ids()));
create policy panoramas_insert on panoramas for insert
  with check (auth_role_in(capture_org(capture_id)) in ('owner','gestor','engenheiro','campo'));
-- Panoramas de captura concluída são imutáveis (valor jurídico)
create policy panoramas_update on panoramas for update
  using (exists (select 1 from captures c where c.id = capture_id and c.status <> 'done')
         and auth_role_in(capture_org(capture_id)) in ('owner','gestor','engenheiro'));

create policy wlinks_select on waypoint_links for select
  using (capture_org((select capture_id from panoramas where id = panorama_a)) in (select auth_org_ids()));
create policy tlinks_select on temporal_links for select
  using (capture_org((select capture_id from panoramas where id = panorama_current)) in (select auth_org_ids()));

-- Issues: empreiteiro vê apenas as atribuídas a ele
create policy issues_select on issues for select
  using (
    org_id in (select auth_org_ids())
    and (auth_role_in(org_id) <> 'empreiteiro' or assignee_id = auth.uid())
  );
create policy issues_insert on issues for insert
  with check (auth_role_in(org_id) in ('owner','gestor','engenheiro','campo'));
create policy issues_update on issues for update
  using (
    auth_role_in(org_id) in ('owner','gestor','engenheiro')
    or (auth_role_in(org_id) = 'empreiteiro' and assignee_id = auth.uid())
  );

create policy issue_events_select on issue_events for select
  using (exists (select 1 from issues i where i.id = issue_id)); -- RLS de issues filtra
create policy issue_events_insert on issue_events for insert
  with check (exists (select 1 from issues i where i.id = issue_id));

create policy inspections_all on inspections for all
  using (project_org(project_id) in (select auth_org_ids()))
  with check (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro','campo'));
create policy checklist_all on checklist_items for all
  using (exists (select 1 from inspections i where i.id = inspection_id));

create policy wbs_select on wbs_items for select
  using (project_org(project_id) in (select auth_org_ids()));
create policy wbs_write on wbs_items for all
  using (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro'))
  with check (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro'));

create policy progress_select on progress_entries for select
  using (exists (select 1 from wbs_items w where w.id = wbs_item_id));
create policy progress_insert on progress_entries for insert
  with check (exists (select 1 from wbs_items w where w.id = wbs_item_id
              and auth_role_in(project_org(w.project_id)) in ('owner','gestor','engenheiro')));

create policy reports_all on reports for all
  using (project_org(project_id) in (select auth_org_ids()))
  with check (auth_role_in(project_org(project_id)) in ('owner','gestor','engenheiro'));

create policy public_links_all on public_links for all
  using (auth_role_in(project_org(project_id)) in ('owner','gestor'))
  with check (auth_role_in(project_org(project_id)) in ('owner','gestor'));

-- Auditoria: append-only, leitura só para owner/gestor
create policy audit_select on audit_log for select
  using (auth_role_in(org_id) in ('owner','gestor'));
create policy audit_insert on audit_log for insert
  with check (org_id in (select auth_org_ids()));

-- ----------------------------------------------------------------------------
-- Trigger de auditoria para issues (exemplo do padrão; replicar para captures)
-- ----------------------------------------------------------------------------

create or replace function log_issue_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (org_id, user_id, action, entity, entity_id, detail)
  values (
    coalesce(new.org_id, old.org_id), auth.uid(),
    tg_op || '.issue', 'issues', coalesce(new.id, old.id),
    jsonb_build_object('old_status', old.status, 'new_status', new.status)
  );
  return coalesce(new, old);
end $$;

create trigger issues_audit after insert or update or delete on issues
  for each row execute function log_issue_change();
