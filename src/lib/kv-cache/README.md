# kv-cache/

Soul v9.0 KV-Cache subsystem. Session snapshots, progressive loading, Forgetting Curve GC, vector search.

## Architecture

All storage backends implement the `StorageAdapter` interface (defined in `storage-adapter.ts`).
- `SnapshotEngine` — JSON file-based storage (default)
- `SqliteStore` — SQLite storage via sql.js (WASM, no native deps)
- `TierManager` — Hot/Warm/Cold tiered wrapper over any StorageAdapter
- `PerfMonitor` — Self-tuning GC via query latency tracking (perf-aware retention)
