-- Correct special SQL expressions in quantum_submit_app.
-- COALESCE, NULLIF, GREATEST and LEAST are SQL syntax, not pg_catalog functions.
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
