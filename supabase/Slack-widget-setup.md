# Homepage Slack widget

The homepage displays the newest post in the workspace's public `#general` channel, its author and Eastern timestamp, attached images, and a link to open the post in Slack. It checks for updates every minute while the page is visible. Images open in an enlarged viewer; other attachments link to Slack.

## Connect Slack

1. In the Paws Slack app's **OAuth & Permissions**, add these **Bot Token Scopes**: `channels:history`, `channels:read`, `files:read`, and `users:read`. These are read-only scopes; the widget never posts messages. Keep the existing Sign in with Slack configuration.
2. Install or reinstall the app in the Paws workspace and invite the bot to `#general`. Installation and the new scopes require workspace-owner approval. Public channel history is limited to channels the bot has joined; the server further restricts requests to the configured general channel.
3. In the Paws Supabase project (`dppjgglaeieevsfwsbii`), open **Edge Functions → Secrets** and set:

   | Secret | Value |
   | --- | --- |
   | `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack. Enter directly in Supabase; never put it in website files, Git, or chat. |
   | `SLACK_TEAM_ID` | Paws Slack workspace ID, starting with `T`. |
   | `SLACK_GENERAL_CHANNEL_ID` | General channel ID, starting with `C`. |
   | `HQ_ORIGIN` | Optional; defaults to `https://hq.pawspet.com`. |

   Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` automatically.
4. Deploy `functions/hq-slack-general/index.ts` as **hq-slack-general**, keeping JWT verification enabled. With the CLI, run `supabase functions deploy hq-slack-general --project-ref dppjgglaeieevsfwsbii` from the repository root. The same single file can be pasted into Supabase's dashboard function editor.
5. Verify with a Paws HQ account signed in through Slack: load the homepage, compare the displayed message with `#general`, and open an attached image. Do not post a test message without authorization. An empty channel and a connection error have separate UI states.

## Access and storage

- Every message/image request validates the Supabase user and their active row in the existing `hq_tour_staff` approval table using that user's JWT and RLS. No service-role key is used.
- The user's provider-owned Slack identity must match the configured workspace, and they must be an active member of `#general`. User-editable profile metadata cannot grant access. HQ guest accounts can view the widget only if they also meet these Slack membership requirements.
- The server confirms that the bot belongs to this workspace and has joined its actual public general channel. It accepts no caller-selected channel.
- Slack data is not stored in the database. In-memory message/membership/user caches last up to 30 seconds; configuration/permalink caches last up to five minutes. HQ approval is rechecked on each request.
- Private image URLs and bot credentials never reach browser code. Images are proxied only for files attached to the current post, restricted to Slack download hosts, raster formats, and 8 MiB per image. Up to 12 image previews are shown; remaining attachments link to Slack. External image URLs and SVGs are not embedded.
- Responses use `private, no-store`; browser image URLs are revoked on refresh, logout, and page exit. Errors clear previously displayed private content. A revoked Slack membership can take up to the 30-second server cache plus the next homepage refresh to disappear.

## Files and checks

- `assets/home-slack.js` and `assets/home-slack.css`: homepage widget.
- `supabase/functions/hq-slack-general/index.ts`: authenticated Slack API endpoint and image proxy.
- `supabase/config.toml`: function configuration.
- `tests/home-slack.test.cjs` and `tests/slack-general.test.cjs`: frontend and backend regression tests. Run `node --test tests/*.test.cjs`.

`CONNECTION_REQUIRED` means missing secrets, a revoked token, missing scopes, wrong workspace/channel, or a bot that has not joined the channel. `ACCESS_DENIED` means the viewer lacks HQ approval or the required Slack identity/membership. Neither error exposes Slack credentials or raw provider responses.

Supabase **Edge Functions → hq-slack-general → Logs** records fixed setup reason tags. For example, `SLACK_API_ERROR` with method `conversations.info` and error `missing_scope` means the installed token lacks the channel-read permission. Check **Bot Token Scopes** and reinstall the app after changing scopes; update `SLACK_BOT_TOKEN` if Slack issues a new token. Diagnostics never include secret values, user/channel IDs, message content, or raw provider responses. Surrounding whitespace in the three Slack secret values is ignored.

References: [Slack channel history](https://docs.slack.dev/reference/methods/conversations.history/), [Slack file metadata](https://docs.slack.dev/reference/methods/files.info/), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).
