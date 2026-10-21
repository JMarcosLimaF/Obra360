-- ============================================================================
-- Obra360 — 0003: a API fala com o Supabase pela Data API (chave + JWT).
--
-- O papel `authenticated` passa a ler e escrever sob as policies que já
-- existem. As funções abaixo juntam, numa transação só, a marca do trâmite
-- (`obra360.nc_apply`) e a escrita: o PostgREST não segura transação entre
-- chamadas, e o gatilho recusa mudança de estado sem essa marca.
-- ============================================================================

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on table obra360_migrations from anon, authenticated, service_role;

grant execute on function user_label(uuid) to authenticated, service_role;

create or replace view issues_api with (security_invoker = true) as
select i.*,
       st_x(i.mp_point) as mp_x,
       st_y(i.mp_point) as mp_y,
       st_z(i.mp_point) as mp_z
  from issues i;

create or replace view captures_api with (security_invoker = true) as
select c.*, user_label(c.author_id) as author_name
  from captures c;

grant select on issues_api, captures_api to authenticated, service_role;

-- Abertura da NC. O número sai aqui, com trava, para duas aberturas
-- simultâneas não receberem o mesmo código.
create or replace function nc_insert_issue(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
  event_id uuid;
  code text;
  prefix text;
  n int;
  pin uuid := nullif(p->>'pin_id', '')::uuid;
begin
  perform set_config('obra360.nc_apply', 'on', true);
  perform pg_advisory_xact_lock(hashtext('nc-code:' || (p->>'project_id')));
  prefix := 'NC-' || left(p->>'created_at', 4) || '-';
  select max(substring(issues.code from length(prefix) + 1)::int) into n
    from issues
   where project_id = (p->>'project_id')::uuid
     and issues.code like prefix || '%'
     and substring(issues.code from length(prefix) + 1) ~ '^[0-9]+$';
  code := prefix || lpad((coalesce(n, 0) + 1)::text, 3, '0');

  insert into issues (
    org_id, project_id, title, description, discipline, severity, nc_status, created_by,
    created_by_name, due_date, code, local, norma, level_id, origin, floorplan_id, pin_id,
    rdo_id, pose, mp_point, mp_polygon, area_m2, assignee_name, plan_pos, kind
  ) values (
    (p->>'org_id')::uuid,
    (p->>'project_id')::uuid,
    p->>'title',
    nullif(p->>'description', ''),
    p->>'discipline',
    (p->>'severity')::issue_severity,
    (p->>'nc_status')::nc_status,
    (p->>'created_by')::uuid,
    p->>'created_by_name',
    nullif(p->>'due_date', '')::date,
    code,
    p->>'local',
    nullif(p->>'norma', ''),
    nullif(p->>'level_id', '')::uuid,
    coalesce(nullif(p->>'origin', ''), 'manual'),
    nullif(p->>'floorplan_id', '')::uuid,
    pin,
    nullif(p->>'rdo_id', '')::uuid,
    case when p->'pose' is null or p->'pose' = 'null'::jsonb then null else p->'pose' end,
    case
      when p->'mp' is null or p->'mp' = 'null'::jsonb then null
      else st_makepoint((p->'mp'->>'x')::float8, (p->'mp'->>'y')::float8, (p->'mp'->>'z')::float8)
    end,
    case when p->'mp_polygon' is null or p->'mp_polygon' = 'null'::jsonb then null else p->'mp_polygon' end,
    nullif(p->>'area_m2', '')::numeric,
    coalesce(p->>'assignee_name', ''),
    (select pos from floorplan_pins where id = pin),
    'pendencia'
  ) returning id into new_id;

  insert into issue_events (
    issue_id, author_id, event_type, body, old_status, new_status, nc_from, nc_to,
    actor_name, actor_role, deadline, rdo_id, rdo_number, created_at
  ) values (
    new_id,
    (p->>'created_by')::uuid,
    p->'event'->>'action',
    nullif(p->'event'->>'note', ''),
    null,
    (p->'event'->>'coarse')::issue_status,
    nullif(p->'event'->>'from', '')::nc_status,
    (p->'event'->>'to')::nc_status,
    p->'event'->>'actor',
    (p->'event'->>'role')::nc_role,
    nullif(p->'event'->>'deadline', '')::date,
    nullif(p->'event'->>'rdo_id', '')::uuid,
    nullif(p->'event'->>'rdo_number', '')::int,
    (p->'event'->>'at')::timestamptz
  ) returning id into event_id;

  if p->'evidence' is not null and p->'evidence' <> 'null'::jsonb then
    insert into issue_evidences (
      issue_id, event_id, kind, image_key, pose, author_id, author_name, author_role, note, taken_at
    ) values (
      new_id,
      event_id,
      (p->'evidence'->>'kind')::nc_evidence_kind,
      p->'evidence'->>'image_key',
      case when p->'evidence'->'pose' is null or p->'evidence'->'pose' = 'null'::jsonb then null else p->'evidence'->'pose' end,
      (p->>'created_by')::uuid,
      p->'event'->>'actor',
      (p->'event'->>'role')::nc_role,
      coalesce(p->'evidence'->>'note', ''),
      nullif(p->'evidence'->>'taken_at', '')::timestamptz
    );
  end if;

  if pin is not null then
    update floorplan_pins set issue_id = new_id where id = pin;
  end if;

  perform set_config('obra360.nc_apply', 'off', true);
  return new_id;
end $$;

-- Ato do trâmite. Só grava se o estado ainda for o que a API leu: dois cliques
-- simultâneos não aplicam dois atos sobre o mesmo estado.
create or replace function nc_save_tramite(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
  event_id uuid;
begin
  perform set_config('obra360.nc_apply', 'on', true);
  update issues set
    nc_status = (p->>'nc_status')::nc_status,
    deadline = nullif(p->>'deadline', '')::date,
    reopen_count = (p->>'reopen_count')::int,
    contestation = case when p->'contestation' is null or p->'contestation' = 'null'::jsonb then null else p->'contestation' end,
    assignee_id = coalesce(nullif(p->>'assignee_id', '')::uuid, assignee_id)
  where id = (p->>'issue_id')::uuid
    and nc_status = (p->>'expected')::nc_status;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'a peça mudou enquanto o ato era registrado' using errcode = 'P0001';
  end if;

  insert into issue_events (
    issue_id, author_id, event_type, body, old_status, new_status, nc_from, nc_to,
    actor_name, actor_role, deadline, rdo_id, rdo_number, created_at
  ) values (
    (p->>'issue_id')::uuid,
    (p->>'author_id')::uuid,
    p->'event'->>'action',
    nullif(p->'event'->>'note', ''),
    nullif(p->'event'->>'from_coarse', '')::issue_status,
    (p->'event'->>'coarse')::issue_status,
    nullif(p->'event'->>'from', '')::nc_status,
    (p->'event'->>'to')::nc_status,
    p->'event'->>'actor',
    (p->'event'->>'role')::nc_role,
    nullif(p->'event'->>'deadline', '')::date,
    nullif(p->'event'->>'rdo_id', '')::uuid,
    nullif(p->'event'->>'rdo_number', '')::int,
    (p->'event'->>'at')::timestamptz
  ) returning id into event_id;

  if p->'evidence' is not null and p->'evidence' <> 'null'::jsonb then
    insert into issue_evidences (
      issue_id, event_id, kind, image_key, pose, author_id, author_name, author_role, note, taken_at
    ) values (
      (p->>'issue_id')::uuid,
      event_id,
      (p->'evidence'->>'kind')::nc_evidence_kind,
      p->'evidence'->>'image_key',
      case when p->'evidence'->'pose' is null or p->'evidence'->'pose' = 'null'::jsonb then null else p->'evidence'->'pose' end,
      (p->>'author_id')::uuid,
      p->'event'->>'actor',
      (p->'event'->>'role')::nc_role,
      coalesce(p->'evidence'->>'note', ''),
      nullif(p->'evidence'->>'taken_at', '')::timestamptz
    );
  end if;

  perform set_config('obra360.nc_apply', 'off', true);
  return event_id;
end $$;

create or replace function refresh_capture(p_panorama uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update captures c set
    status = s.status::processing_status,
    progress_pct = s.pct
  from (
    select p.capture_id,
           case when bool_or(p.processing_status = 'failed') then 'failed'
                when bool_and(p.processing_status = 'done') then 'done'
                else 'processing' end as status,
           round(100.0 * count(*) filter (where p.processing_status = 'done') / count(*))::int as pct
      from panoramas p
     where p.capture_id = (select capture_id from panoramas where id = p_panorama)
     group by p.capture_id
  ) s
  where c.id = s.capture_id;
end $$;

revoke all on function nc_insert_issue(jsonb) from public, anon;
revoke all on function nc_save_tramite(jsonb) from public, anon;
revoke all on function refresh_capture(uuid) from public, anon;
grant execute on function nc_insert_issue(jsonb) to authenticated, service_role;
grant execute on function nc_save_tramite(jsonb) to authenticated, service_role;
grant execute on function refresh_capture(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
