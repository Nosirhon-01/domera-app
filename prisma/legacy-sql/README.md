# Legacy SQL (not applied by Prisma)

`20261007_add_avatar_bio_conversations_messages.sql` was a hand-written migration that only existed
locally (`prisma/migrations/` was gitignored, so it never reached the server). It is kept here for
reference only.

It is superseded by `prisma/migrations/20261021120000_add_profile_chat_device_tokens`, which is
generated from the Prisma schema, also creates `device_tokens`, and is safe to re-run.
Do not run this file against production.
