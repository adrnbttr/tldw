# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
private reporting: **Security → Report a vulnerability** on the repository, or open a
minimal private channel with the maintainer.

Include what you found, how to reproduce it, and the potential impact. You'll get an
acknowledgement as soon as possible.

## Scope & design notes

tldw runs entirely client-side with the user's own API keys and has no backend, so
the attack surface is small. A few things worth knowing:

- **API keys** live in `chrome.storage.local` and are only ever sent to the provider
  they belong to (OpenRouter, or the transcription provider). They are never logged
  or transmitted elsewhere.
- **No arbitrary code execution.** The rendered summary Markdown is produced by the
  extension itself and is escaped before display; it is never treated as trusted
  HTML from a third party.
- **No DRM circumvention.** Encrypted media is refused with a typed `MEDIA_PROTECTED`
  error rather than any bypass attempt.
- **Broad host permission** (`<all_urls>`) is required to detect players and fetch
  captions/media on any site the user visits; it is used only on user action.

If you believe any of the above is violated, that's exactly the kind of report we
want.
