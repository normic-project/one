begin;

create or replace function public.configure_one_shot_indexer_schedule()
returns void
language plpgsql
security definer
set search_path = public, vault, cron, net
as $$
declare
  existing_job bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'one_shot_indexer_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'one_shot_indexer_cron_secret') then
    raise exception 'Required Vault secrets one_shot_indexer_url and one_shot_indexer_cron_secret are missing';
  end if;
  select jobid into existing_job from cron.job where jobname = 'one-shot-indexer-every-minute';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'one-shot-indexer-every-minute',
    '* * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'one_shot_indexer_url'),
      headers := jsonb_build_object('Content-Type','application/json','Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'one_shot_indexer_cron_secret')),
      body := '{"scheduled":true}'::jsonb,
      timeout_milliseconds := 50000
    );$job$
  );
end;
$$;

revoke all on function public.configure_one_shot_indexer_schedule() from public, anon, authenticated;

commit;
