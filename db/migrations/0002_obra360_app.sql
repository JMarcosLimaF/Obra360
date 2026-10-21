-- ============================================================================
-- Obra360 — 0002: o que o produto já usa e o schema.sql ainda não tinha.
--
-- Estende o modelo do schema.sql, não o substitui: as tabelas e policies de lá
-- continuam valendo. Obra, issue, evento e captura ganham as colunas do trâmite;
-- contratada, contrato, plantas, RDO e análises de IA ganham tabelas, todas com
-- RLS no mesmo padrão (project_org() / auth_role_in()).
--
-- Mapa de papéis (member_role → lado da mesa no trâmite, ver apps/api/src/auth):
--   engenheiro, campo → fiscalização · empreiteiro → construtora ·
--   gestor, owner → gestor do contrato · visitante → somente leitura
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Identidade é o Supabase Auth. A senha fica no GoTrue; aqui só o vínculo
-- da pessoa com a organização. O nome que aparece nas peças vem do
-- user_metadata, lido por user_label — security definer para o papel da
-- aplicação não precisar enxergar o schema auth.
-- ----------------------------------------------------------------------------

alter table org_members
  add constraint org_members_user_fk foreign key (user_id) references auth.users(id) on delete cascade;

create or replace function user_label(p_user uuid) returns text
language sql stable security definer set search_path = auth, public as $$
  select coalesce(
    nullif(raw_user_meta_data->>'name', ''),
    nullif(raw_user_meta_data->>'full_name', ''),
    email,
    ''
  )
  from auth.users
  where id = p_user
$$;

-- ----------------------------------------------------------------------------
-- Contratada e contrato — é o contrato que dá força às notificações e aos prazos
-- ----------------------------------------------------------------------------

create table contractors (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  razao_social        text not null,
  cnpj                text not null,
  responsavel_tecnico text,
  crea                text,
  email               text,
  preposto            text,
  -- o usuário do preposto: é a ele que a NC é endereçada ao ser notificada
  -- (issues.assignee_id), o que a policy issues_select do schema.sql exige
  preposto_user_id    uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index on contractors (org_id);

alter table projects
  add column matterport_id text,
  add column progress_pct  numeric not null default 0 check (progress_pct between 0 and 100),
  add column contractor_id uuid references contractors(id) on delete set null;

create table contracts (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null unique references projects(id) on delete cascade,
  numero              text not null,
  processo            text,
  orgao_contratante   text,
  vigencia_inicio     date,
  vigencia_fim        date,
  valor               numeric(14, 2),
  fiscal_designado    text,
  gestor_designado    text,
  portaria_designacao text,
  -- prazo de reparo por severidade, em dias corridos; o trâmite cai no padrão
  -- (crítica 2, alta 7, média 15, baixa 30) quando a chave falta
  prazos              jsonb not null default '{"critica": 2, "alta": 7, "media": 15, "baixa": 30}',
  created_at          timestamptz not null default now()
);

-- etapa construtiva registrada na captura (estrutura, alvenaria, instalacoes, acabamento)
alter table captures add column stage text;

-- ----------------------------------------------------------------------------
-- Panorama: o resultado do worker Python (pano.process) entra aqui
-- ----------------------------------------------------------------------------

alter table panoramas
  add column processing_status processing_status not null default 'uploading',
  add column job_id            uuid,
  add column processing_error  text,
  add column faces_found       int,
  add column timings_ms        jsonb,
  add column processed_at      timestamptz;
create index on panoramas (job_id);

-- ----------------------------------------------------------------------------
-- Não conformidade — o trâmite formal entre fiscalização e construtora
-- ----------------------------------------------------------------------------

create type nc_status as enum (
  'rascunho', 'notificada', 'ciente', 'em_reparo', 'reparo_submetido', 'contestada', 'sanada', 'cancelada'
);
create type nc_role as enum ('fiscalizacao', 'construtora', 'gestor');
create type nc_evidence_kind as enum ('abertura', 'reparo', 'verificacao');

alter table issues
  add column level_id        uuid references levels(id) on delete set null,
  add column code            text,
  add column nc_status       nc_status not null default 'rascunho',
  add column local           text not null default '',
  add column norma           text,
  -- prazo vigente; "vencida" não é estado, é deadline < hoje
  add column deadline        date,
  -- reprovar não é estado: é evento que devolve ao reparo e soma aqui
  add column reopen_count    int not null default 0,
  add column origin          text not null default 'manual' check (origin in ('viewer', 'planta', 'rdo', 'manual')),
  add column assignee_name   text not null default '',
  add column created_by_name text not null default '',
  -- âncora 3D no frame do modelo Matterport (não é o frame da planta)
  add column mp_point        geometry(PointZ),
  add column mp_polygon      jsonb,
  add column area_m2         numeric,
  -- vista do tour {sweep, rotation} para voltar ao mesmo ângulo
  add column pose            jsonb,
  add column floorplan_id    uuid,
  add column pin_id          uuid,
  add column rdo_id          uuid,
  add column contestation    jsonb,
  add column updated_at      timestamptz not null default now();
create unique index issues_code_uq on issues (project_id, code);
create index on issues (project_id, nc_status);

alter table issue_events
  add column nc_from    nc_status,
  add column nc_to      nc_status,
  add column actor_name text not null default '',
  add column actor_role nc_role,
  add column deadline   date,
  add column rdo_id     uuid,
  add column rdo_number int;

create table issue_evidences (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references issues(id) on delete cascade,
  -- o ato do trâmite em que a imagem entrou (notificar, submeter, anexar…)
  event_id    uuid references issue_events(id) on delete set null,
  kind        nc_evidence_kind not null,
  image_key   text not null,
  pose        jsonb,
  author_id   uuid not null,
  author_name text not null,
  author_role nc_role not null,
  note        text not null default '',
  -- quando a foto foi tirada (pode ser anterior ao anexo: foto do acervo da visita)
  taken_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index on issue_evidences (issue_id, created_at);

-- O estado da NC só muda pela função apply da API (apps/api/src/domain/nc-flow.ts),
-- que marca a própria transação com obra360.nc_apply = 'on'. Uma escrita dos
-- campos do trâmite sem essa marca é recusada aqui: a regra "nenhuma rota grava
-- status direto" vale até para o código que esquecer dela.
create or replace function guard_nc_tramite() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('obra360.nc_apply', true), '') <> 'on' and (
       tg_op = 'INSERT'
       or new.nc_status    is distinct from old.nc_status
       or new.deadline     is distinct from old.deadline
       or new.reopen_count is distinct from old.reopen_count
       or new.contestation is distinct from old.contestation
     ) then
    raise exception 'o estado da não conformidade só muda pela função apply do trâmite'
      using errcode = 'P0001', hint = 'nc_apply';
  end if;
  -- a leitura grosseira que as telas antigas usam acompanha o estado real
  new.status := case new.nc_status
    when 'rascunho' then 'aberto' when 'notificada' then 'aberto' when 'ciente' then 'aberto'
    when 'em_reparo' then 'em_execucao'
    when 'reparo_submetido' then 'aguardando_verificacao' when 'contestada' then 'aguardando_verificacao'
    else 'resolvido'
  end::issue_status;
  new.resolved_at := case when new.status = 'resolvido' then coalesce(new.resolved_at, now()) else null end;
  new.updated_at := now();
  return new;
end $$;

create trigger issues_guard_tramite before insert or update on issues
  for each row execute function guard_nc_tramite();

-- ----------------------------------------------------------------------------
-- Plantas baixas e pinos (coordenada relativa 0..1 no desenho)
-- ----------------------------------------------------------------------------

create table floorplans (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  level_id           uuid references levels(id) on delete set null,
  name               text not null,
  image_key          text not null,
  analysis           text,
  analysis_at        timestamptz,
  analysis_simulated boolean,
  created_by         uuid not null,
  created_at         timestamptz not null default now()
);
create index on floorplans (project_id);

create table floorplan_pins (
  id           uuid primary key default gen_random_uuid(),
  floorplan_id uuid not null references floorplans(id) on delete cascade,
  -- frame relativo do desenho (0..1): o pino sobrevive ao zoom e à troca de resolução
  pos          geometry(Point) not null,
  label        text not null,
  note         text not null default '',
  issue_id     uuid references issues(id) on delete set null,
  pose         jsonb,
  created_by   uuid not null,
  created_at   timestamptz not null default now()
);
create index on floorplan_pins (floorplan_id);

alter table issues
  add constraint issues_floorplan_fk foreign key (floorplan_id) references floorplans(id) on delete set null,
  add constraint issues_pin_fk foreign key (pin_id) references floorplan_pins(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Diário de obra (RDO), frentes de visita e fotos
-- ----------------------------------------------------------------------------

create table rdos (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  number            int  not null,
  date              date not null,
  responsible       text not null,
  weather           jsonb not null,
  workable          jsonb not null,
  crew              jsonb not null default '[]',
  equipment         jsonb not null default '[]',
  services_executed text not null default '',
  occurrences       text not null default '',
  non_conformities  text not null default '',
  notes             text not null default '',
  analysis_ids      uuid[] not null default '{}',
  issue_ids         uuid[] not null default '{}',
  ai_drafted        boolean not null default false,
  ai_simulated      boolean not null default false,
  status            text not null default 'rascunho' check (status in ('rascunho', 'fechado')),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz,
  unique (project_id, number)
);

create table rdo_stops (
  id           uuid primary key default gen_random_uuid(),
  rdo_id       uuid not null references rdos(id) on delete cascade,
  label        text not null,
  level_id     uuid references levels(id) on delete set null,
  pose         jsonb,
  observation  text not null default '',
  ai_status    text not null default 'pendente' check (ai_status in ('pendente', 'analisando', 'pronto', 'erro')),
  ai_simulated boolean,
  issue_ids    uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index on rdo_stops (rdo_id, created_at);

create table rdo_photos (
  id         uuid primary key default gen_random_uuid(),
  stop_id    uuid not null references rdo_stops(id) on delete cascade,
  image_key  text not null,
  caption    text not null default '',
  kind       text not null default 'panoramica'
             check (kind in ('panoramica', 'detalhe', 'nao_conformidade', 'encoberto', 'seguranca')),
  pose       jsonb,
  created_at timestamptz not null default now()
);
create index on rdo_photos (stop_id, created_at);

alter table issues
  add constraint issues_rdo_fk foreign key (rdo_id) references rdos(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Análises de IA — toda leitura do modelo fica registrada, com o modelo que a
-- fez e se foi simulada. A IA sugere; quem abre NC é gente (issues.created_by).
-- ----------------------------------------------------------------------------

create table ai_analyses (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind       text not null check (kind in ('vista', 'planta', 'triagem', 'frente', 'rdo')),
  question   text not null default '',
  result     text not null,
  image_key  text,
  camera_pos geometry(PointZ),
  -- planta, RDO ou frente lida, conforme o tipo
  ref_id     uuid,
  model      text,
  simulated  boolean not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index on ai_analyses (project_id, kind, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS das tabelas novas — mesmo padrão do schema.sql
-- ----------------------------------------------------------------------------

create or replace function rdo_org(p_rdo uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_org(project_id) from rdos where id = p_rdo
$$;

-- RDO fechado é documento: nem ele nem suas frentes e fotos mudam depois
create or replace function rdo_aberto(p_rdo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'rascunho' from rdos where id = p_rdo), false)
$$;

create or replace function stop_rdo(p_stop uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select rdo_id from rdo_stops where id = p_stop
$$;

create or replace function floorplan_org(p_plan uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_org(project_id) from floorplans where id = p_plan
$$;

alter table contractors     enable row level security;
alter table contracts       enable row level security;
alter table issue_evidences enable row level security;
alter table floorplans      enable row level security;
alter table floorplan_pins  enable row level security;
alter table rdos            enable row level security;
alter table rdo_stops       enable row level security;
alter table rdo_photos      enable row level security;
alter table ai_analyses     enable row level security;

create policy contractors_select on contractors for select
  using (org_id in (select auth_org_ids()));
create policy contractors_write on contractors for all
  using (auth_role_in(org_id) in ('owner', 'gestor'))
  with check (auth_role_in(org_id) in ('owner', 'gestor'));

create policy contracts_select on contracts for select
  using (project_org(project_id) in (select auth_org_ids()));
create policy contracts_write on contracts for all
  using (auth_role_in(project_org(project_id)) in ('owner', 'gestor'))
  with check (auth_role_in(project_org(project_id)) in ('owner', 'gestor'));

-- a construtora enxerga só a obra do próprio contrato (restrição somada às
-- policies do schema.sql, que liberam a obra a qualquer membro da organização)
create policy projects_empreiteiro_scope on projects as restrictive for select
  using (
    auth_role_in(org_id) is distinct from 'empreiteiro'
    or exists (select 1 from contractors c where c.id = contractor_id and c.preposto_user_id = auth.uid())
  );

-- evidência acompanha a NC: quem vê a peça vê a imagem (RLS de issues filtra)
create policy issue_evidences_select on issue_evidences for select
  using (exists (select 1 from issues i where i.id = issue_id));
create policy issue_evidences_insert on issue_evidences for insert
  with check (exists (select 1 from issues i where i.id = issue_id));

create policy floorplans_select on floorplans for select
  using (project_org(project_id) in (select auth_org_ids()));
create policy floorplans_write on floorplans for all
  using (auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'))
  with check (auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));

create policy pins_select on floorplan_pins for select
  using (floorplan_org(floorplan_id) in (select auth_org_ids()));
create policy pins_write on floorplan_pins for all
  using (auth_role_in(floorplan_org(floorplan_id)) in ('owner', 'gestor', 'engenheiro', 'campo'))
  with check (auth_role_in(floorplan_org(floorplan_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));

create policy rdos_select on rdos for select
  using (project_org(project_id) in (select auth_org_ids()));
create policy rdos_insert on rdos for insert
  with check (auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));
-- só rascunho se edita; o WITH CHECK aceita a linha nova já "fechado" (é o fechamento)
create policy rdos_update on rdos for update
  using (status = 'rascunho' and auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'))
  with check (auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));
create policy rdos_delete on rdos for delete
  using (status = 'rascunho' and auth_role_in(project_org(project_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));

create policy rdo_stops_select on rdo_stops for select
  using (rdo_org(rdo_id) in (select auth_org_ids()));
create policy rdo_stops_write on rdo_stops for all
  using (rdo_aberto(rdo_id) and auth_role_in(rdo_org(rdo_id)) in ('owner', 'gestor', 'engenheiro', 'campo'))
  with check (rdo_aberto(rdo_id) and auth_role_in(rdo_org(rdo_id)) in ('owner', 'gestor', 'engenheiro', 'campo'));

create policy rdo_photos_select on rdo_photos for select
  using (rdo_org(stop_rdo(stop_id)) in (select auth_org_ids()));
create policy rdo_photos_write on rdo_photos for all
  using (rdo_aberto(stop_rdo(stop_id)) and auth_role_in(rdo_org(stop_rdo(stop_id))) in ('owner', 'gestor', 'engenheiro', 'campo'))
  with check (rdo_aberto(stop_rdo(stop_id)) and auth_role_in(rdo_org(stop_rdo(stop_id))) in ('owner', 'gestor', 'engenheiro', 'campo'));

create policy ai_analyses_select on ai_analyses for select
  using (org_id in (select auth_org_ids()));
create policy ai_analyses_insert on ai_analyses for insert
  with check (auth_role_in(org_id) in ('owner', 'gestor', 'engenheiro', 'campo'));

-- ----------------------------------------------------------------------------
-- Papel de aplicação: o que as requisições assumem para o RLS valer.
-- Sem BYPASSRLS. A senha fica no Supabase Auth, não neste schema.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'obra360_app') then
    create role obra360_app nologin;
  end if;
end $$;

grant obra360_app to current_user;
grant usage on schema public, auth to obra360_app;
grant execute on function auth.uid() to obra360_app;
grant execute on function user_label(uuid) to obra360_app;
grant select, insert, update, delete on all tables in schema public to obra360_app;
grant usage, select on all sequences in schema public to obra360_app;
revoke all on obra360_migrations from obra360_app;
