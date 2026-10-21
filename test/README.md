# E2E tests

The e2e tests boot the real Nest app (same global setup as `main.ts`) against a real PostgreSQL
database and **TRUNCATE all tables between tests**. They refuse to run unless the database name
ends with `_test`. Never point them at production.

```bash
# 1. A throwaway Postgres 16, e.g. with Docker:
docker run -d --name domera-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=domera_test -p 127.0.0.1:55432:5432 postgres:16-alpine

# 2. Apply the migrations (this also checks they work on an empty database)
DATABASE_URL=postgresql://test:test@127.0.0.1:55432/domera_test npx prisma migrate deploy

# 3. Run
E2E_DATABASE_URL=postgresql://test:test@127.0.0.1:55432/domera_test npm run test:e2e
```

| File | Covers |
|---|---|
| `auth.e2e-spec.ts` | register, login, inactive users, invalid/expired/forged tokens, refresh rotation and concurrent reuse, logout, `/auth/me`, RBAC |
| `conversations.e2e-spec.ts` | participants vs non-participants, duplicates, unread counts, mark-as-read idempotency, read receipts, device tokens |
| `properties.e2e-spec.ts` | ownership, filters/pagination, images (delete one keeps the rest, path traversal), uploads, favorites |
| `throttle.e2e-spec.ts` | login brute-force limit (429) |
