create or replace function public.repo_create_founder_session(p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token text;
begin
  if p_key is null or length(p_key) < 8 or length(p_key) > 512
     or not exists (
       select 1 from public.repo_admin
       where key_hash = public.repo_hash(p_key)
     ) then
    raise exception 'forbidden';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', '');
  insert into private.repo_founder_sessions(token_hash, expires_at)
  values (public.repo_hash(v_token), now() + interval '8 hours');
  return v_token;
end
$function$;

revoke all on function public.repo_create_founder_session(text) from public, anon, authenticated;
grant execute on function public.repo_create_founder_session(text) to service_role;
