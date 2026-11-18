-- QuOLab Nexus connector community store.
-- Credentials are never submitted here; only validated connector code and metadata.
-- Private SECURITY DEFINER functions are called through public SECURITY INVOKER RPC wrappers.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create table if not exists public.nexus_pending_connectors (
  id text primary key,
  name text not null,
  version text not null default '0.1.0',
  description text not null default '',
  author text not null default 'anonymous',
  perms jsonb not null default '{}'::jsonb,
  requires jsonb not null default '[]'::jsonb,
  ui text not null default '',
  web text not null default '',
  py text not null,
  hash text not null,
  status text not null default 'pending' check (status in ('pending','rejected')),
  reason text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.nexus_published_connectors (
  id text primary key,
  name text not null,
  version text not null,
  description text not null default '',
  author text not null default 'anonymous',
  perms jsonb not null default '{}'::jsonb,
  requires jsonb not null default '[]'::jsonb,
  ui text not null default '',
  web text not null default '',
  py text not null,
  hash text not null,
  published_at timestamptz not null default now(),
  reviewer text not null default ''
);

create index if not exists nexus_pending_status_submitted_idx
  on public.nexus_pending_connectors (status, submitted_at);
create index if not exists nexus_published_published_idx
  on public.nexus_published_connectors (published_at desc);

alter table public.nexus_pending_connectors enable row level security;
alter table public.nexus_published_connectors enable row level security;

revoke all on public.nexus_pending_connectors from public, anon, authenticated;
revoke all on public.nexus_published_connectors from public, anon, authenticated;
grant select on public.nexus_published_connectors to anon, authenticated;

drop policy if exists nexus_published_read on public.nexus_published_connectors;
create policy nexus_published_read
  on public.nexus_published_connectors
  for select to anon, authenticated
  using (true);

-- Founder verification helper. It reuses the existing repository founder-key verifier.
create or replace function private.nexus_is_founder(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.repo_is_founder(p_key), false);
$$;

create or replace function private.nexus_submit_connector(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_py text;
begin
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid payload';
  end if;

  v_id := p_data->>'id';
  v_py := coalesce(p_data->>'py','');

  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid id';
  end if;
  if coalesce(p_data->>'name','') = '' or length(p_data->>'name') > 80 then
    raise exception 'invalid name';
  end if;
  if length(v_py) = 0 or length(v_py) > 60000 or position('@connector.tool' in v_py) = 0 then
    raise exception 'invalid python code';
  end if;
  if length(coalesce(p_data->>'ui','')) > 60000 or length(coalesce(p_data->>'web','')) > 60000 then
    raise exception 'code too large';
  end if;
  if jsonb_typeof(coalesce(p_data->'perms','{}'::jsonb)) <> 'object' then
    raise exception 'invalid permissions';
  end if;
  if jsonb_typeof(coalesce(p_data->'requires','[]'::jsonb)) <> 'array' then
    raise exception 'invalid requirements';
  end if;
  if coalesce(p_data->>'hash','') !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'invalid checksum';
  end if;
  if exists (select 1 from public.nexus_published_connectors where id = v_id) then
    raise exception 'connector is already published';
  end if;
  if not exists (select 1 from public.nexus_pending_connectors where id = v_id and status = 'rejected')
     and (select count(*) from public.nexus_pending_connectors where status = 'pending') >= 200 then
    raise exception 'the review queue is full, try later';
  end if;

  insert into public.nexus_pending_connectors as t
    (id,name,version,description,author,perms,requires,ui,web,py,hash,status,reason,submitted_at,reviewed_at)
  values
    (v_id,left(p_data->>'name',80),left(coalesce(p_data->>'version','0.1.0'),20),
     left(coalesce(p_data->>'description',''),400),left(coalesce(p_data->>'author','anonymous'),60),
     coalesce(p_data->'perms','{}'::jsonb),coalesce(p_data->'requires','[]'::jsonb),
     coalesce(p_data->>'ui',''),coalesce(p_data->>'web',''),v_py,p_data->>'hash','pending','',now(),null)
  on conflict (id) do update set
    name=excluded.name,version=excluded.version,description=excluded.description,author=excluded.author,
    perms=excluded.perms,requires=excluded.requires,ui=excluded.ui,web=excluded.web,py=excluded.py,
    hash=excluded.hash,status='pending',reason='',submitted_at=now(),reviewed_at=null;

  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;

create or replace function private.nexus_submission_status(p_ids text[])
returns table(id text,status text,reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,p.status,p.reason
  from public.nexus_pending_connectors p
  where p.id = any(p_ids)
  union all
  select b.id,'published',''
  from public.nexus_published_connectors b
  where b.id = any(p_ids)
    and not exists (select 1 from public.nexus_pending_connectors p where p.id=b.id);
$$;

create or replace function private.nexus_list_pending(p_key text)
returns setof public.nexus_pending_connectors
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.nexus_is_founder(p_key) then raise exception 'forbidden'; end if;
  return query
    select * from public.nexus_pending_connectors
    where status='pending'
    order by submitted_at;
end;
$$;

create or replace function private.nexus_approve_connector(p_id text,p_key text,p_reviewer text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.nexus_pending_connectors;
begin
  if not private.nexus_is_founder(p_key) then raise exception 'forbidden'; end if;
  select * into r from public.nexus_pending_connectors where id=p_id and status='pending';
  if not found then raise exception 'not found'; end if;

  insert into public.nexus_published_connectors as b
    (id,name,version,description,author,perms,requires,ui,web,py,hash,published_at,reviewer)
  values
    (r.id,r.name,r.version,r.description,r.author,r.perms,r.requires,r.ui,r.web,r.py,r.hash,now(),left(coalesce(p_reviewer,''),60))
  on conflict (id) do update set
    name=excluded.name,version=excluded.version,description=excluded.description,author=excluded.author,
    perms=excluded.perms,requires=excluded.requires,ui=excluded.ui,web=excluded.web,py=excluded.py,
    hash=excluded.hash,published_at=now(),reviewer=excluded.reviewer;

  delete from public.nexus_pending_connectors where id=p_id;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.nexus_reject_connector(p_id text,p_key text,p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.nexus_is_founder(p_key) then raise exception 'forbidden'; end if;
  update public.nexus_pending_connectors
    set status='rejected',reason=left(coalesce(p_reason,''),400),reviewed_at=now()
    where id=p_id and status='pending';
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.nexus_delete_connector(p_table text,p_id text,p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.nexus_is_founder(p_key) then raise exception 'forbidden'; end if;
  if p_table='published' then
    delete from public.nexus_published_connectors where id=p_id;
  elsif p_table='pending' then
    delete from public.nexus_pending_connectors where id=p_id;
  else
    raise exception 'invalid table';
  end if;
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

-- Public RPC wrappers are SECURITY INVOKER; privileged work stays in private schema.
create or replace function public.nexus_submit_connector(p_data jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nexus_submit_connector(p_data); $$;

create or replace function public.nexus_submission_status(p_ids text[])
returns table(id text,status text,reason text)
language sql stable security invoker set search_path = ''
as $$ select * from private.nexus_submission_status(p_ids); $$;

create or replace function public.nexus_list_pending(p_key text)
returns setof public.nexus_pending_connectors
language sql security invoker set search_path = ''
as $$ select * from private.nexus_list_pending(p_key); $$;

create or replace function public.nexus_approve_connector(p_id text,p_key text,p_reviewer text default '')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nexus_approve_connector(p_id,p_key,p_reviewer); $$;

create or replace function public.nexus_reject_connector(p_id text,p_key text,p_reason text default '')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nexus_reject_connector(p_id,p_key,p_reason); $$;

create or replace function public.nexus_delete_connector(p_table text,p_id text,p_key text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nexus_delete_connector(p_table,p_id,p_key); $$;

-- No direct access to the internal schema/tables. RPC wrappers are the only API surface.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.nexus_submit_connector(jsonb) to anon, authenticated;
grant execute on function private.nexus_submission_status(text[]) to anon, authenticated;
grant execute on function private.nexus_list_pending(text) to anon, authenticated;
grant execute on function private.nexus_approve_connector(text,text,text) to anon, authenticated;
grant execute on function private.nexus_reject_connector(text,text,text) to anon, authenticated;
grant execute on function private.nexus_delete_connector(text,text,text) to anon, authenticated;

revoke all on function public.nexus_submit_connector(jsonb) from public, anon, authenticated;
revoke all on function public.nexus_submission_status(text[]) from public, anon, authenticated;
revoke all on function public.nexus_list_pending(text) from public, anon, authenticated;
revoke all on function public.nexus_approve_connector(text,text,text) from public, anon, authenticated;
revoke all on function public.nexus_reject_connector(text,text,text) from public, anon, authenticated;
revoke all on function public.nexus_delete_connector(text,text,text) from public, anon, authenticated;
grant execute on function public.nexus_submit_connector(jsonb) to anon, authenticated;
grant execute on function public.nexus_submission_status(text[]) to anon, authenticated;
grant execute on function public.nexus_list_pending(text) to anon, authenticated;
grant execute on function public.nexus_approve_connector(text,text,text) to anon, authenticated;
grant execute on function public.nexus_reject_connector(text,text,text) to anon, authenticated;
grant execute on function public.nexus_delete_connector(text,text,text) to anon, authenticated;

grant usage on schema public to anon, authenticated;
notify pgrst, 'reload schema';
