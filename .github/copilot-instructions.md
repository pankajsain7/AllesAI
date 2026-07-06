# Agent Instructions — Entry Point

**This file is auto-loaded by GitHub Copilot on every task.**
All other agents (Cursor, Claude, Windsurf, etc.) must also read this file at session start.

## Mandatory: Read the instructions folder

Before doing anything else on any task, read every file in the `instructions/` folder:

- `instructions/agent-behavior.md` — rules for how to behave, ask questions, verify work, and communicate
- `instructions/commit-rules.md` — rules for git identity, commit grouping, commit messages, and pushing

These files are the source of truth. Every rule in them applies to every task, every tool, every agent.

## Mandatory: ponytail-first execution

For every task, apply `ponytail` lazy-code reasoning before any implementation action (code edits, architecture decisions, dependency changes, or non-trivial plans).
