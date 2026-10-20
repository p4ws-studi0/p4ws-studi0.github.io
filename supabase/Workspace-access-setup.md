# Equal workspace access

Every active human member of Slack workspace `T02QW28SR39`, including guests, single-channel guests, the bookkeeper, and future members who sign in, uses the same `hq_tour_staff.active` approval and the same existing table/Knowledge Base policies. There are no role tiers or separate page allowlists.

`hq-workspace-access` accepts an existing signed-in user's JWT and an empty POST body. It validates that JWT with `/auth/v1/user`, reads the provider-owned `slack_oidc` identity, checks the bot workspace using `auth.test`, and asks `users.info` about the exact linked Slack ID. Editable `user_metadata`, names, email addresses, guest flags, and request-supplied IDs never authorize access.

- `deleted === false`, matching user/workspace, and `is_bot === false`: create a missing shared approval or restore an inactive approval. Existing active approvals are unchanged.
- `deleted === true` with the same checks: revoke an existing active approval. A deactivated user never gets enrolled.
- Missing/ambiguous identity, missing user, API failure, incomplete response, wrong workspace, or stale verification: no approval mutation. Existing sessions and existing active permissions remain intact.

The service-only database RPC locks/rechecks the provider identity immediately before changing approval. An identity changed between Edge verification and the database call cannot enroll another account. Verification is valid for at most two minutes. Changed approvals get a private audit entry; repeat checks are idempotent. No Auth users, sessions, refresh tokens, passwords, keys, bans, or timeouts are changed.

## Deployment order

1. Apply `workspace-access-setup.sql`. It creates only the service-only RPC and private audit/state tables; installation does not enroll/revoke anyone.
2. Deploy `hq-workspace-access` with `verify_jwt = true`, keeping all existing function settings unchanged. Reuse `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, and optional `HQ_ORIGIN`. `SLACK_TEAM_ID` must equal `T02QW28SR39`.
3. Call the endpoint through the existing Supabase client using an empty body, for example `supabaseClient.functions.invoke('hq-workspace-access', {body: {}})`. User JWTs belong in `Authorization`; publishable API keys are not user JWTs. The function independently validates the JWT even with gateway validation enabled.
4. Complete enrollment before a new/missing member's protected data modules perform their initial approval checks, or explicitly refetch those modules after access is restored. Otherwise an early End Of Day permission check could leave a stale denied message after enrollment succeeds. Avoid reloading already active users or replacing their sessions.
5. Apply `workspace-access-sync.sql` after the original sync installer and `workspace-access-setup.sql`. It replaces only the candidate/finalization RPCs, preserving the Cron schedule and control settings. It scans all signed-in workspace identities, including accounts with no staff row; explicit active members are enrolled/restored using this shared approval and deactivated members revoked. Deploy the updated `hq-slack-access-sync` source so already-inactive historical accounts do not count against the cap on new revocations. Unknown results remain unchanged. A future Slack member has an Auth identity after their first successful Slack sign-in; there is no reason to precreate Supabase accounts for the whole directory.
6. Verify a previously missing approved member, a guest, an existing staff member, and a synthetic deactivated/nonworkspace identity. Save session counts/fingerprints before/after and verify no sessions were removed. Check the private audit for intended approval-only changes.

Production accepts the exact configured `HQ_ORIGIN` (default `https://hq.pawspet.com`). HTTP loopback origins (`localhost`, `127.0.0.1`, `[::1]`) are also accepted for local previews. All still need the same valid user JWT and verified workspace identity; CORS never grants membership. No wildcard origins or browser service-role keys are used.

## Secret-safe inspection

```sql
select action,count(*) from hq_access_private.workspace_access_audit group by action;
select user_id,action,previous_active,checked_at,changed_at
from hq_access_private.workspace_access_audit order by changed_at desc limit 10;
select count(*) as stored_sessions,md5(string_agg(id::text,',' order by id)) as session_id_fingerprint
from auth.sessions;
```

Authorization data may change while logins stay persistent. Keep the existing Supabase storage key, automatic token refresh, unlimited session time box/inactivity settings, and multi-session support. Never call `signOut` to refresh an approval or handle a network outage.

The private verification state stores the start time of each accepted Slack check. A late active response cannot undo a newer confirmed deactivation. The database rechecks provider identity and serializes approval changes; browser roles cannot enroll themselves or edit the state/audit.

The homepage public `#general` widget uses this same full-workspace eligibility. Guests do not need a separate channel membership tier in HQ. The Slack bot must still belong to the configured **public general channel**, and viewer identity, workspace, active status, and HQ approval are still checked. Private channels and arbitrary file URLs are never exposed.

## Local database verification

Install `@electric-sql/pglite` outside the website or point `PAWS_PGLITE_MODULE` at an existing PGlite module, then run `node scripts/verify-workspace-access.mjs`. The script uses a new ephemeral database and synthetic accounts only. It checks enrollment, idempotence, dry run, identity spoofing, stale-response protection, deactivation/reactivation, historical inactive accounts, private RPC/state permissions, and preservation of session IDs. It never calls the production project or Slack.

`node --test tests/*.test.cjs` also verifies the authenticated endpoint, the client enrollment barrier across every operational page, ordinary active-account fast paths, missing/guest accounts, retries, and unchanged persistent sessions.
