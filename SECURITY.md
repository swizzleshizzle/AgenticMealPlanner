# Security

## Threat model

This application is designed for a **trusted single-network deployment** (e.g., a small group of users on the same [Tailscale](https://tailscale.com/) tailnet or LAN). It is **not** hardened for the public internet.

Specifically:

- **No application-layer authentication.** Every REST endpoint is unauthenticated. Anyone who can reach the server's port can read and modify all data — meals, plans, pantry, shopping list, receipts — and trigger LLM calls that consume API credits.
- **No authorization model.** There is no concept of users, ownership, or per-record access control.
- **No CSRF protection** beyond default SameSite cookie behavior (which doesn't apply here because there are no auth cookies).
- **Google Calendar OAuth tokens** are written to `calendar-tokens.json` in the server's working directory as plaintext JSON. Anyone with read access to that file gets the operator's Calendar credentials.
- **The agent endpoints execute LLM-driven tool calls** that mutate the database (creating/updating/deleting meals, plans, pantry batches, etc.) on behalf of whoever sent the request. There is no human-in-the-loop check on the server side.

## Deployment guidance

**Do not expose this app to the public internet without putting an auth layer in front of it.** Options:

- Run it behind Tailscale (the original design), Cloudflare Tunnel + Access, Tailscale Funnel + Access controls, or an SSO proxy like [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/).
- Or fork it and add authentication middleware to `server/src/index.ts` and a session/identity model to the schema. This is a non-trivial fork.

Bind the Express server to `127.0.0.1` (or your tailnet interface) rather than `0.0.0.0` whenever possible.

## Secrets and credentials

- **`server/.env`** holds `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. It is gitignored — do not commit it. See `server/.env.example` for the shape.
- **`calendar-tokens.json`** is written by the Google OAuth callback. It is gitignored. Treat its contents like any other long-lived OAuth token.
- **LLM credentials.** The server's agent endpoints (chat, recipe parser, meal planner, receipt parser) call Claude via `@anthropic-ai/claude-agent-sdk`. By default the SDK reads `~/.claude/.credentials.json` on the host (set up via `claude login`); alternately you can export `ANTHROPIC_API_KEY` in `server/.env`. Either way, **API usage is billed to whoever set those credentials.** Run the server only on a host you control.
- **`docker-compose.yml`** ships with a local-only Postgres password of `mealplanner` for `docker-compose up` convenience. Rotate it (and the matching `DATABASE_URL` in `server/.env`) before any deployment that is not on `localhost`.

## Reporting a vulnerability

This is a hobby/personal project. If you find something, open a GitHub issue (preferred for non-sensitive findings) or — for anything you'd rather not disclose publicly — open a [private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on the repo.

No bug-bounty program; no formal SLA on response time.
