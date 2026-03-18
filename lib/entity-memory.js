// Entity Memory — Structured entity tracking for people, places, concepts, hardware, etc.
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, nowISO, logError } = require('./utils');

/**
 * EntityMemory — Structured entity tracking and auto-injection.
 *
 * Data path: data/memory/entities.json
 * Entity types: person, hardware, project, concept, place, service
 */
class EntityMemory {
    /**
     * @param {string} dataDir - Soul data directory (soul/data)
     */
    constructor(dataDir) {
        this.filePath = path.join(dataDir, 'memory', 'entities.json');
        this._cache = null;
    }

    /**
     * Load entity data (with caching).
     * @returns {{ entities: object[] }}
     */
    _load() {
        if (this._cache) return this._cache;
        const data = readJson(this.filePath);
        this._cache = data || { entities: [], updatedAt: nowISO() };
        return this._cache;
    }

    /**
     * Save changes + update cache.
     * @param {object} data
     */
    _save(data) {
        data.updatedAt = nowISO();
        this._cache = data;
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        writeJson(this.filePath, data);
    }

    /**
     * Add or update an entity (upsert).
     * If name matches, merges attributes + increments mentionCount.
     *
     * @param {{ type: string, name: string, attributes?: object }} entity
     * @returns {{ action: string, entity: object }}
     */
    upsert(entity) {
        if (!entity || !entity.name || !entity.type) {
            return { action: 'skip', entity: null };
        }

        const data = this._load();
        const nameKey = entity.name.toLowerCase().trim();
        const existing = data.entities.find(
            e => e.name.toLowerCase().trim() === nameKey && e.type === entity.type
        );

        if (existing) {
            // Merge: overlay new attributes on existing (preserving old attrs)
            existing.attributes = { ...existing.attributes, ...(entity.attributes || {}) };
            existing.lastMentioned = nowISO();
            existing.mentionCount = (existing.mentionCount || 1) + 1;
            this._save(data);
            return { action: 'updated', entity: existing };
        }

        // Add new entity
        const newEntity = {
            type: entity.type,
            name: entity.name,
            attributes: entity.attributes || {},
            firstSeen: nowISO(),
            lastMentioned: nowISO(),
            mentionCount: 1,
        };
        data.entities.push(newEntity);
        this._save(data);
        return { action: 'created', entity: newEntity };
    }

    /**
     * Batch upsert multiple entities.
     * @param {object[]} entities
     * @returns {{ created: number, updated: number, skipped: number }}
     */
    upsertBatch(entities) {
        if (!Array.isArray(entities)) return { created: 0, updated: 0, skipped: 0 };
        const stats = { created: 0, updated: 0, skipped: 0 };
        for (const e of entities) {
            const result = this.upsert(e);
            if (result.action === 'created') stats.created++;
            else if (result.action === 'updated') stats.updated++;
            else stats.skipped++;
        }
        return stats;
    }

    /**
     * Get entity by name.
     * @param {string} name
     * @returns {object|null}
     */
    get(name) {
        const data = this._load();
        const nameKey = name.toLowerCase().trim();
        return data.entities.find(e => e.name.toLowerCase().trim() === nameKey) || null;
    }

    /**
     * Get entities by type.
     * @param {string} type - person, hardware, project, concept, place, service
     * @returns {object[]}
     */
    getByType(type) {
        const data = this._load();
        return data.entities.filter(e => e.type === type);
    }

    /**
     * Search entities by keyword.
     * @param {string} query
     * @returns {object[]}
     */
    search(query) {
        const data = this._load();
        const keywords = query.toLowerCase().split(/\s+/);
        return data.entities.filter(e => {
            const text = [e.name, e.type, JSON.stringify(e.attributes)].join(' ').toLowerCase();
            return keywords.some(kw => text.includes(kw));
        });
    }

    /**
     * List all entities.
     * @returns {object[]}
     */
    list() {
        return this._load().entities;
    }

    /**
     * Remove entity by name.
     * @param {string} name
     * @param {string} [type] - If specified, only remove matching type
     * @returns {boolean}
     */
    remove(name, type) {
        const data = this._load();
        const nameKey = name.toLowerCase().trim();
        const before = data.entities.length;
        data.entities = data.entities.filter(e => {
            const match = e.name.toLowerCase().trim() === nameKey;
            if (type) return !(match && e.type === type);
            return !match;
        });
        if (data.entities.length < before) {
            this._save(data);
            return true;
        }
        return false;
    }

    /**
     * Prune old entities (not mentioned for maxAge days).
     * @param {number} maxAgeDays
     * @returns {number} Number of pruned entities
     */
    prune(maxAgeDays = 90) {
        const data = this._load();
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        const before = data.entities.length;
        data.entities = data.entities.filter(e => {
            const last = new Date(e.lastMentioned || e.firstSeen).getTime();
            return last >= cutoff;
        });
        if (data.entities.length < before) {
            this._save(data);
        }
        return before - data.entities.length;
    }

    /**
     * Generate context string for boot injection.
     * Sorted by mentionCount descending, limited to maxItems.
     *
     * @param {number} [maxItems=10] - Max entities to include
     * @returns {string}
     */
    toContext(maxItems = 10) {
        const data = this._load();
        if (data.entities.length === 0) return '';

        const sorted = [...data.entities]
            .sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0))
            .slice(0, maxItems);

        const lines = sorted.map(e => {
            const attrs = Object.entries(e.attributes || {})
                .map(([k, v]) => `${k}:${v}`)
                .join(', ');
            return `${e.name}[${e.type}]${attrs ? ': ' + attrs : ''}`;
        });

        return `Entities(${data.entities.length}): ${lines.join(' | ')}`;
    }

    /**
     * Invalidate cache (for testing/reload).
     */
    invalidateCache() {
        this._cache = null;
    }
}

module.exports = { EntityMemory };
