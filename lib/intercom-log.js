// Soul — Centralized conversation log writer for inter-agent communication.
const fs = require('fs');
const path = require('path');
const { detectAgentsDir } = require('./agent-registry');
const { writeJson, readJson, nowISO, logError } = require('./utils');

// ── Agent name whitelist (lazy-loaded from agent configs) ──

let _validNames = null;

/**
 * Load valid agent names from agent config files.
 * Only these names (+ defaults) can have conversation folders.
 * @returns {Set<string>}
 */
function getValidAgentNames() {
    if (_validNames) return _validNames;
    _validNames = new Set(['master', 'owner']);
    try {
        const agentsDir = detectAgentsDir();
        if (agentsDir && fs.existsSync(agentsDir)) {
            const files = fs.readdirSync(agentsDir)
                .filter(f => f.endsWith('.json') && f !== 'global.json');
            for (const f of files) {
                try {
                    const cfg = JSON.parse(fs.readFileSync(path.join(agentsDir, f), 'utf-8'));
                    if (cfg.name && cfg.enabled !== false) _validNames.add(cfg.name);
                } catch (e) { logError('intercom:parse-config', `${f}: ${e.message}`); }
            }
        }
    } catch (e) { logError('intercom:agents-dir', e); }
    return _validNames;
}

/**
 * Normalize a sender/caller name to a valid agent name.
 * Falls back to 'master' if the name is not in the whitelist.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
    if (!name || typeof name !== 'string') return 'master';
    const valid = getValidAgentNames();
    if (valid.has(name)) return name;
    for (const v of valid) {
        if (v.toLowerCase() === name.toLowerCase()) return v;
    }
    return 'master';
}

// ── Path helpers ──

function getConversationsDir(config) {
    const dataDir = config?.dataDir || config?.DATA_DIR || path.join(__dirname, '..', 'data');
    return path.join(dataDir, 'conversations');
}

function getAgentLogDir(config, agentName, date) {
    const [y, m, d] = (date || nowISO().split('T')[0]).split('-');
    return path.join(getConversationsDir(config), agentName, y, m, d);
}

/**
 * Get next sequential log ID (max existing + 1).
 * @param {string} dir
 * @returns {string} Zero-padded 3-digit ID (e.g. '001')
 */
function getNextLogId(dir) {
    if (!fs.existsSync(dir)) return '001';
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const nums = files.map(f => parseInt(f.split('.')[0]) || 0);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return String(max + 1).padStart(3, '0');
}

// ── Core write function ──

/**
 * Write a conversation log entry for both caller and target.
 * Enforces folder isolation: only registered agent names can create directories.
 *
 * @param {object|null} config - Soul config (for dataDir)
 * @param {string} caller - Sender name (will be normalized)
 * @param {string|{name:string}} target - Target agent name or config object
 * @param {string} message - User message
 * @param {{content:string, usage?:object}} response - LLM response
 * @param {{provider:string, model:string}} meta - Provider metadata
 * @returns {{callerLog:string, targetLog:string}|null}
 */
function writeConversationLog(config, caller, target, message, response, meta) {
    const safeCaller = normalizeName(caller);
    const targetName = typeof target === 'object' ? (target.name || String(target)) : String(target);
    const safeTarget = normalizeName(targetName);

    const date = nowISO().split('T')[0];
    const entry = {
        timestamp: nowISO(),
        type: 'call',
        caller: safeCaller,
        target: safeTarget,
        provider: meta?.provider || 'unknown',
        model: meta?.model || 'unknown',
        message: typeof message === 'string' ? message : '',
        response: response?.content || '',
        usage: response?.usage || null,
    };

    const callerDir = getAgentLogDir(config, safeCaller, date);
    const callerId = getNextLogId(callerDir);
    writeJson(path.join(callerDir, `${callerId}.json`), entry);

    const targetDir = getAgentLogDir(config, safeTarget, date);
    const targetId = getNextLogId(targetDir);
    writeJson(path.join(targetDir, `${targetId}.json`), { ...entry, type: 'called' });

    // Signal file for live detection (best-effort)
    try {
        const signalPath = path.join(getConversationsDir(config), '..', 'intercom-signal.json');
        const tmpPath = signalPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
        fs.renameSync(tmpPath, signalPath);
    } catch (e) { logError('intercom:signal', e); }

    return { callerLog: `${safeCaller}/${callerId}`, targetLog: `${safeTarget}/${targetId}` };
}

// ── Read functions ──

/**
 * Read conversation logs for an agent on a specific date.
 * @param {object|null} config
 * @param {string} agentName
 * @param {string} date - YYYY-MM-DD
 * @param {number} lastN - Max entries to return
 * @returns {object[]}
 */
function readConversationLogs(config, agentName, date, lastN) {
    const dir = getAgentLogDir(config, agentName, date);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .slice(-(lastN || 50));
    return files.map(f => readJson(path.join(dir, f))).filter(Boolean);
}

/**
 * Get recent conversation dates for an agent.
 * @param {object|null} config
 * @param {string} agentName
 * @param {number} limit
 * @returns {string[]}
 */
function getConversationDates(config, agentName, limit) {
    const baseDir = path.join(getConversationsDir(config), agentName);
    if (!fs.existsSync(baseDir)) return [];
    const dates = [];
    try {
        const years = fs.readdirSync(baseDir).filter(f => /^\d{4}$/.test(f)).sort().reverse();
        for (const y of years) {
            const months = fs.readdirSync(path.join(baseDir, y)).filter(f => /^\d{2}$/.test(f)).sort().reverse();
            for (const m of months) {
                const days = fs.readdirSync(path.join(baseDir, y, m)).filter(f => /^\d{2}$/.test(f)).sort().reverse();
                for (const d of days) {
                    dates.push(`${y}-${m}-${d}`);
                    if (dates.length >= (limit || 7)) return dates;
                }
            }
        }
    } catch (e) { logError('intercom:dates', e); }
    return dates;
}

/** Invalidate cached agent names (call after agent config changes) */
function resetNameCache() {
    _validNames = null;
}

module.exports = {
    writeConversationLog,
    readConversationLogs,
    getConversationDates,
    getNextLogId,
    normalizeName,
    getValidAgentNames,
    resetNameCache,
};
