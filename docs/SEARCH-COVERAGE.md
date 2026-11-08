# Search coverage

Nexonic Trace separates three user-selected search areas. Profile APIs are a set of directly verified connectors, not the limit of web discovery.

- **Profiles:** 30 official public APIs (see [SOURCE-RESEARCH.md](SOURCE-RESEARCH.md)). Quick/Deep/Comprehensive check 10/20/30 sources, highest priority first. Positive confirmation requires structured account signals; the same username does not establish common ownership.
- **Web:** Brave's broader public-web index, for usernames or emails. At most 20/60/100 results across 1/3/5 pages, with all-region (`country=ALL`) results, spell correction disabled for exact identifiers, deduplication, bounded responses and one-second page pacing. Additional pages are requested only when Brave explicitly reports more results. Cancellation or a later-page failure retains partial results with a warning. An indexed mention is not a verified account. A permitted Brave Search API plan/key is required.
- **Dark web:** licensed DarkOwl Vision Search API, for usernames or emails the user owns or is authorized to check. Exact username terms and the dedicated email filter avoid broad wildcard searches. At most 20/60/100 metadata records, with paced pagination and cancellation. The provider's collection includes Tor/I2P and darknet-adjacent sources; its index and subscription determine actual coverage. The app does not crawl hidden services itself or claim all dark-web content is searchable.

DarkOwl requests `detail=nonbody`, `req=false`, `highlight=false`, `similar=false`. It authenticates using the provider's documented HMAC-SHA1 protocol, not plaintext credentials in URLs. Session-only public/private API keys are zeroized on removal or shutdown where practicable; authorization headers are marked sensitive for diagnostics. Only opaque record IDs, a fixed allowlist of network labels, and parsed collection dates enter results/history/reports. Other metadata fields, titles, document bodies, snippets, URLs, download links and third-party entity arrays are ignored. Unexpected content never becomes a confirmed account or a verified credential pair. No leaked document endpoint is called. Review an opaque record ID within your licensed provider account; the app does not invent a document link or open raw onion/download URLs.

## Exposure checks

**Known email breaches:** an authorized licensed Have I Been Pwned query. Only provider-verified, non-sensitive breach records are displayed. Data classes can indicate that passwords were present in a breach; they do not reveal a password or establish that a particular password is currently usable.

**Stealer logs:** HIBP's `stealerLogsByEmail` returns associated service domains only. It requires a Pro plan and provider-verified control of the email's domain. A user checkbox does not replace that verification. Missing entitlement/ownership produces an explanation, not an empty safety result. Returned domains are validated and deduplicated. No passwords, stolen session tokens or complete credential pairs are requested.

**Password prevalence:** Pwned Passwords uses a local hash and five-character prefix lookup, with padding and local suffix comparison. The plaintext password and full hash never leave the device. This check remains separate from email and username discovery and cannot establish an exposed email/password pair.

No index covers the entire internet, every private forum, unindexed pages, or every Tor/I2P service. No results means only that the chosen source returned no match at that time. No login attempts, credential testing, CAPTCHA bypass, signup/reset probes or private forum access are performed.

## Privacy and acceptance

Provider subscriptions must permit the intended queries, optional local retention and exports. Cost consent is required when connecting a key; search permission is required for dark-web and email exposure checks. Queries go directly from the device to selected providers. History remains off by default; dark-web exports start with redaction selected. Keys and passwords never enter history or reports. Deleting local data cancels active checks and clears provider keys. Browser previews perform no live queries.

Automated fixtures verify request construction, HMAC against an independent test vector, pagination contracts, cancellation/partial results, deduplication, malicious metadata disposal, redaction, absent credentials and authorization. These are contract/interface checks. Credentialed Brave, DarkOwl and Pro stealer-log acceptance requires licensed accounts; no real-user credentialed acceptance has been claimed. The public HIBP integration fixture is not shown as real exposure.

Official contracts checked 8 November 2026: [Brave pagination](https://api-dashboard.search.brave.com/app/documentation/web-search/query), [DarkOwl API](https://docs.api.darkowl.com/), [DarkOwl authentication](https://support.darkowl.com/knowledge-base/calculating-authorization-headers), [HIBP v3 and stealer-log requirements](https://haveibeenpwned.com/API/v3). Integrations were written independently from those contracts.
