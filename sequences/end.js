// Soul MCP v4.1 — End sequence. Ledger + board handoff + KV-Cache snapshot.
const path = require('path');
const { nowISO, logError } = require('../lib/utils');
const { SoulEngine } = require('../lib/soul-engine');
const { popKvChainParent } = require('../lib/context');
const { activeSessions } = require('./work');

function registerEndSequence(server, z, config) {
    const engine = new SoulEngine(config.DATA_DIR);

    server.registerTool(
        'n2_work_end',
        {
            title: 'Soul Work End',
            description: 'End work sequence. Writes immutable ledger entry, updates soul-board handoff, releases file ownership.',
            inputSchema: {
                agent: z.string().describe('Agent name'),
                project: z.string().describe('Project name'),
                title: z.string().describe('Work title'),
                summary: z.string().describe('Work summary'),
                todo: z.array(z.string()).optional().describe('Next TODO items'),
                decisions: z.array(z.string()).optional().describe('Key decisions made'),
            },
        },
        async ({ agent, project, title, summary, todo, decisions }) => {
            const session = activeSessions[project] || {};
            const allDecisions = [...(session.decisions || []), ...(decisions || [])];

            // 1. Write immutable ledger entry
            let ledgerResult;
            try {
                ledgerResult = engine.writeLedger(project, agent, {
                    startedAt: session.startedAt,
                    title,
                    summary,
                    filesCreated: session.filesCreated || [],
                    filesModified: session.filesModified || [],
                    filesDeleted: session.filesDeleted || [],
                    decisions: allDecisions,
                });
            } catch (e) {
                logError('end:ledger', e);
                return { content: [{ type: 'text', text: `❌ Ledger write failed: ${e.message}` }] };
            }

            // 2. Update soul-board handoff
            try {
                const board = engine.readBoard(project);
                board.handoff = {
                    from: agent,
                    summary,
                    todo: todo || [],
                    blockers: [],
                };

                const dateStr = nowISO().split('T')[0].slice(5);
                for (const d of allDecisions) {
                    board.decisions.push({ date: dateStr, by: agent, what: d, why: '' });
                }
                if (board.decisions.length > 20) {
                    board.decisions = board.decisions.slice(-20);
                }

                board.updatedBy = agent;
                engine.writeBoard(project, board);
            } catch (e) {
                logError('end:board', e);
            }

            // 3. Release file ownership
            engine.releaseFiles(project, agent);

            // 4. Clear active work
            engine.clearActiveWork(project, agent);

            // 5. Auto-update file-index tree
            try {
                const projectRoot = path.resolve(config.SOUL_ROOT, '..');
                const tree = engine.scanDirectory(projectRoot, {
                    maxDepth: config.SEARCH?.maxDepth || 4,
                });
                engine.writeFileIndex(project, { updatedAt: nowISO(), tree });
            } catch (e) {
                logError('end:file-index', e);
            }

            // 6. Clear in-memory session
            delete activeSessions[project];

            // 7. Auto-save KV-Cache snapshot (with session chaining)
            if (config.KV_CACHE?.enabled && config.KV_CACHE?.autoSaveOnWorkEnd) {
                try {
                    const { SoulKVCache } = require('../lib/kv-cache');
                    const kvCache = new SoulKVCache(config.DATA_DIR, config.KV_CACHE);
                    const parentId = popKvChainParent(project);
                    kvCache.save(agent, project, {
                        summary,
                        decisions: allDecisions,
                        todo: todo || [],
                        filesCreated: session.filesCreated || [],
                        filesModified: session.filesModified || [],
                        filesDeleted: session.filesDeleted || [],
                        startedAt: session.startedAt,
                        parentSessionId: parentId,
                    });
                } catch (e) {
                    logError('end:kv-cache', e);
                }
            }

            const totalFiles = (session.filesCreated || []).length +
                (session.filesModified || []).length +
                (session.filesDeleted || []).length;

            return {
                content: [{
                    type: 'text',
                    text: [
                        `Work ${ledgerResult.id} completed: ${title}`,
                        `Agent: ${agent}`,
                        `Files: ${totalFiles} changes`,
                        `Decisions: ${allDecisions.length}`,
                        `Ledger: ${ledgerResult.path}`,
                        `Handoff TODO: ${(todo || []).join(' | ') || 'none'}`,
                    ].join('\n'),
                }],
            };
        }
    );
}

module.exports = { registerEndSequence };
