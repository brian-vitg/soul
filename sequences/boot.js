// Soul MCP v4.1 — Boot sequence. Handoff + KV-Cache restore.
const path = require('path');
const fs = require('fs');
const { readJson, today, nowISO, logError } = require('../lib/utils');
const { detectAgentsDir, listAgents } = require('../lib/agent-registry');
const { SoulEngine } = require('../lib/soul-engine');
const { setAgentName, setKvChainParent } = require('../lib/context');

function registerBootSequence(server, z, config) {
    const engine = new SoulEngine(config.DATA_DIR);

    server.registerTool(
        'n2_boot',
        {
            title: 'Soul Boot',
            description: 'Boot sequence — loads soul-board handoff, agent list, and KV-Cache context.',
            inputSchema: {
                agent: z.string().describe('Agent name'),
                project: z.string().optional().describe('Project name to load context for'),
            },
        },
        async ({ agent, project }) => {
            const lines = [];

            // -- Agent resolution --
            const agentsDir = config.AGENTS_DIR || detectAgentsDir();
            const agents = listAgents(agentsDir);
            const agentName = agent || process.env.N2_AGENT_NAME || 'default';
            setAgentName(agentName);

            lines.push(`--- Soul Boot | ${agentName} | ${today()} ---`);
            if (agents.length > 0) {
                lines.push(`Agents: ${agents.map(a => `${a.name}[${a.model}]`).join(', ')}`);
            }

            // -- Soul Board: handoff + TODO --
            if (project) {
                const board = engine.readBoard(project);
                lines.push(`\n--- ${project} | v${board.state.version || '?'} | ${board.state.health || '?'} ---`);

                if (board.handoff && board.handoff.summary) {
                    lines.push(`Handoff(${board.handoff.from}): ${board.handoff.summary}`);
                    if (board.handoff.todo && board.handoff.todo.length > 0) {
                        lines.push(`TODO: ${board.handoff.todo.join(' | ')}`);
                    }
                }

                const activeEntries = Object.entries(board.activeWork).filter(([_, v]) => v);
                if (activeEntries.length > 0) {
                    lines.push(`Active: ${activeEntries.map(([n, i]) => `${n}:${i.task}`).join(', ')}`);
                }

                if (board.decisions && board.decisions.length > 0) {
                    const recent = board.decisions.slice(-3);
                    lines.push(`Decisions: ${recent.map(d => `[${d.date}] ${d.what}`).join(' | ')}`);
                }
            }

            // -- KV-Cache auto-load --
            if (project && config.KV_CACHE?.enabled && config.KV_CACHE?.autoLoadOnBoot) {
                try {
                    const { SoulKVCache } = require('../lib/kv-cache');
                    const kvCache = new SoulKVCache(config.DATA_DIR, config.KV_CACHE);
                    const snap = kvCache.load(project);
                    if (snap) {
                        setKvChainParent(project, snap.id);
                        const level = snap._level || 'auto';
                        const tokens = snap._promptTokens || '?';
                        lines.push(`\nKV-Cache: ${level} | ~${tokens}t | ${snap.id.slice(0, 8)}`);
                        if (snap._resumePrompt) lines.push(snap._resumePrompt);
                    }
                } catch (e) { logError('boot:kv-cache', e); }
            }

            lines.push(`\n--- Soul Boot complete ---`);
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
    );
}

module.exports = { registerBootSequence };
