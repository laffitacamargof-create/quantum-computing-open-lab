-- QuOLab Nexus: secure public Supabase API.
-- Secrets are moved out of the exposed public schema. Public clients can read
-- only safe config and published apps; all app moderation uses founder-key RPCs.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.quolab_nexus_secret_archive (
  key text primary key,
  value text,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'Removed from exposed public configuration'
);
revoke all on table private.quolab_nexus_secret_archive from public, anon, authenticated;

insert into private.quolab_nexus_secret_archive (key, value)
select key, value
from public.quantum_ecosystem_config
where key in ('ai_config','deepseek_config','github_config','founder_password')
on conflict (key) do update
set value = excluded.value, archived_at = now();

delete from public.quantum_ecosystem_config
where key in ('ai_config','deepseek_config','github_config','founder_password');

drop policy if exists "Allow all" on public.quantum_ecosystem_config;
revoke all on table public.quantum_ecosystem_config from public, anon, authenticated;
grant select on table public.quantum_ecosystem_config to anon, authenticated;
create policy "public_read_non_secret_nexus_config"
on public.quantum_ecosystem_config for select
to anon, authenticated
using (key in ('colab_url','system_config','platform_config','monitor_config'));

drop policy if exists "Allow all" on public.quantum_pending_apps;
revoke all on table public.quantum_pending_apps from public, anon, authenticated;

drop policy if exists "Allow all" on public.quantum_published_apps;
revoke all on table public.quantum_published_apps from public, anon, authenticated;
grant select on table public.quantum_published_apps to anon, authenticated;
create policy "public_read_active_nexus_apps"
on public.quantum_published_apps for select
to anon, authenticated
using (is_active is true);

drop policy if exists "Allow all versions" on public.quantum_app_versions;
revoke all on table public.quantum_app_versions from public, anon, authenticated;
grant select on table public.quantum_app_versions to anon, authenticated;
create policy "public_read_nexus_app_versions"
on public.quantum_app_versions for select
to anon, authenticated
using (true);

revoke all on table public.repo_items from public, anon, authenticated;
grant select on table public.repo_items to anon, authenticated;
revoke all on table public.repo_item_keys from public, anon, authenticated;
revoke all on table public.repo_admin from public, anon, authenticated;

create or replace function public.repo_hash(k text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(coalesce(k, ''), 'UTF8')),
    'hex'
  )
$function$;

create or replace function public.quantum_submit_app(p_app jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id text := pg_catalog.gen_random_uuid()::text;
  v_name text;
  v_title text;
  v_description text;
  v_tags text;
  v_duration integer;
  v_python text;
  v_html text;
  v_server_url text;
begin
  if pg_catalog.jsonb_typeof(p_app) <> 'object' then
    raise exception 'invalid app payload';
  end if;
  v_name := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'name'), ''), nullif(pg_catalog.btrim(p_app->>'title'), ''), 'Untitled'), 100);
  v_title := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'title'), ''), v_name), 100);
  v_description := pg_catalog.left(coalesce(p_app->>'description', ''), 500);
  v_tags := pg_catalog.left(coalesce(p_app->>'tags', ''), 300);
  v_duration := greatest(1, least(240, coalesce(nullif(p_app->>'duration','')::integer, 8)));
  v_python := coalesce(p_app->>'python_code', p_app->>'pythonCode', '');
  v_html := coalesce(p_app->>'html_code', p_app->>'htmlCode', '');
  v_server_url := coalesce(p_app->>'server_url', p_app->>'serverUrl', '');
  if pg_catalog.length(v_python) > 1000000 or pg_catalog.length(v_html) > 1000000 then
    raise exception 'app code too large';
  end if;
  if v_server_url <> '' and v_server_url !~* '^https?://' then
    raise exception 'invalid server url';
  end if;
  insert into public.quantum_pending_apps
    (id, name, title, description, tags, duration, python_code, html_code,
     server_url, created_by, created_at, updated_at, status, submitted_by, submitted_at)
  values
    (v_id, v_name, v_title, v_description, v_tags, v_duration, v_python, v_html,
     v_server_url, pg_catalog.left(coalesce(p_app->>'created_by','anonymous'),120),
     now(), now(), 'pending',
     pg_catalog.left(coalesce(p_app->>'submitted_by', p_app->>'created_by', 'anonymous'),120), now());
  return v_id;
end
$function$;

create or replace function public.quantum_list_pending(p_key text)
returns setof public.quantum_pending_apps
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  return query select * from public.quantum_pending_apps order by created_at desc;
end
$function$;

create or replace function public.quantum_approve_app(p_id text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pending public.quantum_pending_apps%rowtype;
  v_published public.quantum_published_apps%rowtype;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  select * into v_pending from public.quantum_pending_apps where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  insert into public.quantum_published_apps
    (id, name, title, description, tags, duration, python_code, html_code,
     server_url, created_by, created_at, updated_at, published_by,
     published_at, version, is_active)
  values
    (v_pending.id, v_pending.name, v_pending.title, v_pending.description,
     v_pending.tags, v_pending.duration, v_pending.python_code, v_pending.html_code,
     v_pending.server_url, v_pending.created_by, v_pending.created_at, now(),
     'founder', now(), 1, true)
  on conflict (id) do update set
    name = excluded.name, title = excluded.title, description = excluded.description,
    tags = excluded.tags, duration = excluded.duration, python_code = excluded.python_code,
    html_code = excluded.html_code, server_url = excluded.server_url, updated_at = now(),
    published_by = 'founder', published_at = now(),
    version = public.quantum_published_apps.version + 1, is_active = true
  returning * into v_published;
  delete from public.quantum_pending_apps where id = p_id;
  return pg_catalog.to_jsonb(v_published);
end
$function$;

create or replace function public.quantum_reject_app(p_id text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  delete from public.quantum_pending_apps where id = p_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end
$function$;

create or replace function public.quantum_delete_published_app(p_id text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_count integer;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  delete from public.quantum_published_apps where id = p_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end
$function$;

create or replace function public.quantum_config_save(p_key text, p_value text, p_founder_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.repo_is_founder(p_founder_key) then raise exception 'forbidden'; end if;
  if p_key not in ('colab_url','system_config','platform_config','monitor_config') then
    raise exception 'configuration key is not cloud-shareable';
  end if;
  insert into public.quantum_ecosystem_config (id, key, value, updated_by, updated_at, created_at)
  values ('cfg-' || p_key, p_key, p_value, 'founder_panel', now(), now())
  on conflict (key) do update
    set value = excluded.value, updated_by = 'founder_panel', updated_at = now();
  return true;
end
$function$;

revoke execute on function public.repo_hash(text) from public, anon, authenticated;
revoke execute on function public.repo_can_edit(uuid,text) from public, anon, authenticated;
revoke execute on function public.repo_create(text,text,text,text,text,integer,integer,text,jsonb,text,text) from public, anon, authenticated;
revoke execute on function public.repo_delete(uuid,text) from public, anon, authenticated;
revoke execute on function public.repo_is_founder(text) from public, anon, authenticated;
revoke execute on function public.repo_update(uuid,text,text,text,text,integer,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.repo_create(text,text,text,text,text,integer,integer,text,jsonb,text,text) to anon;
grant execute on function public.repo_delete(uuid,text) to anon;
grant execute on function public.repo_is_founder(text) to anon;
grant execute on function public.repo_update(uuid,text,text,text,text,integer,integer,jsonb,text) to anon;

revoke execute on function public.quantum_submit_app(jsonb) from public, anon, authenticated;
revoke execute on function public.quantum_list_pending(text) from public, anon, authenticated;
revoke execute on function public.quantum_approve_app(text,text) from public, anon, authenticated;
revoke execute on function public.quantum_reject_app(text,text) from public, anon, authenticated;
revoke execute on function public.quantum_delete_published_app(text,text) from public, anon, authenticated;
revoke execute on function public.quantum_config_save(text,text,text) from public, anon, authenticated;
grant execute on function public.quantum_submit_app(jsonb) to anon;
grant execute on function public.quantum_list_pending(text) to anon;
grant execute on function public.quantum_approve_app(text,text) to anon;
grant execute on function public.quantum_reject_app(text,text) to anon;
grant execute on function public.quantum_delete_published_app(text,text) to anon;
grant execute on function public.quantum_config_save(text,text,text) to anon;
