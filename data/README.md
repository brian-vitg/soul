# Soul — Data Directory

This directory stores all runtime data. It is auto-created on first use.

- `memory/` — Shared brain files (read/write via `n2_brain_read`/`n2_brain_write`)
- `projects/` — Per-project state (soul-board, ledger, file-index)
- `kv-cache/` — Session snapshots, embeddings, and backups

All contents are gitignored except this README and `_template/`.
