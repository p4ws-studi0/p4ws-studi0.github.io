# Homepage Slack widget

The homepage displays the newest post in the workspace's public `#general` channel, its author's name and profile photo, Eastern timestamp, attached images, and a link to open the post in Slack. Profile photos use the existing `users:read` permission and fall back to initials when missing or unavailable. Standard Slack emoji shortcodes, aliases, skin tones, and common text emoticons render as native emoji using a bundled, pinned Unicode mapping. Custom workspace emojis and aliases render inline, including animated GIFs, through the authenticated server proxy. Code and URL destinations remain literal. Unknown/unavailable custom emojis remain readable as text. The widget checks for updates every minute while visible. Images open in an enlarged viewer; other attachments link to Slack.

## Connect Slack

1. In the Paws Slack app's **OAuth & Permissions**, add these **Bot Token Scopes**: `channels:history`, `channels:read`, `files:read`, `users:read`, and **`emoji:read`**. These are read-only scopes; the widget never posts messages. Keep the existing Sign in with Slack configuration. Missing `emoji:read` affects only custom emojis; messages, standard emojis, and attachments still work.
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

- Every message/image/emoji/profile-photo request validates the Supabase user and their active row in the existing `hq_tour_staff` approval table using that user's JWT and RLS. No service-role key is used.
- The user's provider-owned Slack identity must match the configured workspace, and they must be an active workspace member. User-editable profile metadata cannot grant access. All verified active workspace members, including guests, have the same widget access.
- The server confirms that the bot belongs to this workspace and has joined its actual public general channel. It accepts no caller-selected channel.
- Slack data is not stored in the database. In-memory message/user caches last up to 30 seconds; configuration/permalink/custom-emoji catalog caches last up to five minutes. HQ approval is rechecked on each request. Optional emoji lookup failures are cached briefly and never disable the rest of the feed or set its rate-limit cooldown.
- Private image URLs and bot credentials never reach browser code. Images are proxied only for files attached to the current post, restricted to Slack download hosts, raster formats, and 8 MiB per image. Up to 12 image previews are shown; remaining attachments link to Slack. External image URLs and SVGs are not embedded.
- Custom emoji responses expose only used names and alias metadata, never the workspace catalog or CDN URLs. The proxy binds each original emoji name to the current post, follows at most 16 aliases and four URL hops, and accepts only Slack's emoji CDN/legacy emoji path, verified raster formats, and 1 MiB per emoji. The CDN receives no bot token. Up to 64 unique names and 256 inline occurrences are rendered, with three shared concurrent image requests.
- Profile photos expose only an availability flag. The authenticated proxy derives the current post author's `image_72` (or a small-size fallback) from Slack's user profile or bot icons, verifies the returned user ID, and accepts only exact Slack avatar CDN hosts (`avatars.slack-edge.com`, `a.slack-edge.com`), raster bytes, and 1 MiB. Caller-supplied URLs/user IDs are ignored. Photo requests share the three-worker limit and never send the bot token to the CDN.
- Responses use `private, no-store`; browser image/emoji URLs are revoked on refresh, logout, workspace-access revocation, and page exit. Access errors clear previously displayed private content. A revoked Slack membership can take up to the 30-second server cache plus the next homepage refresh to disappear.

## Files and checks

- `assets/home-slack.js` and `assets/home-slack.css`: homepage widget.
- `supabase/functions/hq-slack-general/index.ts`: authenticated Slack API endpoint and image proxy.
- `supabase/config.toml`: function configuration.
- `tests/home-slack.test.cjs` and `tests/slack-general.test.cjs`: frontend and backend regression tests. Run `node --test tests/*.test.cjs`.

`CONNECTION_REQUIRED` means missing secrets, a revoked token, missing scopes, wrong workspace/channel, or a bot that has not joined the channel. `ACCESS_DENIED` means the viewer lacks HQ approval or the required Slack identity/membership. Neither error exposes Slack credentials or raw provider responses.

Supabase **Edge Functions → hq-slack-general → Logs** records fixed setup reason tags. For example, `SLACK_API_ERROR` with method `conversations.info` and error `missing_scope` means the installed token lacks the channel-read permission. Check **Bot Token Scopes** and reinstall the app after changing scopes; update `SLACK_BOT_TOKEN` if Slack issues a new token. Diagnostics never include secret values, user/channel IDs, message content, or raw provider responses. Surrounding whitespace in the three Slack secret values is ignored.

References: [Slack channel history](https://docs.slack.dev/reference/methods/conversations.history/), [Slack file metadata](https://docs.slack.dev/reference/methods/files.info/), [Slack custom emojis](https://docs.slack.dev/reference/methods/emoji.list/), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).
