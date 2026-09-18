# Deployment

The app is designed for a single trusted host (see `SECURITY.md`). This
documents the reference deployment shape so it isn't tribal knowledge.

## Processes

Two user-level systemd units (templates in [`systemd/`](systemd/)):

| Unit | Runs | Port |
|---|---|---|
| `mp-api.service` | `tsx watch src/index.ts` in `server/` | `PORT` from `server/.env` |
| `mp-web.service` | `npm run dev -- --host` in `client/` | 5173 |

Both use `Restart=always` and start at boot via `WantedBy=default.target`
(requires `loginctl enable-linger <user>` so user units run without a login
session). Logs go to the user journal: `journalctl --user -u mp-api`.

`tsx watch` doubles as the deploy mechanism: a `git pull` restarts the API
automatically; Vite hot-reloads the client.

## Requirements on the host

- Node 22+, npm. PostgreSQL 16 reachable at the `DATABASE_URL` in
  `server/.env` (not committed — see `server/.env.example`).
- Claude Code login for the unit's user (`claude login`, interactive).
  Expired login surfaces as a descriptive error from the parse/chat routes.
- The Agent SDK's platform binary resolves via `server/src/claude/binaryResolver.ts`
  (libc-aware; immune to the musl-package npm quirk).

## Deploying a change

```bash
git pull                                   # tsx watch restarts the API
npm install                                # only when dependencies changed
npx prisma migrate deploy                  # only when migrations changed
# one-off data scripts a release calls for (each supports --dry-run):
#   npx tsx src/scripts/seedIngredientDensities.ts
#   npx tsx src/scripts/cleanupTags.ts
```

Take a `pg_dump` before schema migrations or data scripts.

## Setting up on a fresh host

```bash
git clone <repo> && cd AgenticMealPlanner && npm install
cp server/.env.example server/.env         # fill in DATABASE_URL, PORT
cd server && npx prisma migrate deploy
loginctl enable-linger $USER
cp docs/ops/systemd/*.service ~/.config/systemd/user/   # edit paths first
systemctl --user daemon-reload
systemctl --user enable --now mp-api mp-web
claude login                               # interactive, once
```

## Known future work

Issue #39: serve a built client from the API (one process/port, minified
assets) instead of the Vite dev server.
