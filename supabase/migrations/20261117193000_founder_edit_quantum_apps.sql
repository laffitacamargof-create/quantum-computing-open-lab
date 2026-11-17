-- Founder-only editing for public Quantum Apps.
-- All writes are gated by repo_is_founder(), which accepts valid temporary founder sessions.

create or replace function public.quantum_update_pending_app(p_id text, p_app jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app public.quantum_pending_apps%rowtype;
  v_python text;
  v_html text;
  v_server text;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  if pg_catalog.jsonb_typeof(p_app) <> 'object' then raise exception 'invalid app payload'; end if;
  v_python := coalesce(p_app->>'python_code', p_app->>'pythonCode', '');
  v_html := coalesce(p_app->>'html_code', p_app->>'htmlCode', '');
  v_server := coalesce(p_app->>'server_url', p_app->>'serverUrl', '');
  if pg_catalog.length(v_python) > 1000000 or pg_catalog.length(v_html) > 1000000 then
    raise exception 'app code too large';
  end if;
  if v_server <> '' and v_server !~* '^https?://' then raise exception 'invalid server url'; end if;

  update public.quantum_pending_apps
  set name = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'name'), ''), name), 100),
      title = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'title'), ''), nullif(pg_catalog.btrim(p_app->>'name'), ''), title), 100),
      description = pg_catalog.left(coalesce(p_app->>'description', description, ''), 500),
      tags = pg_catalog.left(coalesce(p_app->>'tags', tags, ''), 300),
      duration = greatest(1, least(240, coalesce(nullif(p_app->>'duration','')::integer, duration, 8))),
      python_code = v_python,
      html_code = v_html,
      server_url = v_server,
      updated_at = now()
  where id = p_id and status = 'pending'
  returning * into v_app;
  if not found then raise exception 'not_found'; end if;
  return pg_catalog.to_jsonb(v_app);
end
$function$;

create or replace function public.quantum_update_published_app(p_id text, p_app jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app public.quantum_published_apps%rowtype;
  v_updated public.quantum_published_apps%rowtype;
  v_python text;
  v_html text;
  v_server text;
begin
  if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
  if pg_catalog.jsonb_typeof(p_app) <> 'object' then raise exception 'invalid app payload'; end if;
  select * into v_app from public.quantum_published_apps where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  v_python := coalesce(p_app->>'python_code', p_app->>'pythonCode', '');
  v_html := coalesce(p_app->>'html_code', p_app->>'htmlCode', '');
  v_server := coalesce(p_app->>'server_url', p_app->>'serverUrl', '');
  if pg_catalog.length(v_python) > 1000000 or pg_catalog.length(v_html) > 1000000 then
    raise exception 'app code too large';
  end if;
  if v_server <> '' and v_server !~* '^https?://' then raise exception 'invalid server url'; end if;

  insert into public.quantum_app_versions
    (app_id, version, python_code, html_code, published_by, published_at, change_notes)
  values
    (v_app.id, coalesce(v_app.version, 1), v_app.python_code, v_app.html_code,
     'founder', now(), 'Snapshot before founder edit');

  update public.quantum_published_apps
  set name = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'name'), ''), name), 100),
      title = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_app->>'title'), ''), nullif(pg_catalog.btrim(p_app->>'name'), ''), title), 100),
      description = pg_catalog.left(coalesce(p_app->>'description', description, ''), 500),
      tags = pg_catalog.left(coalesce(p_app->>'tags', tags, ''), 300),
      duration = greatest(1, least(240, coalesce(nullif(p_app->>'duration','')::integer, duration, 8))),
      python_code = v_python,
      html_code = v_html,
      server_url = v_server,
      updated_at = now(),
      published_by = 'founder',
      published_at = now(),
      version = coalesce(version, 1) + 1,
      is_active = true
  where id = p_id
  returning * into v_updated;
  return pg_catalog.to_jsonb(v_updated);
end
$function$;

revoke all on function public.quantum_update_pending_app(text,jsonb,text) from public, anon, authenticated;
revoke all on function public.quantum_update_published_app(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.quantum_update_pending_app(text,jsonb,text) to anon;
grant execute on function public.quantum_update_published_app(text,jsonb,text) to anon;
