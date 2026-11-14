-- QuOLab Nexus database hardening: pin SECURITY DEFINER functions to an empty search_path.
-- All application objects are schema-qualified to prevent object-shadowing attacks.
create or replace function public.repo_is_founder(p_key text)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (select 1 from public.repo_admin where key_hash = public.repo_hash(p_key))
$function$;

create or replace function public.repo_can_edit(p_id uuid, p_key text)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select public.repo_is_founder(p_key)
      or exists (select 1 from public.repo_item_keys
                 where item_id = p_id and key_hash = public.repo_hash(p_key))
$function$;

create or replace function public.repo_create(
  p_kind text, p_title text, p_edit_key text,
  p_description text default '', p_tags text default '',
  p_cell_count integer default 0, p_est_minutes integer default 10,
  p_author text default '', p_content jsonb default null,
  p_file_url text default '', p_slug text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare new_id uuid;
begin
  if p_kind not in ('nb','pdf','video') then raise exception 'invalid kind'; end if;
  if coalesce(pg_catalog.btrim(p_title), '') = '' then raise exception 'title required'; end if;
  if pg_catalog.length(p_title) > 200
     or pg_catalog.length(coalesce(p_description,'')) > 2000
     or pg_catalog.length(coalesce(p_tags,'')) > 300
     or pg_catalog.length(coalesce(p_author,'')) > 120 then raise exception 'field too long'; end if;
  if pg_catalog.length(coalesce(p_edit_key, '')) < 16 then raise exception 'forbidden'; end if;
  if coalesce(p_file_url,'') <> '' and p_file_url !~* '^https?://' then raise exception 'invalid url'; end if;
  if p_slug is not null and p_slug !~ '^[a-z0-9_-]{1,80}$' then raise exception 'invalid slug'; end if;
  if p_kind = 'nb' then
    if p_content is null or pg_catalog.jsonb_typeof(p_content) <> 'array'
       or pg_catalog.jsonb_array_length(p_content) = 0 then raise exception 'notebook content required'; end if;
    if pg_catalog.length(p_content::text) > 2000000 then raise exception 'content too large'; end if;
  else
    if not public.repo_is_founder(p_edit_key) then raise exception 'forbidden'; end if;
  end if;
  insert into public.repo_items
    (kind, slug, title, description, tags, cell_count, est_minutes, author_name, content, file_url)
  values
    (p_kind, p_slug, pg_catalog.btrim(p_title), coalesce(p_description,''), coalesce(p_tags,''),
     greatest(coalesce(p_cell_count,0),0), greatest(coalesce(p_est_minutes,10),1),
     coalesce(p_author,''), case when p_kind = 'nb' then p_content else null end, coalesce(p_file_url,''))
  returning id into new_id;
  insert into public.repo_item_keys (item_id, key_hash) values (new_id, public.repo_hash(p_edit_key));
  return new_id;
end
$function$;

create or replace function public.repo_update(
  p_id uuid, p_key text, p_title text default null, p_description text default null,
  p_tags text default null, p_cell_count integer default null, p_est_minutes integer default null,
  p_content jsonb default null, p_file_url text default null
)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists (select 1 from public.repo_items where id = p_id) then raise exception 'not_found'; end if;
  if not public.repo_can_edit(p_id, p_key) then raise exception 'forbidden'; end if;
  if pg_catalog.length(coalesce(p_title,'')) > 200
     or pg_catalog.length(coalesce(p_description,'')) > 2000
     or pg_catalog.length(coalesce(p_tags,'')) > 300 then raise exception 'field too long'; end if;
  if coalesce(p_file_url,'') <> '' and p_file_url !~* '^https?://' then raise exception 'invalid url'; end if;
  if p_content is not null then
    if pg_catalog.jsonb_typeof(p_content) <> 'array'
       or pg_catalog.jsonb_array_length(p_content) = 0 then raise exception 'notebook content required'; end if;
    if pg_catalog.length(p_content::text) > 2000000 then raise exception 'content too large'; end if;
  end if;
  update public.repo_items set
    title = coalesce(nullif(pg_catalog.btrim(p_title), ''), title),
    description = coalesce(p_description, description), tags = coalesce(p_tags, tags),
    cell_count = coalesce(p_cell_count, cell_count), est_minutes = coalesce(p_est_minutes, est_minutes),
    content = case when kind = 'nb' then coalesce(p_content, content) else content end,
    file_url = coalesce(p_file_url, file_url),
    version = case when p_content is not null then version + 1 else version end,
    updated_at = now()
  where id = p_id;
end
$function$;

create or replace function public.repo_delete(p_id uuid, p_key text)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists (select 1 from public.repo_items where id = p_id) then raise exception 'not_found'; end if;
  if not public.repo_can_edit(p_id, p_key) then raise exception 'forbidden'; end if;
  delete from public.repo_items where id = p_id;
end
$function$;

create index if not exists repo_items_created_at_desc_idx on public.repo_items (created_at desc);
create index if not exists quantum_pending_apps_created_at_desc_idx on public.quantum_pending_apps (created_at desc);
create index if not exists quantum_app_versions_app_version_idx on public.quantum_app_versions (app_id, version desc);
