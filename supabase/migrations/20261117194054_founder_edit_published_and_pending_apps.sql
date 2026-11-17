create or replace function public.quantum_update_published_app(p_id text, p_app jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.quantum_published_apps%rowtype;
  v_python text;
  v_html text;
  v_server_url text;
  v_result public.quantum_published_apps%rowtype;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  if pg_catalog.jsonb_typeof(p_app) <> 'object' then raise exception 'invalid app payload'; end if;
  select * into v_current from public.quantum_published_apps where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_python := coalesce(p_app->>'python_code', p_app->>'pythonCode', v_current.python_code, '');
  v_html := coalesce(p_app->>'html_code', p_app->>'htmlCode', v_current.html_code, '');
  v_server_url := coalesce(p_app->>'server_url', p_app->>'serverUrl', v_current.server_url, '');
  if pg_catalog.length(v_python) > 1000000 or pg_catalog.length(v_html) > 1000000 then raise exception 'app code too large'; end if;
  if v_server_url <> '' and v_server_url !~* '^https?://' then raise exception 'invalid server url'; end if;
  insert into public.quantum_app_versions
    (app_id, version, python_code, html_code, published_by, published_at, change_notes)
  values (v_current.id, coalesce(v_current.version, 1), v_current.python_code, v_current.html_code,
    'founder', pg_catalog.now(), 'Snapshot before founder edit');
  update public.quantum_published_apps set
    name = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'name'), ''), nullif(pg_catalog.btrim(p_app->>'title'), ''), v_current.name), 100),
    title = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'title'), ''), nullif(pg_catalog.btrim(p_app->>'name'), ''), v_current.title), 100),
    description = pg_catalog.left(coalesce(p_app->>'description', v_current.description, ''), 500),
    tags = pg_catalog.left(coalesce(p_app->>'tags', v_current.tags, ''), 300),
    duration = greatest(1, least(240, coalesce(nullif(p_app->>'duration','')::integer, v_current.duration, 8))),
    python_code = v_python, html_code = v_html, server_url = v_server_url,
    updated_at = pg_catalog.now(), version = coalesce(v_current.version, 1) + 1, is_active = true
  where id = p_id returning * into v_result;
  return pg_catalog.to_jsonb(v_result);
end
$function$;

create or replace function public.quantum_update_pending_app(p_id text, p_app jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.quantum_pending_apps%rowtype;
  v_python text;
  v_html text;
  v_server_url text;
  v_result public.quantum_pending_apps%rowtype;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  if pg_catalog.jsonb_typeof(p_app) <> 'object' then raise exception 'invalid app payload'; end if;
  select * into v_current from public.quantum_pending_apps where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_python := coalesce(p_app->>'python_code', p_app->>'pythonCode', v_current.python_code, '');
  v_html := coalesce(p_app->>'html_code', p_app->>'htmlCode', v_current.html_code, '');
  v_server_url := coalesce(p_app->>'server_url', p_app->>'serverUrl', v_current.server_url, '');
  if pg_catalog.length(v_python) > 1000000 or pg_catalog.length(v_html) > 1000000 then raise exception 'app code too large'; end if;
  if v_server_url <> '' and v_server_url !~* '^https?://' then raise exception 'invalid server url'; end if;
  update public.quantum_pending_apps set
    name = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'name'), ''), nullif(pg_catalog.btrim(p_app->>'title'), ''), v_current.name), 100),
    title = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'title'), ''), nullif(pg_catalog.btrim(p_app->>'name'), ''), v_current.title), 100),
    description = pg_catalog.left(coalesce(p_app->>'description', v_current.description, ''), 500),
    tags = pg_catalog.left(coalesce(p_app->>'tags', v_current.tags, ''), 300),
    duration = greatest(1, least(240, coalesce(nullif(p_app->>'duration','')::integer, v_current.duration, 8))),
    python_code = v_python, html_code = v_html, server_url = v_server_url, updated_at = pg_catalog.now()
  where id = p_id returning * into v_result;
  return pg_catalog.to_jsonb(v_result);
end
$function$;

revoke execute on function public.quantum_update_published_app(text,jsonb,text) from public, anon, authenticated;
revoke execute on function public.quantum_update_pending_app(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.quantum_update_published_app(text,jsonb,text) to anon;
grant execute on function public.quantum_update_pending_app(text,jsonb,text) to anon;
