# Repository Workflow

- After completing a requested code change, run the relevant checks before creating a commit.
- When checks pass, automatically create a local Git commit containing only the files changed for that request.
- Do not push to a remote repository automatically. Push only when the user explicitly asks.
- Preserve unrelated user changes and never use force-push, hard reset, destructive cleanup, or automatic conflict resolution.
