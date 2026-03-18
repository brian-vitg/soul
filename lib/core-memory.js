// Core Memory — Agent-specific core facts, auto-injected into context at every boot.
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, nowISO } = require('./utils');

/**
 * CoreMemory — Agent-specific always-loaded memory.
 * Automatically included in context at boot.
 *
 * Data path: data/memory/core-memory/{agent}.json
 * Inspired by Letta's Core Memory: essential facts an agent references every call.
 */
class CoreMemory {
    /**
     * @param {string} dataDir - Soul data directory (soul/data)
     */
    constructor(dataDir) {
        this.dir = path.join(dataDir, 'memory', 'core-memory');
        this._cache = {};
    }

    /**
     * Agent core memory file path.
     * @param {string} agentName
     * @returns {string}
     */
    _filePath(agentName) {
        const safeName = agentName.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        return path.join(this.dir, `${safeName}.json`);
    }

    /**
     * Load agent core memory.
     * @param {string} agentName
     * @returns {object}
     */
    read(agentName) {
        if (this._cache[agentName]) return this._cache[agentName];
        const data = readJson(this._filePath(agentName));
        this._cache[agentName] = data || { agent: agentName, memory: {}, updatedAt: nowISO() };
        return this._cache[agentName];
    }

    /**
     * Write key-value to core memory.
     * @param {string} agentName
     * @param {string} key
     * @param {string} value
     * @returns {{ action: string }}
     */
    write(agentName, key, value) {
        const data = this.read(agentName);
        const action = data.memory[key] ? 'updated' : 'created';
        data.memory[key] = value;
        data.updatedAt = nowISO();
        this._cache[agentName] = data;

        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        writeJson(this._filePath(agentName), data);
        return { action };
    }

    /**
     * Remove key from core memory.
     * @param {string} agentName
     * @param {string} key
     * @returns {boolean}
     */
    remove(agentName, key) {
        const data = this.read(agentName);
        if (!(key in data.memory)) return false;
        delete data.memory[key];
        data.updatedAt = nowISO();
        this._cache[agentName] = data;
        writeJson(this._filePath(agentName), data);
        return true;
    }

    /**
     * List all keys for an agent.
     * @param {string} agentName
     * @returns {string[]}
     */
    keys(agentName) {
        const data = this.read(agentName);
        return Object.keys(data.memory);
    }

    /**
     * Generate prompt text for boot injection.
     * @param {string} agentName
     * @param {number} [maxTokens=500] - Approximate token limit (char-based)
     * @returns {string}
     */
    toPrompt(agentName, maxTokens = 500) {
        const data = this.read(agentName);
        const entries = Object.entries(data.memory);
        if (entries.length === 0) return '';

        const lines = entries.map(([k, v]) => `${k}: ${v}`);
        let result = lines.join(' | ');

        // Rough char-based token limit
        if (result.length > maxTokens * 2) {
            result = result.slice(0, maxTokens * 2) + '...';
        }

        return `Core[${agentName}]: ${result}`;
    }

    /**
     * Summary of all agents' core memories.
     * @returns {string}
     */
    toContextAll() {
        if (!fs.existsSync(this.dir)) return '';
        const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
        if (files.length === 0) return '';

        const summaries = [];
        for (const f of files) {
            const agent = f.replace('.json', '');
            const prompt = this.toPrompt(agent, 200);
            if (prompt) summaries.push(prompt);
        }
        return summaries.join('\n');
    }

    /**
     * Invalidate cache.
     */
    invalidateCache() {
        this._cache = {};
    }
}

module.exports = { CoreMemory };
