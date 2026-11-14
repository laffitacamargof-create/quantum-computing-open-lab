-- QuOLab Nexus: ensure the private audit schema is not granted to API roles.
-- The table itself has no grants to anon/authenticated; this migration also removes
-- any inherited schema/table/function access if it was granted elsewhere.
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
