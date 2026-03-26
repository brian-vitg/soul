// Soul KV-Cache v8.0 — Orchestrator. Coordinates snapshot, compressor, and adapter.
const path = require('path');
const fs = require('fs');
const { logError, logInfo } = require('../utils');
const { SnapshotEngine } = require('./snapshot');
const { compress, decompress } = require('./compressor');
const { fromMcpSession, toResumePrompt, extractKeywords } = require('./agent-adapter');
const { createSession, migrateSession } = require('./schema');
const { extractAtLevel, autoLevel } = require('./token-saver');
const { TierManager } = require('./tier-manager');

/**
 * Creates the appropriate storage engine based on config.
 * @param {string} dataDir
 * @param {object} config
 * @returns {SnapshotEngine|import('./sqlite-store').SqliteStore}
 */
function createStorageEngine(dataDir, config) {
    const backend = config.backend || 'json';
    const snapshotDir = config.snapshotDir || path.join(dataDir, 'kv-cache', 'snapshots');
    let engine;

    if (backend === 'sqlite') {
        try {
            const { SqliteStore, initSqlJs } = require('./sqlite-store');
            const sqliteDir = config.sqliteDir || path.join(dataDir, 'kv-cache', 'sqlite');
            engine = new SqliteStore(sqliteDir);
            initSqlJs().then(() => {
                engine._ready = true;
            }).catch(e => {
                console.error(`[kv-cache] SQLite init failed: ${e.message}`);
            });
        } catch (e) {
            logError('kv-cache:sqlite', `SQLite unavailable (${e.message}), falling back to JSON`);
            engine = new SnapshotEngine(snapshotDir);
        }
    } else {
        engine = new SnapshotEngine(snapshotDir);
    }

    const tierConfig = config.tier;
    if (tierConfig) {
        return new TierManager(engine, tierConfig);
    }

    return engine;
}

/**
 * Main KV-Cache orchestrator.
 * Coordinates snapshot persistence, context compression, and session management.
 */
class SoulKVCache {
    /**
     * @param {string} dataDir - Soul data directory (config.DATA_DIR)
     * @param {object} config - KV_CACHE config section
     */
    constructor(dataDir, config = {}) {
        this.snapshot = createStorageEngine(dataDir, config);
        this.dataDir = dataDir;
        this.config = {
            backend: config.backend || 'json',
            compressionTarget: config.compressionTarget || 1000,
            maxSnapshotsPerProject: config.maxSnapshotsPerProject || 50,
            maxSnapshotAgeDays: config.maxSnapshotAgeDays || 30,
            tokenBudget: config.tokenBudget || {
                bootContext: 2000,
                searchResult: 500,
                progressiveLoad: true,
            },
        };

        // Embedding engine (optional, requires Ollama)
        this.embedding = null;
        this._embeddingReady = false;
        const embConfig = config.embedding;
        if (embConfig?.enabled) {
            const { EmbeddingEngine } = require('./embedding');
            this.embedding = new EmbeddingEngine(embConfig);
            this.embedding.isAvailable().then(ok => {
                this._embeddingReady = ok;
                if (ok) {
                    logInfo('kv-cache:embedding', `Embedding ready: ${embConfig.model} (${this.embedding.dimensions}d)`);
                } else {
                    logInfo('kv-cache:embedding', 'Embedding unavailable, falling back to keyword search');
                }
            }).catch(() => {
                this._embeddingReady = false;
            });
        }

        // Backup manager (optional)
        this._backup = null;
        this._backupTimer = null;
        const backupConfig = config.backup;
        if (backupConfig?.enabled) {
            const { BackupManager } = require('./backup');
            this._backup = new BackupManager(dataDir, backupConfig);

            const schedule = backupConfig.schedule || 'daily';
            if (schedule !== 'manual') {
                const intervalMs = schedule === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                this._backupTimer = setTimeout(() => {
                    this._runAutoBackup();
                    this._backupTimer = setInterval(() => this._runAutoBackup(), intervalMs);
                    if (this._backupTimer.unref) this._backupTimer.unref();
                }, 5 * 60 * 1000);
                if (this._backupTimer.unref) this._backupTimer.unref();
                logInfo('kv-cache:backup', `Auto-backup scheduled: ${schedule}`);
            }
        }
    }

    /**
     * Save a session snapshot with automatic compression.
     * @param {string} agent
     * @param {string} project
     * @param {object} sessionData
     * @returns {Promise<string>} Snapshot ID
     */
    async save(agent, project, sessionData) {
        const normalized = fromMcpSession({ agent, project, ...sessionData });

        if (normalized.context.summary) {
            const result = compress(normalized.context.summary, this.config.compressionTarget);
            normalized.keys = [...new Set([...normalized.keys, ...result.keys])];
            normalized.context.summary = result.compressed || normalized.context.summary;
        }

        const id = await this.snapshot.save(normalized);

        // Generate embedding in background (non-blocking)
        if (this._embeddingReady && this.embedding) {
            const text = this.embedding.snapshotToText(normalized);
            this.embedding.embed(text).then(vec => {
                if (vec.length > 0) this._storeEmbedding(project, id, vec);
            }).catch((e) => { logError('kv-cache:embed', e); });
        }

        return id;
    }

    /**
     * Load the most recent snapshot for a project.
     * @param {string} project
     * @param {object} options
     * @returns {Promise<object|null>}
     */
    async load(project, options = {}) {
        const snap = await this.snapshot.loadLatest(project);
        if (!snap) return null;

        // Forgetting Curve: track access
        if (snap.id && this.snapshot.touch) {
            this.snapshot.touch(snap.projectName || project, snap.id).catch(() => {});
        }

        const level = options.level || 'auto';
        const budget = options.budget || this.config.tokenBudget.bootContext;

        if (level === 'auto') {
            const result = autoLevel(snap, budget);
            snap._resumePrompt = result.prompt;
            snap._level = result.level;
            snap._promptTokens = result.tokens;
        } else {
            const result = extractAtLevel(snap, level);
            snap._resumePrompt = result.prompt;
            snap._level = result.level;
            snap._promptTokens = result.tokens;
        }

        return snap;
    }

    /**
     * Search across snapshots by keyword or semantic similarity.
     * @param {string} query
     * @param {string} project
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    async search(query, project, limit = 10) {
        if (this._embeddingReady && this.embedding) {
            return this._semanticSearch(query, project, limit);
        }
        return await this.snapshot.search(query, project, limit);
    }

    /**
     * Semantic search using Ollama embeddings.
     * @param {string} query
     * @param {string} project
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    async _semanticSearch(query, project, limit) {
        try {
            const queryVec = await this.embedding.embed(query);
            if (queryVec.length === 0) {
                return await this.snapshot.search(query, project, limit);
            }

            const allSnaps = await this.snapshot.list(project, 9999);
            const candidates = [];

            for (const snap of allSnaps) {
                const stored = this._loadEmbedding(project, snap.id);
                if (stored) {
                    candidates.push({ id: snap.id, vector: stored, snap });
                }
            }

            if (candidates.length === 0) {
                return await this.snapshot.search(query, project, limit);
            }

            const ranked = this.embedding.rankBySimilarity(queryVec, candidates, limit, 0.2);
            return ranked.map(r => {
                const snap = candidates.find(c => c.id === r.id)?.snap;
                return { ...snap, _score: r.score, _searchMode: 'semantic' };
            });
        } catch (e) {
            logError('kv-cache:semantic-search', e);
            return await this.snapshot.search(query, project, limit);
        }
    }

    /**
     * List snapshots for a project.
     * @param {string} project
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    async listSnapshots(project, limit = 10) {
        return await this.snapshot.list(project, limit);
    }

    /**
     * Garbage collect old snapshots.
     * @param {string} project
     * @param {number} maxAgeDays
     * @returns {Promise<{deleted: number}>}
     */
    async gc(project, maxAgeDays) {
        const age = maxAgeDays ?? this.config.maxSnapshotAgeDays;
        return await this.snapshot.gc(project, age, this.config.maxSnapshotsPerProject);
    }

    /**
     * Estimate token count for a text string.
     * @param {string} text
     * @returns {number}
     */
    estimateTokens(text) {
        if (!text) return 0;
        const cjkCount = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || []).length;
        const asciiCount = text.length - cjkCount;
        return Math.ceil(asciiCount / 4 + cjkCount / 2);
    }

    /**
     * Migrate JSON snapshots to SQLite for a project.
     * @param {string} project
     * @returns {object}
     */
    migrate(project) {
        if (this.config.backend !== 'sqlite' || !this.snapshot.migrateFromJson) {
            return { error: 'Migration only available when backend is sqlite' };
        }
        const jsonDir = path.join(this.dataDir, 'kv-cache', 'snapshots');
        return this.snapshot.migrateFromJson(jsonDir, project);
    }

    /**
     * Returns current backend info for diagnostics.
     * @param {string} project
     * @returns {Promise<object>}
     */
    async backendInfo(project) {
        const count = (await this.listSnapshots(project, 9999)).length;
        return {
            backend: this.config.backend,
            snapshotCount: count,
            embedding: this._embeddingReady ? `active (${this.embedding?.model})` : 'off',
        };
    }

    /**
     * Store an embedding vector to disk.
     * @param {string} project
     * @param {string} snapshotId
     * @param {number[]} vector
     */
    _storeEmbedding(project, snapshotId, vector) {
        const dir = path.join(this.dataDir, 'kv-cache', 'embeddings', project);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${snapshotId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(vector));
    }

    /**
     * Load an embedding vector from disk.
     * @param {string} project
     * @param {string} snapshotId
     * @returns {number[]|null}
     */
    _loadEmbedding(project, snapshotId) {
        const filePath = path.join(this.dataDir, 'kv-cache', 'embeddings', project, `${snapshotId}.json`);
        if (!fs.existsSync(filePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            logError('kv-cache:load-embedding', e);
            return null;
        }
    }

    /**
     * Backup project data.
     * @param {string} project
     * @param {object} options
     * @returns {Promise<object>}
     */
    async backup(project, options = {}) {
        if (!this._backup) {
            const { BackupManager } = require('./backup');
            this._backup = new BackupManager(this.dataDir, {});
        }
        return this._backup.backup(project, options);
    }

    /**
     * Restore from backup.
     * @param {string} project
     * @param {string} backupId
     * @param {object} options
     * @returns {Promise<object>}
     */
    async restore(project, backupId = null, options = {}) {
        if (!this._backup) {
            const { BackupManager } = require('./backup');
            this._backup = new BackupManager(this.dataDir, {});
        }
        return this._backup.restore(project, backupId, options);
    }

    /** List backup history for a project. */
    listBackups(project) {
        if (!this._backup) {
            const { BackupManager } = require('./backup');
            this._backup = new BackupManager(this.dataDir, {});
        }
        return this._backup.list(project);
    }

    /** Backup status for a project. */
    backupStatus(project) {
        if (!this._backup) {
            const { BackupManager } = require('./backup');
            this._backup = new BackupManager(this.dataDir, {});
        }
        return this._backup.status(project);
    }

    /** Auto-backup all known projects. */
    async _runAutoBackup() {
        if (!this._backup) return;
        const snapBaseDir = path.join(this.dataDir, 'kv-cache', 'snapshots');

        try {
            if (!fs.existsSync(snapBaseDir)) return;
            const projects = fs.readdirSync(snapBaseDir, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('_'))
                .map(d => d.name);

            for (const project of projects) {
                try {
                    const result = await this._backup.backup(project, {});
                    if (result.type !== 'skip' && result.type !== 'empty') {
                        console.error(`[kv-cache] Auto-backup: ${project} → ${result.sizeFormatted} (${result.type})`);
                    }
                } catch (e) { logError('kv-cache:auto-backup', `${project}: ${e.message}`); }
            }
        } catch (err) {
            console.error(`[kv-cache] Auto-backup error: ${err.message}`);
        }
    }

    /** Stop auto-backup scheduler and cleanup. */
    stopAutoBackup() {
        if (this._backupTimer) {
            clearTimeout(this._backupTimer);
            clearInterval(this._backupTimer);
            this._backupTimer = null;
        }
    }
}

module.exports = { SoulKVCache };
