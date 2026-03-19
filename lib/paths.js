// Soul MCP v6.0 — Central path manager. Cross-platform compatible.
const path = require('path');
const fs = require('fs');

// soul/lib/paths.js → 2 levels up = project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
// Local fallback only — always use config.DATA_DIR when available
const DATA_ROOT = path.join(path.resolve(__dirname, '..'), 'data');

/** Agents directory path (auto-created if needed) */
function getAgentsDir() {
    // Prefer config.DATA_DIR (supports Cloud Storage) over local fallback
    let dataDir;
    try {
        const config = require('./config');
        dataDir = config.DATA_DIR || DATA_ROOT;
    } catch (e) {
        dataDir = DATA_ROOT;
    }
    const dir = path.join(dataDir, 'agents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = {
    PROJECT_ROOT,
    DATA_ROOT,
    getAgentsDir,
};
