-- Apply only after the QuOLab Nexus frontend has been deployed with
-- supabase/functions/quolab-nexus-admin. The Edge Function uses the server-only
-- QUOLAB_NEXUS_SECRET_KEY; browser clients must no longer call these RPCs directly.

revoke execute on function public.quantum_submit_app(jsonb) from public, anon, authenticated;
revoke execute on function public.quantum_list_pending(text) from public, anon, authenticated;
revoke execute on function public.quantum_approve_app(text, text) from public, anon, authenticated;
revoke execute on function public.quantum_reject_app(text, text) from public, anon, authenticated;
revoke execute on function public.quantum_delete_published_app(text, text) from public, anon, authenticated;
revoke execute on function public.quantum_config_save(text, text, text) from public, anon, authenticated;
revoke execute on function public.repo_is_founder(text) from public, anon, authenticated;
revoke execute on function public.repo_can_edit(uuid, text) from public, anon, authenticated;
revoke execute on function public.repo_create(text, text, text, text, text, integer, integer, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.repo_update(uuid, text, text, text, text, integer, integer, jsonb, text) from public, anon, authenticated;
revoke execute on function public.repo_delete(uuid, text) from public, anon, authenticated;

grant execute on function public.quantum_submit_app(jsonb) to service_role;
grant execute on function public.quantum_list_pending(text) to service_role;
grant execute on function public.quantum_approve_app(text, text) to service_role;
grant execute on function public.quantum_reject_app(text, text) to service_role;
grant execute on function public.quantum_delete_published_app(text, text) to service_role;
grant execute on function public.quantum_config_save(text, text, text) to service_role;
grant execute on function public.repo_is_founder(text) to service_role;
grant execute on function public.repo_can_edit(uuid, text) to service_role;
grant execute on function public.repo_create(text, text, text, text, text, integer, integer, text, jsonb, text, text) to service_role;
grant execute on function public.repo_update(uuid, text, text, text, text, integer, integer, jsonb, text) to service_role;
grant execute on function public.repo_delete(uuid, text) to service_role;
