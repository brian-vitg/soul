// Soul MCP v4.0 — Brain tools. Shared memory read/write with path traversal protection.
const path = require('path');
const { readFile, writeFile, safePath } = require('../lib/utils');

function registerBrainTools(server, z, config) {
    const memoryDir = path.join(config.DATA_DIR, 'memory');

    server.registerTool(
        'n2_brain_read',
        {
            title: 'N2 Brain Read',
            description: 'Read a file from shared memory (data/memory/). Agents share information here.',
            inputSchema: {
                filename: z.string().describe('File path relative to memory directory'),
            },
        },
        async ({ filename }) => {
            const filePath = safePath(filename, memoryDir);
            if (!filePath) return { content: [{ type: 'text', text: `BLOCKED: Path traversal denied — "${filename}"` }] };
            const content = readFile(filePath);
            if (!content) return { content: [{ type: 'text', text: `NOT FOUND: ${filePath}` }] };
            return { content: [{ type: 'text', text: content }] };
        }
    );

    server.registerTool(
        'n2_brain_write',
        {
            title: 'N2 Brain Write',
            description: 'Write a file to shared memory (data/memory/). Share information between agents.',
            inputSchema: {
                filename: z.string().describe('File path relative to memory directory'),
                content: z.string().describe('File content'),
            },
        },
        async ({ filename, content }) => {
            const filePath = safePath(filename, memoryDir);
            if (!filePath) return { content: [{ type: 'text', text: `BLOCKED: Path traversal denied — "${filename}"` }] };
            writeFile(filePath, content);
            return { content: [{ type: 'text', text: `Saved: memory/${filename} (${content.length} chars)` }] };
        }
    );
}

module.exports = { registerBrainTools };
