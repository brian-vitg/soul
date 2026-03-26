// Soul KV-Cache v8.0 — Tiered storage manager. Hot/Warm/Cold lifecycle for snapshots.

/**
 * Tiered storage levels for KV-Cache snapshots.
 *
 * Hot  (0-7 days):  In-memory cache + disk. Fastest access.
 * Warm (8-30 days): Disk only. Normal file/db access.
 * Cold (30+ days):  Archived (compressed). Lazy load on demand.
 */
const TIERS = {
    HOT: { name: 'hot', maxAgeDays: 7 },
    WARM: { name: 'warm', maxAgeDays: 30 },
    COLD: { name: 'cold', maxAgeDays: Infinity },
};

/**
 * TierManager wraps a storage engine and adds tiered caching.
 * Hot tier snapshots are kept in memory for fast access.
 * Cold tier snapshots are moved to a compressed archive.
 *
 * NOTE: All delegate methods are async to match SnapshotEngine v8.0 async API.
 */
class TierManager {
    /**
     * @param {object} storageEngine - SnapshotEngine or SqliteStore
     * @param {object} config - tier config { hotDays, warmDays }
     */
    constructor(storageEngine, config = {}) {
        this.engine = storageEngine;
        this.hotDays = config.hotDays || TIERS.HOT.maxAgeDays;
        this.warmDays = config.warmDays || TIERS.WARM.maxAgeDays;
        this._hotCache = {};  // { projectName: { id: session } }
    }

    /**
     * Classify a snapshot's tier based on age.
     *
     * @param {object} snapshot
     * @returns {'hot'|'warm'|'cold'}
     */
    classify(snapshot) {
        const timestamp = snapshot.endedAt || snapshot.startedAt;
        if (!timestamp) return 'warm';

        const ageMs = Date.now() - new Date(timestamp).getTime();
        const ageDays = ageMs / (24 * 60 * 60 * 1000);

        if (ageDays <= this.hotDays) return 'hot';
        if (ageDays <= this.warmDays) return 'warm';
        return 'cold';
    }

    /**
     * Save with automatic hot-cache population.
     *
     * @param {object} session
     * @returns {Promise<string>} Snapshot ID
     */
    async save(session) {
        const id = await this.engine.save(session);

        // Add to hot cache
        const project = session.projectName || session.project;
        if (project) {
            if (!this._hotCache[project]) this._hotCache[project] = {};
            this._hotCache[project][id] = { ...session, id };
        }

        return id;
    }

    /**
     * Load latest with hot-cache check first.
     *
     * @param {string} projectName
     * @returns {Promise<object|null>}
     */
    async loadLatest(projectName) {
        // Check hot cache first
        const cache = this._hotCache[projectName];
        if (cache) {
            const entries = Object.values(cache);
            if (entries.length > 0) {
                entries.sort((a, b) => {
                    const ta = new Date(b.endedAt || b.startedAt).getTime();
                    const tb = new Date(a.endedAt || a.startedAt).getTime();
                    return ta - tb;
                });
                return entries[0];
            }
        }

        // Fall through to storage engine
        return await this.engine.loadLatest(projectName);
    }

    /**
     * List snapshots with tier annotations.
     *
     * @param {string} projectName
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    async list(projectName, limit = 10) {
        const snapshots = await this.engine.list(projectName, limit);
        return snapshots.map(snap => ({
            ...snap,
            _tier: this.classify(snap),
        }));
    }

    /**
     * Search with tier annotations.
     *
     * @param {string} query
     * @param {string} projectName
     * @param {number} limit
     * @returns {Promise<object[]>}
     */
    async search(query, projectName, limit = 10) {
        const results = await this.engine.search(query, projectName, limit);
        return results.map(snap => ({
            ...snap,
            _tier: this.classify(snap),
        }));
    }

    /**
     * Tier-aware garbage collection.
     * Delegates to engine's Forgetting Curve GC, then refreshes hot cache.
     *
     * @param {string} projectName
     * @param {number} maxAgeDays
     * @param {number} maxCount
     * @returns {Promise<object>}
     */
    async gc(projectName, maxAgeDays = 30, maxCount = 50) {
        const result = await this.engine.gc(projectName, maxAgeDays, maxCount);

        // Refresh hot cache
        await this._refreshHotCache(projectName);

        // Count tiers after GC
        const remaining = await this.list(projectName, 9999);
        const counts = { hot: 0, warm: 0, cold: 0 };
        for (const snap of remaining) {
            counts[snap._tier || 'warm']++;
        }

        return {
            deleted: result.deleted,
            tiered: result.tiered || counts,
            hotCount: counts.hot,
            warmCount: counts.warm,
            coldCount: counts.cold,
        };
    }

    /**
     * Refresh hot cache for a project from storage.
     * @param {string} projectName
     */
    async _refreshHotCache(projectName) {
        const snaps = await this.engine.list(projectName, 100);
        const cache = {};

        for (const snap of snaps) {
            if (this.classify(snap) === 'hot') {
                cache[snap.id] = snap;
            }
        }

        this._hotCache[projectName] = cache;
    }

    /**
     * Get tier distribution summary for a project.
     *
     * @param {string} projectName
     * @returns {Promise<{ hot: number, warm: number, cold: number, total: number }>}
     */
    async tierSummary(projectName) {
        const snaps = await this.list(projectName, 9999);
        const counts = { hot: 0, warm: 0, cold: 0, total: snaps.length };

        for (const snap of snaps) {
            counts[snap._tier || 'warm']++;
        }

        return counts;
    }

    /**
     * Warm up: preload hot tier snapshots into memory.
     *
     * @param {string} projectName
     * @returns {Promise<number>} Number of snapshots cached
     */
    async warmUp(projectName) {
        await this._refreshHotCache(projectName);
        return Object.keys(this._hotCache[projectName] || {}).length;
    }

    /**
     * Clear hot cache for a project.
     * @param {string} projectName
     */
    evict(projectName) {
        delete this._hotCache[projectName];
    }

    /**
     * Proxy: loadById
     */
    async loadById(projectName, snapshotId) {
        return await this.engine.loadById(projectName, snapshotId);
    }

    /**
     * Proxy: touch (Forgetting Curve access tracking)
     */
    async touch(projectName, snapshotId) {
        if (this.engine.touch) {
            return await this.engine.touch(projectName, snapshotId);
        }
        return false;
    }

    /**
     * Proxy: migrateFromJson (if available)
     */
    migrateFromJson(jsonBaseDir, projectName) {
        if (this.engine.migrateFromJson) {
            return this.engine.migrateFromJson(jsonBaseDir, projectName);
        }
        return { error: 'Migration not available for this backend' };
    }

    /**
     * Proxy: dispose
     */
    dispose() {
        this._hotCache = {};
        if (this.engine.dispose) this.engine.dispose();
    }
}

module.exports = { TierManager, TIERS };
