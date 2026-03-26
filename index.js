// Soul MCP v8.0 — Entry point. Multi-agent session orchestrator with KV-Cache.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const config = require('./lib/config');

// Sequences — agent lifecycle management
const { registerBootSequence } = require('./sequences/boot');
const { registerWorkSequence } = require('./sequences/work');
const { registerEndSequence } = require('./sequences/end');

// Tools — shared memory + KV-Cache persistence
const { registerBrainTools } = require('./tools/brain');
const { registerKVCacheTools } = require('./tools/kv-cache');

const pkg = require('./package.json');
const server = new McpServer({
    name: 'n2-soul',
    version: pkg.version,
});

// Register core modules — all tools use SDK-native server.tool() directly
registerBootSequence(server, z, config);
registerWorkSequence(server, z, config);
registerEndSequence(server, z, config);
registerBrainTools(server, z, config);
registerKVCacheTools(server, z, config);

// Start MCP transport
async function boot() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

boot().catch(err => {
    console.error(`[n2-soul] Fatal: ${err.message}`);
    process.exit(1);
});
