// Soul MCP v8.0 — Brain tools. Shared memory + Entity Memory + Core Memory.
const path = require('path');
const { readFile, writeFile, safePath } = require('../lib/utils');
const { EntityMemory } = require('../lib/entity-memory');
const { CoreMemory } = require('../lib/core-memory');

function registerBrainTools(server, z, config) {
    const memoryDir = path.join(config.DATA_DIR, 'memory');
    const entityMemory = new EntityMemory(config.DATA_DIR);
    const coreMemory = new CoreMemory(config.DATA_DIR);

    // ── Brain Read/Write ──

    server.tool(
        'n2_brain_read',
        'Read a file from shared memory (data/memory/). Agents share information here.',
        {
            filename: z.string().describe('File path relative to memory directory'),
        },
        async ({ filename }) => {
            const filePath = safePath(filename, memoryDir);
            if (!filePath) return { content: [{ type: 'text', text: `BLOCKED: Path traversal denied — "${filename}"` }] };
            const content = readFile(filePath);
            if (!content) return { content: [{ type: 'text', text: `NOT FOUND: ${filePath}` }] };
            return { content: [{ type: 'text', text: content }] };
        }
    );

    server.tool(
        'n2_brain_write',
        'Write a file to shared memory (data/memory/). Share information between agents.',
        {
            filename: z.string().describe('File path relative to memory directory'),
            content: z.string().describe('File content'),
        },
        async ({ filename, content }) => {
            const filePath = safePath(filename, memoryDir);
            if (!filePath) return { content: [{ type: 'text', text: `BLOCKED: Path traversal denied — "${filename}"` }] };
            writeFile(filePath, content);
            return { content: [{ type: 'text', text: `Saved: memory/${filename} (${content.length} chars)` }] };
        }
    );

    // ── Entity Memory ──

    server.tool(
        'n2_entity_upsert',
        'Add or update entities (person, hardware, project, concept). Auto-merges attributes if entity exists.',
        {
            entities: z.array(z.object({
                type: z.string().describe('Entity type: person, hardware, project, concept, place, service'),
                name: z.string().describe('Entity name'),
                attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Key-value attributes'),
            })).describe('Entities to upsert'),
        },
        async ({ entities }) => {
            const result = entityMemory.upsertBatch(entities);
            return { content: [{ type: 'text', text: `Entity upsert: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped` }] };
        }
    );

    server.tool(
        'n2_entity_search',
        'Search entities by keyword or type. Returns matching entities with attributes.',
        {
            query: z.string().optional().describe('Search keyword'),
            type: z.string().optional().describe('Filter by type: person, hardware, project, concept, place, service'),
        },
        async ({ query, type }) => {
            let results;
            if (type) {
                results = entityMemory.getByType(type);
            } else if (query) {
                results = entityMemory.search(query);
            } else {
                results = entityMemory.list();
            }
            if (results.length === 0) {
                return { content: [{ type: 'text', text: 'No entities found.' }] };
            }
            const text = results.map(e =>
                `[${e.type}] ${e.name} (mentions: ${e.mentionCount || 0}) — ${JSON.stringify(e.attributes || {})}`
            ).join('\n');
            return { content: [{ type: 'text', text: `Entities (${results.length}):\n${text}` }] };
        }
    );

    // ── Core Memory ──

    server.tool(
        'n2_core_read',
        'Read agent-specific core memory. Core memory is always loaded at boot for context injection.',
        {
            agent: z.string().describe('Agent name'),
        },
        async ({ agent }) => {
            const data = coreMemory.read(agent);
            const entries = Object.entries(data.memory || {});
            if (entries.length === 0) {
                return { content: [{ type: 'text', text: `Core memory for ${agent}: (empty)` }] };
            }
            const text = entries.map(([k, v]) => `  ${k}: ${v}`).join('\n');
            return { content: [{ type: 'text', text: `Core memory for ${agent}:\n${text}` }] };
        }
    );

    server.tool(
        'n2_core_write',
        'Write to agent-specific core memory. Stored permanently, injected at every boot.',
        {
            agent: z.string().describe('Agent name'),
            key: z.string().describe('Memory key (e.g. "current_focus", "working_rules")'),
            value: z.string().describe('Memory value'),
        },
        async ({ agent, key, value }) => {
            const result = coreMemory.write(agent, key, value);
            return { content: [{ type: 'text', text: `Core memory ${result.action}: ${agent}.${key}` }] };
        }
    );
}

module.exports = { registerBrainTools };
