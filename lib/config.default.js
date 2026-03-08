// Soul MCP v4.1 — Default config. Zero hardcoded paths, all dynamic.
const path = require('path');

module.exports = {
    // All paths derived dynamically. No hardcoding.
    SOUL_ROOT: path.resolve(__dirname, '..'),
    DATA_DIR: path.resolve(__dirname, '..', 'data'),
    AGENTS_DIR: null, // Auto-detected by agent-registry.js

    // Language (for time formatting)
    LANG: process.env.N2_LANG || 'en',

    // Context search settings (n2_context_search)
    SEARCH: {
        maxDepth: 6,            // Max directory recursion depth
        minKeywordLength: 2,    // Min keyword length to search
        previewLength: 200,     // Characters shown in result preview
        recencyBonus: 10,       // Max score bonus for recent items (days)
        defaultMaxResults: 10,  // Default result limit
    },

    // File tree rendering settings (boot/work_end output)
    FILE_TREE: {
        hidePaths: [
            'test', '_data', '_history',
            'soul/data/kv-cache',
        ],
        compactPaths: [
            'soul/data/projects',
            'soul/data/memory',
        ],
        childLimit: 20,
    },

    // KV-Cache settings
    KV_CACHE: {
        enabled: true,
        autoSaveOnWorkEnd: true,
        autoLoadOnBoot: true,
        backend: 'json',                // 'json' (default) or 'sqlite'
        maxSnapshotsPerProject: 50,
        maxSnapshotAgeDays: 30,
        compressionTarget: 1000,
        snapshotDir: null,              // null = auto (DATA_DIR/kv-cache/snapshots)
        sqliteDir: null,                // null = auto (DATA_DIR/kv-cache/sqlite)
        tokenBudget: {
            bootContext: 2000,
            searchResult: 500,
            progressiveLoad: true,
        },
        tier: {
            hotDays: 7,                 // Hot: in-memory cache (days)
            warmDays: 30,               // Warm: file/db access (days)
        },
        embedding: {
            enabled: false,             // Requires Ollama with nomic-embed-text
            model: 'nomic-embed-text',
            endpoint: null,             // null = http://127.0.0.1:11434
        },
        backup: {
            enabled: false,
            dir: null,                  // null = DATA_DIR/kv-cache/backups
            schedule: 'daily',          // 'manual', 'daily', 'weekly'
            keepCount: 7,
            incremental: true,
        },
    },
};
