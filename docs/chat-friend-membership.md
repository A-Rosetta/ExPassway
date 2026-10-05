# Friend verification and discussion membership

Apply `0025_chat_friend_requests.sql` before deploying the Worker and static assets. The migration preserves existing accepted contacts, adds a separate friend-request table, and distinguishes voluntary Global Discussion departures from administrator removals.

Adding someone by chat user ID sends a pending request with an optional introduction of up to 500 characters. Only the recipient can accept or reject it; only the sender can cancel it. Acceptance creates both accepted contact rows together. Pending requests grant no contact-key or direct-conversation access. Sending a request in the opposite direction does not automatically accept an existing request.

Introductions are friend-request metadata stored as text and visible to the recipient and the service. The request form explains this before submission. Direct and group conversation messages continue to use the existing end-to-end encryption protocol.

Global Discussion remains the first sidebar panel after a member leaves. A voluntary leaver can select Join again, which queues the account for an administrator's encryption update. Website administrators can remove ordinary discussion members. Such a removal persists as a moderation exclusion, so the removed account cannot rejoin itself or be added by automatic reconciliation. Administrators cannot remove themselves or other administrators through this action.

Departures and removals require an encryption epoch update before further messages can be sent. Rejoining accounts receive a new epoch envelope when an unlocked administrator reconciles the discussion. The server continues to enforce active membership and per-epoch envelope access. Group ownership permissions remain distinct even though owner and administrator badges both display `Admin`.

Run `npm run check` for API, authorization, crypto, migration, and asset-build checks. Run `npm run test:chat-browser` for the rendered chat regressions, including friend verification and discussion membership. Browser tests use isolated local data and replace the operating-system Passkey ceremony; they do not change production accounts.
