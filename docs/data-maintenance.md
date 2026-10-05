# Data maintenance

Migration `0024_retired_invites_cleanup.sql` drops only `chat_invites`. Invitation links are retired; their authenticated API routes still return `410 CHAT_INVITES_REMOVED` without reading that table. Keep the earlier migrations so a fresh database can apply the complete migration chain.

The existing 15-minute scheduled maintenance also clears temporary authentication and request records. It removes used or expired login and chat WebAuthn challenges, expired account write proofs, used or expired WebSocket and device approval tickets, elapsed email OTP cooldowns, previous chat rate-limit windows and the retired `invite` action, and elapsed 30-second AI cooldowns. Each run captures one clock value and retains active challenges, proofs, tickets and cooldowns. An exhausted write proof stays until expiry because its final in-flight request may still read credential metadata. The shared AI cooldown table and request reservation logic remain required.

This cleanup does not remove published learning resources, import records, practice history, retained chat identities, encrypted vaults or wrappers, active credentials, sync events or compatibility tables. Existing message, attachment and report retention rules continue to apply. AI hint generation events remain available for their existing reservation and failure-handling logic.

Before destructive database maintenance or an explicitly requested account deletion, export the production D1 database into a private directory outside the repository and verify that the export can be loaded and passes `PRAGMA foreign_key_check`. Never commit database exports, account tokens or provider credentials. Test the migration and account lifecycle against local fixtures before applying changes remotely.

Account deletion must remove the linked Supabase Auth identity as well as the website account. It also needs to handle email-only authentication records and chat attachment ownership before deleting the user, rather than relying solely on foreign-key cascades. Preserve remaining members' identities and shared chat data; remove the deleted account's access and notify remaining members through the normal chat lifecycle. Keep private attachment deletion retryable if object storage is unavailable.

Run `npm run check` before deployment. Apply new D1 migrations before deploying the Worker and static assets. Verify the retired table is absent, active records remain usable, the requested account no longer exists, and the production database still passes its foreign-key check.
