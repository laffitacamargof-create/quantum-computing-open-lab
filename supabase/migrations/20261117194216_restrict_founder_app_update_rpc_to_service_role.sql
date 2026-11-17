revoke execute on function public.quantum_update_published_app(text,jsonb,text) from public, anon, authenticated;
revoke execute on function public.quantum_update_pending_app(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.quantum_update_published_app(text,jsonb,text) to service_role;
grant execute on function public.quantum_update_pending_app(text,jsonb,text) to service_role;
