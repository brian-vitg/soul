// Soul KV-Cache v8.0 — Snapshot engine. Creates/restores session snapshots from disk.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createSession, migrateSession } = require('./schema');
const { logError } = require('../utils');

/**
 * Snapshot engine for session persistence.
 * Stores compressed session snapshots to disk with date-based organization.
 */
class SnapshotEngine {
    /**
     * @param {string} baseDir - Base directory for snapshots (e.g., data/kv-cache/snapshots)
     */
    constructor(baseDir) {
        this.baseDir = baseDir;
    }

    /**
     * Save a session snapshot to disk.
     *
     * @param {object} session - Normalized session object from schema.js
     * @returns {string} Snapshot ID
     */
    async save(session) {
        const s = createSession(session);
        s.endedAt = s.endedAt || new Date().toISOString();

        const dateStr = s.endedAt.split('T')[0];
        const dir = path.join(this.baseDir, s.projectName, dateStr);

        await fsp.mkdir(dir, { recursive: true });

        const fileName = `${s.id}.json`;
        const filePath = path.join(dir, fileName);

        await fsp.writeFile(filePath, JSON.stringify(s, null, 2), 'utf-8');
        return s.id;
    }

    /**
     * Load the most recent snapshot for a project.
     *
     * @param {string} projectName
     * @returns {object|null} Session object or null
     */
    async loadLatest(projectName) {
        const snapshots = await this.list(projectName, 1);
        return snapshots.length > 0 ? snapshots[0] : null;
    }

    /**
     * Load a specific snapshot by ID.
     *
     * @param {string} projectName
     * @param {string} snapshotId
     * @returns {object|null}
     */
    async loadById(projectName, snapshotId) {
        const projectDir = path.join(this.baseDir, projectName);
        if (!fs.existsSync(projectDir)) return null;

        // Search through date directories
        const dateDirs = this._getDateDirs(projectDir);
        for (const dateDir of dateDirs) {
            const filePath = path.join(dateDir, `${snapshotId}.json`);
            if (fs.existsSync(filePath)) {
                return await this._readSnapshot(filePath);
            }
        }
        return null;
    }

    /**
     * List snapshots for a project, sorted by recency.
     *
     * @param {string} projectName
     * @param {number} limit - Max results
     * @returns {object[]} Array of session objects
     */
    async list(projectName, limit = 10) {
        const projectDir = path.join(this.baseDir, projectName);
        if (!fs.existsSync(projectDir)) return [];

        const dateDirs = this._getDateDirs(projectDir);
        const all = [];

        for (const dateDir of dateDirs) {
            try {
                const files = (await fsp.readdir(dateDir)).filter(f => f.endsWith('.json'));
                const readPromises = files.map(file => this._readSnapshot(path.join(dateDir, file)));
                const snapshots = await Promise.all(readPromises);
                for (const snap of snapshots) {
                    if (snap) all.push(snap);
                }
            } catch (e) { logError('snapshot:list', e); }
        }

        // Sort by endedAt descending (most recent first)
        all.sort((a, b) => {
            const ta = new Date(b.endedAt || b.startedAt).getTime();
            const tb = new Date(a.endedAt || a.startedAt).getTime();
            return ta - tb;
        });

        return all.slice(0, limit);
    }

    /**
     * Search snapshots by keyword.
     *
     * @param {string} query - Space-separated keywords
     * @param {string} projectName
     * @param {number} limit
     * @returns {object[]} Matching snapshots with scores
     */
    async search(query, projectName, limit = 10) {
        const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length >= 2);
        const snapshots = await this.list(projectName, 100);

        const scored = snapshots.map(snap => {
            let score = 0;
            const text = [
                snap.context?.summary || '',
                ...(snap.keys || []),
                ...(snap.context?.decisions || []),
            ].join(' ').toLowerCase();

            for (const kw of keywords) {
                const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const matches = (text.match(new RegExp(escaped, 'g')) || []).length;
                score += matches;
            }

            return { ...snap, _score: score };
        });

        return scored
            .filter(s => s._score > 0)
            .sort((a, b) => b._score - a._score)
            .slice(0, limit);
    }

    /**
     * Forgetting Curve GC — retention score determines survival.
     * Score = importance × (1 + log2(1 + accessCount)) × e^(-λ × ageInDays)
     * λ (decay rate) = 0.05 → ~50% retention at 14 days without access.
     *
     * Tier promotion/demotion:
     *   hot  (score ≥ 0.7) — frequently accessed, recent
     *   warm (0.3 ≤ score < 0.7) — occasionally accessed
     *   cold (score < 0.3) — candidates for deletion
     *
     * @param {string} projectName
     * @param {number} maxAgeDays - Force-delete above this age regardless
     * @param {number} maxCount - Hard cap on snapshot count
     * @returns {Promise<{ deleted: number, tiered: { hot: number, warm: number, cold: number } }>}
     */
    async gc(projectName, maxAgeDays = 30, maxCount = 50) {
        const snapshots = await this.list(projectName, 9999);
        let deleted = 0;
        const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
        const tiered = { hot: 0, warm: 0, cold: 0 };
        const survivors = [];

        for (const snap of snapshots) {
            const ts = new Date(snap.endedAt || snap.startedAt).getTime();

            // Phase 1: Hard age cutoff — force delete
            if (ts < cutoff) {
                this._deleteSnapshot(snap);
                deleted++;
                continue;
            }

            // Phase 2: Calculate retention score
            const score = calculateRetention(snap);
            const newTier = score >= 0.7 ? 'hot' : score >= 0.3 ? 'warm' : 'cold';

            // Update tier if changed
            if (snap.tier !== newTier) {
                snap.tier = newTier;
                await this._patchSnapshot(snap, { tier: newTier });
            }

            tiered[newTier]++;
            survivors.push({ snap, score });
        }

        // Phase 3: Excess deletion — remove lowest-scoring cold snapshots first
        if (survivors.length > maxCount) {
            survivors.sort((a, b) => a.score - b.score); // lowest first
            const excess = survivors.slice(0, survivors.length - maxCount);
            for (const { snap } of excess) {
                this._deleteSnapshot(snap);
                deleted++;
                tiered[snap.tier]--;
            }
        }

        return { deleted, tiered };
    }

    /**
     * Touch a snapshot — increment access count, update lastAccessed timestamp.
     * Called when a snapshot is loaded for context injection.
     *
     * @param {string} projectName
     * @param {string} snapshotId
     * @returns {Promise<boolean>} true if patched successfully
     */
    async touch(projectName, snapshotId) {
        const snap = await this.loadById(projectName, snapshotId);
        if (!snap) return false;

        snap.accessCount = (snap.accessCount || 0) + 1;
        snap.lastAccessed = new Date().toISOString();

        // Promote to hot if accessed frequently
        const score = calculateRetention(snap);
        snap.tier = score >= 0.7 ? 'hot' : score >= 0.3 ? 'warm' : 'cold';

        await this._patchSnapshot(snap, {
            accessCount: snap.accessCount,
            lastAccessed: snap.lastAccessed,
            tier: snap.tier,
        });
        return true;
    }

    /**
     * Write updated fields back to snapshot file on disk.
     * @param {object} snap
     * @param {object} patch - Fields to update
     */
    async _patchSnapshot(snap, patch) {
        const dateStr = (snap.endedAt || snap.startedAt || '').split('T')[0];
        if (!dateStr) return;
        const filePath = path.join(this.baseDir, snap.projectName, dateStr, `${snap.id}.json`);
        try {
            const raw = await fsp.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            Object.assign(data, patch);
            await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            logError('snapshot:patch', `${snap.id}: ${e.message}`);
        }
    }

    // -- Private helpers --

    async _readSnapshot(filePath) {
        try {
            const raw = await fsp.readFile(filePath, 'utf-8');
            return migrateSession(JSON.parse(raw));
        } catch (e) {
            logError('snapshot:read', `${path.basename(filePath)}: ${e.message}`);
            return null;
        }
    }

    _deleteSnapshot(snap) {
        const dateStr = (snap.endedAt || snap.startedAt || '').split('T')[0];
        if (!dateStr) return;
        const filePath = path.join(this.baseDir, snap.projectName, dateStr, `${snap.id}.json`);
        try { fs.unlinkSync(filePath); } catch (e) { logError('snapshot:delete', e); }
    }

    _getDateDirs(projectDir) {
        try {
            return fs.readdirSync(projectDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(projectDir, d.name))
                .sort()
                .reverse(); // most recent first
        } catch (e) {
            logError('snapshot:getDateDirs', e);
            return [];
        }
    }
}

/**
 * Forgetting Curve retention score.
 * Based on Ebbinghaus decay: R = importance × (1 + log2(1 + accessCount)) × e^(-λ × ageInDays)
 *
 * λ (decay rate) = 0.05
 * - 0 days  → factor ≈ 1.0
 * - 7 days  → factor ≈ 0.70
 * - 14 days → factor ≈ 0.50
 * - 30 days → factor ≈ 0.22
 *
 * accessCount boosts: log2(1 + N) provides diminishing returns.
 * - 0 accesses → boost = 1.0
 * - 3 accesses → boost ≈ 2.0
 * - 7 accesses → boost ≈ 3.0
 * - 15 accesses → boost ≈ 4.0
 *
 * @param {object} snap - Snapshot with Forgetting Curve fields
 * @returns {number} Retention score (0.0 ~ 1.0, clamped)
 */
function calculateRetention(snap) {
    const DECAY_RATE = 0.05;
    const importance = snap.importance ?? 0.5;
    const accessCount = snap.accessCount || 0;

    // Age is measured from lastAccessed (not creation), rewarding recent access
    const lastAccessed = snap.lastAccessed || snap.endedAt || snap.startedAt;
    const ageMs = Date.now() - new Date(lastAccessed).getTime();
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

    const decayFactor = Math.exp(-DECAY_RATE * ageDays);
    const accessBoost = 1 + Math.log2(1 + accessCount);

    const raw = importance * accessBoost * decayFactor;
    return Math.min(1.0, Math.max(0.0, raw));
}

module.exports = { SnapshotEngine, calculateRetention };
