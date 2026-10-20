> Workspace membership update: after this original installer, apply `workspace-access-setup.sql` and `workspace-access-sync.sql` and deploy both workspace/current sync functions. See [Workspace-access-setup.md](Workspace-access-setup.md). The final policy enrolls every explicitly verified active workspace member as well as revoking explicitly deactivated members. The false-only text below describes the original installation, not the final policy.

# Slack offboarding sync

This job removes HQ data access only after Slack explicitly returns `deleted: true` for the same provider-owned Slack user and workspace. It updates `hq_tour_staff.active` from `true` to `false`. Existing table RLS and the private Knowledge Base read this live approval, so a valid old JWT cannot bypass a revoked approval.

It never changes Auth users, sessions, refresh tokens, account bans, session limits, JWT keys, or browser storage. It never restores an approval. Guest accounts, away status, missing users, and Slack/API failures do not revoke anyone. Unknown identities remain manual review; the previously missing Ryan identity is not automatically disabled.

## Install and dry run

1. Run `slack-access-sync-setup.sql` as the project administrator. It creates a private control/audit area and a random 32-byte trigger token in Vault. Installation leaves the job **disabled** and in **dry run**. Re-running preserves those values and the existing token.
2. Deploy `hq-slack-access-sync` with `verify_jwt = false` **only for this new endpoint**. It authenticates a dedicated `x-hq-sync-secret` header before reading candidates or calling Slack. All other user-facing functions keep JWT verification enabled. Existing `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are reused; no existing secret needs to be copied.
3. Before enabling anything, save the approved account IDs and active users' session IDs/counts using administrator-only inspection. Verify the existing Auth settings retain unlimited time-box/inactivity values and no single-session enforcement. Do not change those settings, keys, or refresh-token behavior.
4. Start scheduled dry runs:

   ```sql
   update hq_access_private.slack_sync_control
   set enabled=true,dry_run=true where singleton;
   ```

5. After the next five-minute interval, review the private results:

   ```sql
   select run_id,started_at,status,proposed,changed,error_code,results
   from hq_access_private.slack_sync_runs order by started_at desc limit 5;
   ```

   Expect only explicitly deactivated accounts as proposed revocations. Confirm active guest/staff accounts remain `active`, unknown IDs are `unknown`, and `changed=0`. A missing Slack ID is not proof of deactivation. Do not turn off dry run if the observed result is unexpected.

6. Once independently reviewed, enable false-only updates:

   ```sql
   update hq_access_private.slack_sync_control
   set dry_run=false where singleton;
   ```

7. Inspect the next run and `hq_access_private.slack_sync_revocations`. Verify active staff approvals and their stored Auth sessions are unchanged. Test an active user's normal navigation/data access and the denied state with a synthetic unapproved identity; do not sign real users out to test.

## Safety behavior

- Requests need a valid dedicated token, unique UUID, and timestamp within five minutes. Replay IDs and overlapping runs are skipped.
- The bot workspace is checked with `auth.test`; each candidate is looked up with `users.info`. No email/name matching or editable `user_metadata` is used.
- `user_not_found` and `user_not_visible` are unknown. Outages, rate limits, missing scopes, or other systemic errors abort the whole run before any approval update.
- Unexpected IDs/workspaces, bots, missing `deleted` flags, or duplicate provider identities are unknown. The sync does not infer deactivation from ambiguity.
- At most three revocations are allowed per run, and at least one other account must be positively verified active. Exceeding the limit blocks the entire batch. Larger intentional offboarding batches require administrator review rather than removing the cap silently.
- The database rechecks the original candidate IDs/provider identity, the enabled/dry-run switches, and the cap under a transaction lock. Disabling the control during an in-flight run prevents its updates. Enabling writes during a dry run never turns that running dry run into a write.
- Only service-role RPCs can read the token/candidates or apply changes; private audit/control tables are inaccessible to browser roles. The endpoint returns aggregate counts and no secrets or member details.
- Logs contain fixed diagnostic codes only. Vault values, Slack tokens, session tokens, identities, and upstream responses are never logged.
- Sessions remain persistent; use the existing Supabase client storage key with `persistSession: true` and `autoRefreshToken: true`. Revoking approval changes authorization, not the session lifetime of other staff.

## Administrator validation queries

These queries return configuration/counts only, never a bot token, trigger token, access token, or refresh token. Confirm Vault exists and `pgcrypto` lives in `extensions` before applying the installer:

```sql
select e.extname,n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname in ('pgcrypto','supabase_vault','pg_cron','pg_net');

select public.hq_slack_sync_config()-'trigger_secret' as sync_configuration;
select name,length(decrypted_secret)=64 and decrypted_secret ~ '^[0-9a-f]{64}$' as trigger_configured
from vault.decrypted_secrets where name='hq_slack_access_sync_trigger';
select jobname,schedule,active from cron.job where jobname='paws-hq-slack-access-sync';

select count(*) as approved_records,count(*) filter(where active) as active_approvals
from public.hq_tour_staff;
select count(*) as stored_sessions,md5(string_agg(id::text,',' order by id)) as session_id_fingerprint
from auth.sessions;
```

Save the last two results before enabling writes, then compare afterward. A deliberate revocation changes the approval count; this feature never changes session IDs. Independent legitimate logins/sign-outs can change the session count/fingerprint while verification is running, so investigate a difference rather than automatically logging anyone out.

To request **one dry run immediately**, first confirm the control is `enabled=true,dry_run=true`, then run the following. It returns only the `pg_net` request ID; the secret is read inside PostgreSQL and is never printed:

```sql
select net.http_post(
  url:='https://dppjgglaeieevsfwsbii.supabase.co/functions/v1/hq-slack-access-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-hq-sync-secret',v.decrypted_secret),
  body:=jsonb_build_object('run_id',gen_random_uuid(),'requested_at',clock_timestamp()),
  timeout_milliseconds:=120000
) as request_id
from vault.decrypted_secrets v
join hq_access_private.slack_sync_control c on c.singleton
where v.name='hq_slack_access_sync_trigger' and c.enabled and c.dry_run;
```

Review the private audit after the HTTP request completes:

```sql
select run_id,started_at,status,proposed,changed,error_code,results
from hq_access_private.slack_sync_runs order by started_at desc limit 3;
select run_id,user_id,slack_user_id,team_id,revoked_at,reason
from hq_access_private.slack_sync_revocations order by revoked_at desc limit 10;
```

Use a rollback transaction to test denial for a real approved user's existing UUID without persistently changing them. The variable is a UUID only; do not paste a JWT or session token. This exercises the same live allowlist condition used by private table/Storage policies:

```sql
begin;
update public.hq_tour_staff set active=false where user_id='EXISTING_APPROVED_USER_UUID';
select set_config('request.jwt.claim.sub','EXISTING_APPROVED_USER_UUID',true);
set local role authenticated;
select count(*) as private_kb_rows from public.hq_knowledge_pages;
select count(*) as private_media_objects from storage.objects where bucket_id='hq-knowledge-media';
rollback;
```

Both counts must be zero. If a query fails, issue `rollback` and investigate before deployment. Separately test an active staff JWT, anonymous requests, and an unapproved identity. Do not replace or revoke any real user's session to perform these tests.

## Pause and investigate

```sql
update hq_access_private.slack_sync_control set enabled=false where singleton;
```

This stops scheduled calls and blocks an in-flight finalize. It does not sign anyone out or modify any approval. Restore a mistakenly revoked approval only after independently confirming the account should have access; the job deliberately never re-enables accounts automatically. Keep historical account records for attribution.

References: [Slack user object](https://docs.slack.dev/reference/objects/user-object/), [users.info](https://docs.slack.dev/reference/methods/users.info/), [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).
