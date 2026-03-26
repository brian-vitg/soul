// Soul KV-Cache v8.0 — Universal agent session schema. Model-agnostic, distribution-ready.
const crypto = require('crypto');

/** Schema version — increment on breaking changes to session structure. */
const SCHEMA_VERSION = 2;

/**
 * Validates and creates a normalized agent session object.
 * Works for any agent type: MCP, browser executor, or external.
 *
 * @param {object} input - Raw session data
 * @returns {object} Validated session object conforming to schema
 */
function createSession(input = {}) {
    const now = new Date().toISOString();
    return {
        schemaVersion: SCHEMA_VERSION,
        id: input.id || crypto.randomUUID(),
        agentName: input.agentName || 'unknown',
        agentType: validateAgentType(input.agentType),
        model: input.model || null,

        startedAt: input.startedAt || now,
        endedAt: input.endedAt || null,
        turnCount: input.turnCount || 0,
        tokenEstimate: input.tokenEstimate || 0,

        keys: Array.isArray(input.keys) ? input.keys : [],
        context: normalizeContext(input.context),

        parentSessionId: input.parentSessionId || null,
        projectName: input.projectName || 'default',

        // v2: Forgetting Curve metadata
        accessCount: input.accessCount || 0,
        lastAccessed: input.lastAccessed || now,
        importance: input.importance ?? 0.5,
        tier: input.tier || 'warm', // hot | warm | cold
    };
}

/**
 * Validates agent type string.
 * @param {string} type
 * @returns {'mcp'|'browser'|'external'}
 */
function validateAgentType(type) {
    const valid = ['mcp', 'browser', 'external'];
    return valid.includes(type) ? type : 'external';
}

/**
 * Normalizes context object with safe defaults.
 * @param {object} ctx
 * @returns {object}
 */
function normalizeContext(ctx) {
    const c = ctx || {};
    return {
        summary: c.summary || '',
        decisions: Array.isArray(c.decisions) ? c.decisions : [],
        filesChanged: Array.isArray(c.filesChanged) ? c.filesChanged : [],
        todo: Array.isArray(c.todo) ? c.todo : [],
    };
}

/**
 * Merges two sessions (e.g., continuing from a parent session).
 * The newer session's context takes priority; parent keys are preserved.
 *
 * @param {object} parent - Previous session
 * @param {object} child - Current session
 * @returns {object} Merged session
 */
function mergeSession(parent, child) {
    const merged = createSession(child);
    merged.parentSessionId = parent.id;

    // Merge keys (deduplicate)
    const keySet = new Set([...parent.keys, ...merged.keys]);
    merged.keys = Array.from(keySet);

    // Carry forward unresolved TODOs from parent
    const parentTodo = (parent.context?.todo || []).filter(Boolean);
    const childTodo = merged.context.todo;
    const todoSet = new Set([...parentTodo, ...childTodo]);
    merged.context.todo = Array.from(todoSet);

    return merged;
}

/**
 * Migrates a snapshot from older schema versions to current.
 * Ensures backward compatibility when loading old snapshots.
 *
 * @param {object} snapshot - Raw snapshot (possibly old version)
 * @returns {object} Migrated snapshot at current schema version
 */
function migrateSession(snapshot) {
    if (!snapshot) return createSession();
    const version = snapshot.schemaVersion || 0;

    // v0 → v1: add schemaVersion field
    if (version < 1) {
        snapshot.schemaVersion = 1;
        if (!snapshot.context) snapshot.context = normalizeContext({});
    }

    // v1 → v2: add Forgetting Curve fields
    if (version < 2) {
        snapshot.schemaVersion = 2;
        snapshot.accessCount = snapshot.accessCount || 0;
        snapshot.lastAccessed = snapshot.lastAccessed || snapshot.endedAt || snapshot.startedAt || new Date().toISOString();
        snapshot.importance = snapshot.importance ?? 0.5;
        snapshot.tier = snapshot.tier || 'warm';
    }

    // Future migrations go here:
    // if (version < 3) { ... }

    return snapshot;
}

module.exports = { SCHEMA_VERSION, createSession, validateAgentType, normalizeContext, mergeSession, migrateSession };
