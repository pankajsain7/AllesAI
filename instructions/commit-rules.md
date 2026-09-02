# Agent Commit Rules

## Git identity
- `user.name = pankajsain7` / `user.email = techypankaj@gmail.com`
- Verify with `git config user.name` and `git config user.email` before pushing.

## Commits
- Split logically separate changes into individual commits.
- Use imperative-style messages with a scope: `feat:`, `fix:`, `chore:`, etc.
- Avoid vague messages like `update stuff` or `changes`.

## Before push
- Never push to main branch directly. For every request to push or publish work:
  1. Create a descriptively named feature branch from the current main branch.
  2. Commit only the intended, verified changes.
  3. Push the feature branch to `origin` using the `pankajsain7` GitHub account.
  4. Create a pull request targeting `main`.
  5. Merge the pull request into `main` after its checks pass, then report the merge commit/PR URL.
- Check `git status` and `git log --oneline`.
- Confirm branch and remote are correct.
- Check `.env*` files before every push and make sure no secrets, API keys, or tokens are staged or mentioned in the commit.
- Push, create PRs, and merge only with the `pankajsain7` account. Authenticate GitHub CLI/API calls from the `github_pat_token` value in `.env.local`; never print, log, stage, commit, or paste the token into a command/history.
- If the configured PAT lacks the scope required to create or merge a pull request, stop and report the exact missing scope. Do not substitute another account or bypass the feature-branch/PR workflow.
