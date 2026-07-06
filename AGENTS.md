# Agent Instructions — Entry Point

**This file is read by OpenAI Codex at session start.**

## Mandatory: Read the instructions folder

Before doing anything else on any task, read every file in the `instructions/` folder:

- `instructions/agent-behavior.md` — rules for how to behave, ask questions, verify work, and communicate
- `instructions/commit-rules.md` — rules for git identity, commit grouping, commit messages, and pushing

These files are the source of truth. Every rule in them applies to every task, every tool, every agent.
Secrets may live in local `.env*` files for local use only. Do not print, commit, or include secret values in remotes, logs, or docs.

## Mandatory: ponytail-first execution

For every task, apply `ponytail` lazy-code reasoning before any implementation action (code edits, architecture decisions, dependency changes, or non-trivial plans).
