-- ============================================================================
-- Obra360 — 0004: foto de capa da obra.
--
-- A lista de obras usava só a miniatura do modelo Matterport; obra sem modelo
-- ficava sem foto. A capa é um arquivo do acervo (o mesmo Storage das
-- evidências, chave `org/<id>/img/<sha256>.<ext>`) e aqui fica só a chave,
-- como em issue_evidences.image_key.
--
-- Quem troca a capa é quem registra o acervo: fiscalização e gestor
-- (WRITERS em apps/api/src/auth/roles.ts). A policy projects_write do
-- schema.sql só deixa owner/gestor alterar a obra; em vez de abri-la para a
-- linha inteira, a troca passa por esta função, que mexe só nesta coluna.
-- ============================================================================

alter table projects add column cover_key text;

create or replace function project_set_cover(p_project uuid, p_cover_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := project_org(p_project);
  papel member_role := auth_role_in(org);
begin
  -- obra de outra organização (ou inexistente) cai aqui também: papel é nulo
  if papel is null or papel not in ('owner', 'gestor', 'engenheiro', 'campo') then
    raise exception 'permission denied: a capa da obra é trocada pela fiscalização ou pelo gestor'
      using errcode = '42501';
  end if;
  if p_cover_key is not null and p_cover_key not like ('org/' || org || '/%') then
    raise exception 'a capa precisa ser um arquivo da organização da obra' using errcode = '22023';
  end if;
  update projects set cover_key = p_cover_key where id = p_project;
end $$;

revoke all on function project_set_cover(uuid, text) from public, anon;
grant execute on function project_set_cover(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
