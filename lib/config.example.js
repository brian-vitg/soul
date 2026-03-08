// Soul — Local config example. Copy this to config.local.js and customize.
// config.local.js is gitignored and will override config.default.js values.
const path = require('path');

module.exports = {
    // Language: 'en' or 'ko'
    LANG: 'en',

    // KV-Cache overrides
    KV_CACHE: {
        // Switch to SQLite backend for better performance with many snapshots
        // backend: 'sqlite',

        // Enable Ollama semantic search (requires: ollama pull nomic-embed-text)
        // embedding: {
        //     enabled: true,
        //     model: 'nomic-embed-text',
        //     endpoint: 'http://127.0.0.1:11434',
        // },

        // Enable automatic backups
        // backup: {
        //     enabled: true,
        //     dir: path.resolve(__dirname, '..', 'backups'),
        //     keepCount: 7,
        // },
    },
};
