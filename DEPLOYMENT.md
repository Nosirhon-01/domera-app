# DOMERA backend — production deployment (PM2)

Server: `162.35.179.239` · directory `/root/domera-app` · PM2 process `domera-api` · port `3000` · prefix `/api`

Steps are grouped by risk:

- 🟢 **read-only** — inspects only, safe to run any time
- 🟡 **changes code/process** — no database writes
- 🔴 **changes the production database** — run only after the read-only checks match what is described here

Never paste passwords, `.env` contents or tokens into chat. Command output below contains no secrets
unless stated otherwise.

---

## 0. Load the database URL into the shell (without printing it)

```bash
cd /root/domera-app
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')"
export PGURL="${DATABASE_URL%%\?*}"   # psql/pg_dump do not accept Prisma's ?schema=public
```

## 1. 🟢 Inspect the current state

```bash
git status --short && git log --oneline -1 && git rev-parse HEAD > /root/domera-previous-commit.txt
df -h / && free -m
node -v
pm2 describe domera-api | grep -E 'status|script path|exec cwd|node.js version'
psql "$PGURL" -c '\dt'
psql "$PGURL" -c '\d users'
psql "$PGURL" -tAc "SELECT to_regclass('public._prisma_migrations')"
psql "$PGURL" -tAc "SELECT 'users',count(*) FROM users UNION ALL SELECT 'properties',count(*) FROM properties UNION ALL SELECT 'property_images',count(*) FROM property_images UNION ALL SELECT 'favorites',count(*) FROM favorites UNION ALL SELECT 'refresh_tokens',count(*) FROM refresh_tokens" | tee /root/domera-counts-before.txt
```

What to look for:

| Check | Expected | If different |
|---|---|---|
| `git status` | clean | stop, keep the changes (`git stash`) and ask |
| free disk | > 1 GB | free space first |
| `node -v` | v18.18+ (v20 LTS recommended) | upgrade Node first |
| `\d users` has `avatar`, `bio` | **either is fine** | if missing, the currently deployed code (which reads them) fails on every user query — login is likely broken right now and this deploy fixes it |
| `_prisma_migrations` | empty (no table) | if it exists, stop and send the output of `npx prisma migrate status` |
| script path | `.../dist/src/main.js` (old build layout) | see step 6 |

## 2. 🟢 Back up the database (verified)

```bash
mkdir -p /root/backups && chmod 700 /root/backups
BACKUP=/root/backups/domera_db_$(date +%F_%H%M).dump
pg_dump "$PGURL" -Fc -f "$BACKUP" && chmod 600 "$BACKUP"
ls -lh "$BACKUP"
pg_restore --list "$BACKUP" | grep -E 'TABLE DATA' 
```

The listing must show `TABLE DATA` for `users`, `properties`, `property_images`, `favorites`, `refresh_tokens`.
Do not continue without a verified backup. Keep backups out of the git repository.

## 3. 🟡 Get the code

After the PR is merged into `main`:

```bash
git fetch origin
git pull --ff-only origin main
git log --oneline -3
```

## 4. 🟡 Install and build (the running app is not affected yet)

```bash
npm ci
npx prisma generate
npm run build
ls -l dist/main.js
```

`dist/main.js` must exist. Older builds wrote `dist/src/main.js`; that path disappears with this build.

## 5. 🟢 Review the schema change (read-only)

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /root/domera-schema-diff.sql
grep -E '^(CREATE|ALTER|DROP)' /root/domera-schema-diff.sql
```

Expected — **only** these statements (the `avatar` line is absent if the columns already exist):

```
CREATE TYPE "DevicePlatform" ...
ALTER TABLE "users" ADD COLUMN "avatar" TEXT, ADD COLUMN "bio" TEXT   (only if missing)
CREATE TABLE "conversations" / "conversation_participants" / "messages" / "device_tokens"
CREATE INDEX / CREATE UNIQUE INDEX on those new tables
ALTER TABLE <new table> ADD CONSTRAINT ..._fkey FOREIGN KEY ...
```

**Stop** if the output contains `DROP`, `ALTER COLUMN`, `ALTER TYPE`, `RENAME`, or any change to
`users`/`properties`/`property_images`/`favorites`/`refresh_tokens` other than adding `avatar`/`bio`.
That would mean production differs from the baseline (`prisma/migrations/0_init`) — send the file
`/root/domera-schema-diff.sql` (it contains no secrets) for review.

## 6. 🔴 Apply migrations — requires approval

The live database predates migration tracking. Step 6a records that the baseline (`0_init`, the five
existing tables) is already present **without running it**. Step 6b runs only the additive migration
`20261021120000_add_profile_chat_device_tokens` (idempotent: `IF NOT EXISTS` everywhere, no DROP).

```bash
npx prisma migrate resolve --applied 0_init        # 6a: creates _prisma_migrations, marks baseline
npx prisma migrate deploy                          # 6b: adds avatar/bio (if missing) + 4 new tables
npx prisma migrate status                          # expect: Database schema is up to date
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code && echo NO DRIFT
```

`domera_user` needs `CREATE` permission on schema `public` (it already created the existing tables).

## 7. 🟡 Restart

Check the script path from step 1:

```bash
# If it already was dist/main.js:
pm2 restart domera-api --update-env

# If it was dist/src/main.js (old build layout) — re-create the process from ecosystem.config.js.
# First make sure no app settings live only inside PM2 (the app reads .env, so normally none do).
# This prints variable NAMES only, never values:
pm2 env "$(pm2 id domera-api | tr -dc '0-9')" | cut -d: -f1 | grep -E 'DATABASE|JWT|PORT|API_PREFIX|CORS|ADMIN|FIREBASE'
# Any name listed above must also be in .env before continuing.
pm2 delete domera-api
pm2 start ecosystem.config.js
pm2 save
```

## 8. 🟢 Verify

```bash
pm2 status domera-api
pm2 logs domera-api --lines 50 --nostream
curl -s http://localhost:3000/api/health            # status "ok", database "UP" (HTTP 503 if DB is down)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/docs     # 200 (or 404 if SWAGGER_ENABLED=false)
curl -s http://localhost:3000/api/properties?limit=1 | head -c 300; echo

# Login + protected endpoints with an account you own (password is read silently, not stored in history)
read -p 'email: ' EMAIL; read -s -p 'password: ' PASS; echo
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken'); unset PASS
curl -s http://localhost:3000/api/auth/me -H "Authorization: Bearer $TOKEN" | head -c 300; echo
curl -s http://localhost:3000/api/conversations -H "Authorization: Bearer $TOKEN" | head -c 300; echo
unset TOKEN

# Existing data intact (compare with step 1)
psql "$PGURL" -tAc "SELECT 'users',count(*) FROM users UNION ALL SELECT 'properties',count(*) FROM properties UNION ALL SELECT 'property_images',count(*) FROM property_images UNION ALL SELECT 'favorites',count(*) FROM favorites UNION ALL SELECT 'refresh_tokens',count(*) FROM refresh_tokens" | diff /root/domera-counts-before.txt - && echo "COUNTS UNCHANGED"
```

`refresh_tokens` may legitimately grow if someone logged in during the deploy.

## 9. Rollback

### Application code (🟡)

```bash
cd /root/domera-app
git checkout "$(cat /root/domera-previous-commit.txt)"
npm ci && npx prisma generate && npm run build
pm2 delete domera-api
pm2 start dist/src/main.js --name domera-api     # old commits build to dist/src/main.js
pm2 save
```

The old code works with the migrated database: the migration only added nullable columns and new tables.

### Database (🔴 — normally NOT needed, requires approval)

The schema change is additive, so rolling back the code is enough. Only if the new tables must go:

```sql
-- Deletes all chat messages and device tokens created after the deploy
DROP TABLE IF EXISTS device_tokens, messages, conversation_participants, conversations;
DROP TYPE IF EXISTS "DevicePlatform";
DELETE FROM _prisma_migrations WHERE migration_name = '20261021120000_add_profile_chat_device_tokens';
```

Full restore from the backup (overwrites everything written since the backup):

```bash
pg_restore --clean --if-exists --no-owner -d "$PGURL" /root/backups/<file>.dump
```

---

## Optional settings (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_PATH` / `FIREBASE_SERVICE_ACCOUNT_BASE64` | unset (push off) | FCM push notifications |
| `AUTH_RATE_LIMIT` | `10` | login/register attempts per IP per minute (refresh: 3×) |
| `SWAGGER_ENABLED` | `true` | set `false` to hide `/api/docs` |
| `TRUST_PROXY` | unset | set `true` only behind nginx/Caddy (otherwise rate limits see the proxy IP) |
| `CORS_ORIGINS` | `*` | comma-separated web origins; the mobile app does not need CORS |
