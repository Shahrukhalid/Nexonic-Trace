# Profile source research

Last run: 8 November 2026. Every candidate was queried live with a known public account and with a username that cannot exist (`zq9xv7nonexist4k2`). A source is accepted only when both answers are structured JSON from an official public API, the found response carries the username plus a provider account identifier, and the missing response is distinct and documented. HTML pages, scraping, login-only or keyed APIs, and sources that block automated clients are excluded.

## Accepted (30)

| Source | Found signal | Missing signal |
| --- | --- | --- |
| GitHub | `login`, numeric `id`, `html_url`, `type` | 404 `message: Not Found` |
| GitLab, GNOME GitLab, KDE Invent | `[0].username`, `[0].id`, `[0].web_url` | 200 `[]` |
| Hacker News | `id` (exact case), `created` | 200 `null` |
| Mastodon: mastodon.social, fosstodon.org, infosec.exchange, mstdn.social | `username`, numeric-string `id`, `url` | 404 `Record not found` |
| Bluesky | `handle` = `name.bsky.social`, `did:` identifier | 400 `Profile not found` |
| DEV Community | `username`, `id`, `type_of: user` | 404 `not found` |
| Hugging Face | `user`, `_id`, `type: user` | 404 `does not exist` |
| Wikipedia (English), Fandom | `query.users[0].name` (MediaWiki case rules), `userid` | 200 `missing` |
| Wikimedia global account | `globaluserinfo.name`, `id` | 200 `missing` |
| Lichess | `username`, `id` = query, `createdAt`, `url` | 404 `Not found` |
| Chess.com | `username`, `player_id`, `url` | 404 `not found` |
| Codeberg, Gitea | `login`, `id`, `html_url` | 404 `does not exist` |
| Lemmy: lemmy.world, lemmy.ml, programming.dev | `person.name`, `person.id`, `actor_id` | 404 `couldnt_find_person` |
| Codeforces | `result[0].handle`, registration time, `status: OK` | 400 `not found` |
| crates.io | `user.login`, `user.id` | 404 `Not Found` |
| Speedrun.com | `data[0].names.international`, `id`, `weblink` (via `?lookup=`; the `/users/{name}` path redirects) | 200 `data: []` |
| Hex | `username`, `inserted_at` | 404 `not found` |
| Bitbucket (workspaces) | `slug`, `uuid`, `type: workspace`, html link | 404 `No workspace` |
| Codewars | `username` (exact case), `id` | 404 `not found` |
| Mixcloud | `username`, `key`, `url` (served as `text/javascript`, parsed strictly as JSON) | 404 `ResourceNotFoundException` |
| Monkeytype | `data.name`, `addedAt`, `Profile retrieved` | 404 `User not found` |

Findings that shaped the engine:
- Speedrun.com redirects `/users/{name}` to an ID URL. Redirects are never followed, so the rule uses `?lookup=` instead (found by the live drift check on its first run).
- MediaWiki usernames are case-sensitive after the first letter: `jimbo_wales` is a different account from `Jimbo_Wales`. Wiki sources use exact MediaWiki normalisation.
- Hacker News and Codewars are case-sensitive; the others compare case-insensitively.
- Missing accounts are reported in five different ways (404 message, 400 message, `null`, `[]`, a `missing` key). Each rule declares its own; an unexpected error body stays inconclusive.

Captured responses for all 30 are regression fixtures in `crates/trace-core/tests/fixtures/connectors.json`.

## Rejected or deferred

| Candidate | Reason |
| --- | --- |
| Keybase | A nonexistent username returns `INPUT_ERROR: bad list value`, the same as invalid input. Ambiguous. |
| Discogs | Needs a valid known account for confirmation; deferred. |
| openSUSE wiki, Framagit | Sample accounts did not resolve; deferred until verified. |
| npm | User endpoint requires authentication. |
| Kitsu | Requires the JSON:API media type; deferred. |
| Reddit, Docker Hub, RubyGems, Minecraft, Duolingo, Launchpad, Lobsters, SourceForge, Scratch, Glitch, Wattpad, Pixelfed, Forgejo (next), Disroot, Debian Salsa, freedesktop GitLab, Arch Wiki, Gitee, Hachyderm | Could not be verified from the research browser (cross-origin policy). They are the next verification batch, to be checked by a live CI job rather than assumed to work. |

## Path to 100

1. Done: `.github/workflows/sources.yml` queries every source weekly (and on rule changes or on demand) and opens an issue when a provider's responses drift. Run it locally with `NEXONIC_LIVE=1 cargo test -p trace-core --test live_sources -- --nocapture`.
2. Verify the deferred batch above with that job (about 20 sources).
3. Add more instances of already-supported software (GitLab, Gitea/Forgejo, Mastodon, Lemmy, MediaWiki), which reuse proven rule shapes, then new single-site APIs. Each addition needs captured found and missing fixtures.
