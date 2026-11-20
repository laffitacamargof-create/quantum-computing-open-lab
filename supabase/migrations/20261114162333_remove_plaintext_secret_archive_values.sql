-- Do not retain exposed API credentials or founder passwords, even in a
-- non-exposed schema. Keep only the names as an audit record.
alter table private.quolab_nexus_secret_archive
  drop column if exists value;

comment on table private.quolab_nexus_secret_archive is
  'Audit record of configuration keys removed from the exposed public table. Secret values are intentionally not retained.';
