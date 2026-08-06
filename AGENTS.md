# Repository Workflow

- After completing a requested code change, run the relevant checks before creating a commit.
- When checks pass, automatically create a local Git commit containing only the files changed for that request.
- After the local commit succeeds, automatically push the checked commit to the configured remote branch when the working tree is clean and the branch can fast-forward safely.
- Before an automatic push, show a short summary of the commits and files to be pushed. Stop instead when the remote is ahead, branches have diverged, credentials are unavailable, or the remote is not clearly the intended repository.
- Preserve unrelated user changes and never use force-push, hard reset, destructive cleanup, or automatic conflict resolution.
