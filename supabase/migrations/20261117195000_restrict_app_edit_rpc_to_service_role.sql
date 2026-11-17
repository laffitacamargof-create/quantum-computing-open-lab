-- App-edit RPCs are callable only by the trusted administrative Edge Function.
-- The function itself verifies the temporary founder session before forwarding to these RPCs.
revoke all on function public.quantum_update_pending_app(text,jsonb,text) from public, anon, authenticated;
revoke all on function public.quantum_update_published_app(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.quantum_update_pending_app(text,jsonb,text) to service_role;
grant execute on function public.quantum_update_published_app(text,jsonb,text) to service_role;
