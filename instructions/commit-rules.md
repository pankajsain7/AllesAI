# Agent Commit Rules

## Git identity
- `user.name = pankajsain7` / `user.email = techypankaj@gmail.com`
- Verify with `git config user.name` and `git config user.email` before pushing.

## Commits
- Split logically separate changes into individual commits.
- Use imperative-style messages with a scope: `feat:`, `fix:`, `chore:`, etc.
- Avoid vague messages like `update stuff` or `changes`.

## Before push
- Never push to main branch directly; create a feature branch and push to that only.
- Check `git status` and `git log --oneline`.
- Confirm branch and remote are correct.
- Check `.env*` files before every push and make sure no secrets, API keys, or tokens are staged or mentioned in the commit.
- Push only with the `pankajsain7` account.
