# Security Policy

## Supported versions

STELLARIS-7 is under active development and follows a rolling release model on
`master`. Only the latest commit is officially supported.

| Version | Supported |
| --- | --- |
| latest (`master`) | :white_check_mark: |
| older tags | :x: |

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities. Report
privately instead so maintainers can fix and ship before disclosure.

- **Preferred**: open a private advisory at
  `https://github.com/genpozi/starship-hud/security/advisories/new`
- **Email fallback**: `monkeycode-ai@chaitin.com` — prefix the subject with
  `[SECURITY]`.

You should receive an acknowledgment within 48 hours. If you don't, follow up
on the advisory or via email.

### What to include

- Affected version / commit hash
- Steps to reproduce (as minimal as possible)
- Impact description (what an attacker can do)
- Proposed fix, if you have one

### What we ask

- Give maintainers a reasonable window (90 days is standard) before public
  disclosure.
- Do not test against live deployed instances without authorization.

## Security posture

This project ships an **operator console**, not a public-facing SaaS. It is
intended to run on a trusted host, behind your own auth, with operator-supplied
credentials. Treat the following as required practices:

- **Never** commit `.env` or real credential values. `.env.example` contains
  placeholders only.
- The orbit server binds `localhost` by default. If you expose it, put it
  behind a reverse proxy with TLS + authentication.
- Rotate `GITHUB_TOKEN`, `USER_HERMES_PASSWORD`, and LLM API keys on a
  schedule. Scope tokens to the minimum permissions required.
- Run the Docker image as the non-root `node` user (the shipped `Dockerfile`
  already does) and use the `orbit-data` volume for persistence.
- All state-derived strings are HTML-escaped on the client (`escapeHtml`); if
  you add a renderer, route untrusted data through it.
- Malformed JSON and out-of-range inputs return `400` with a JSON body; never
  leak stack traces to clients.
