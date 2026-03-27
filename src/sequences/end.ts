// Soul MCP v9.0 — End sequence. Ledger + board handoff + KV-Cache + entities/insights auto-save.
import path from 'path';
import type { z as ZodType } from 'zod';
import { nowISO, readFile, writeFile, logError } from '../lib/utils';
import type { SoulEngine } from '../lib/soul-engine';
import { popKvChainParent } from '../lib/context';
import { activeSessions } from './work';
import { EntityMemory } from '../lib/entity-memory';
import type { EntityInput } from '../lib/entity-memory';
import type { McpToolServer, SoulConfig } from '../types';

interface WorkEndInput {
  agent: string;
  project: string;
  title: string;
  summary: string;
  todo?: string[];
  decisions?: string[];
  entities?: EntityInput[];
  insights?: string[];
}

interface ActiveSession {
  agent: string;
  task: string;
  startedAt: string;
  _createdMs: number;
  filesCreated: Array<{ path: string; desc: string }>;
  filesModified: Array<{ path: string; desc: string }>;
  filesDeleted: Array<{ path: string; desc: string }>;
  decisions: string[];
}

/** Write immutable ledger entry */
function _writeLedger(
  engine: SoulEngine, project: string, agent: string, title: string,
  summary: string, session: ActiveSession, allDecisions: string[],
): { id: string; path: string } {
  return engine.writeLedger(project, agent, {
    startedAt: session.startedAt,
    title, summary,
    filesCreated: session.filesCreated ?? [],
    filesModified: session.filesModified ?? [],
    filesDeleted: session.filesDeleted ?? [],
    decisions: allDecisions,
  });
}

/** Update soul-board handoff */
function _updateBoardHandoff(
  engine: SoulEngine, config: SoulConfig, project: string,
  agent: string, summary: string, todo: string[], allDecisions: string[],
): void {
  const board = engine.readBoard(project);
  board.handoff = { from: agent, summary, todo, blockers: [] };
  const dateStr = nowISO().split('T')[0] ?? '';
  for (const d of allDecisions) {
    board.decisions.push({ date: dateStr, by: agent, what: d, why: '' });
  }
  const maxDecisions = config.WORK?.maxDecisions ?? 20;
  if (board.decisions.length > maxDecisions) {
    board.decisions = board.decisions.slice(-maxDecisions);
  }
  board.updatedBy = agent;
  engine.writeBoard(project, board);
}

/** Cleanup: release files, clear active work, update file-index, prune ledger */
function _runCleanup(
  engine: SoulEngine, config: SoulConfig, project: string, agent: string,
): void {
  engine.releaseFiles(project, agent);
  engine.clearActiveWork(project, agent);
  try {
    const projectRoot = path.resolve(config.SOUL_ROOT, '..');
    const tree = engine.scanDirectory(projectRoot, {
      maxDepth: Math.min(config.SEARCH?.maxDepth ?? 3, 3),
      excludes: ['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.venv', 'build'],
    });
    engine.writeFileIndex(project, { updatedAt: nowISO(), tree });
  } catch (e) { logError('end:file-index', e); }
  try { engine.pruneLedger(project, 90); } catch (e) { logError('end:ledger-prune', e); }
  delete activeSessions[project];
}

/** Save KV-Cache snapshot + auto-GC */
async function _saveKvCache(
  config: SoulConfig, agent: string, project: string,
  summary: string, allDecisions: string[], todo: string[], session: ActiveSession,
): Promise<void> {
  if (!config.KV_CACHE?.enabled || !config.KV_CACHE?.autoSaveOnWorkEnd) return;
  let kvCache: InstanceType<typeof import('../lib/kv-cache').SoulKVCache> | null = null;
  try {
    const { SoulKVCache } = await import('../lib/kv-cache');
    kvCache = new SoulKVCache(config.DATA_DIR, config.KV_CACHE);
    const parentId = popKvChainParent(project);
    await kvCache.save(agent, project, {
      summary, decisions: allDecisions, todo,
      filesCreated: session.filesCreated ?? [],
      filesModified: session.filesModified ?? [],
      filesDeleted: session.filesDeleted ?? [],
      startedAt: session.startedAt,
      parentSessionId: parentId,
    });
    const maxSnapshots = config.KV_CACHE?.maxSnapshotsPerProject ?? 50;
    const snapCount = (await kvCache.listSnapshots(project)).length;
    if (snapCount > maxSnapshots) await kvCache.gc(project);
  } catch (e) {
    logError('end:kv-cache', e);
  } finally {
    if (kvCache) kvCache.dispose();
  }
}

/** Save entities and insights to memory */
function _saveEntitiesAndInsights(
  entityMemory: EntityMemory, config: SoulConfig,
  project: string, agent: string, title: string,
  entities?: EntityInput[], insights?: string[],
): void {
  if (entities && entities.length > 0) {
    try { entityMemory.upsertBatch(entities); } catch (e) { logError('end:entity-memory', e); }
  }
  if (insights && insights.length > 0) {
    try {
      const insightsDir = path.join(config.DATA_DIR, 'memory', 'auto-extract', project);
      const dateStr = nowISO().split('T')[0] ?? '';
      const filePath = path.join(insightsDir, `${dateStr}.md`);
      const newBlock = `# Auto-Extract: ${project}\n## ${agent} — ${title}\n\n${insights.map(i => `- ${i}`).join('\n')}\n`;
      const existing = readFile(filePath) ?? '';
      writeFile(filePath, existing + newBlock + '\n');
    } catch (e) { logError('end:insights', e); }
  }
}



/** Execute work-end orchestration */
async function _handleWorkEnd(
  input: WorkEndInput, config: SoulConfig, engine: SoulEngine, entityMemory: EntityMemory,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { agent, project, title, summary, todo, decisions, entities, insights } = input;
  const session: ActiveSession = activeSessions[project] ?? {
    agent, task: '', startedAt: '', _createdMs: 0,
    filesCreated: [], filesModified: [], filesDeleted: [], decisions: [],
  };
  const allDecisions = [...(session.decisions ?? []), ...(decisions ?? [])];

  let ledgerResult: { id: string; path: string };
  try {
    ledgerResult = _writeLedger(engine, project, agent, title, summary, session, allDecisions);
  } catch (e) {
    logError('end:ledger', e);
    return { content: [{ type: 'text', text: `❌ Ledger write failed: ${e instanceof Error ? e.message : String(e)}` }] };
  }

  try { _updateBoardHandoff(engine, config, project, agent, summary, todo ?? [], allDecisions); }
  catch (e) { logError('end:board', e); }

  _runCleanup(engine, config, project, agent);
  await _saveKvCache(config, agent, project, summary, allDecisions, todo ?? [], session);
  _saveEntitiesAndInsights(entityMemory, config, project, agent, title, entities, insights);

  const totalFiles = (session.filesCreated ?? []).length +
    (session.filesModified ?? []).length + (session.filesDeleted ?? []).length;

  return {
    content: [{
      type: 'text',
      text: [
        `Work ${ledgerResult.id} completed: ${title}`,
        `Agent: ${agent}`, `Files: ${totalFiles} changes`,
        `Decisions: ${allDecisions.length}`,
        `Ledger: ${ledgerResult.path}`,
        `Handoff TODO: ${(todo ?? []).join(' | ') || 'none'}`,
      ].join('\n'),
    }],
  };
}

/** Register n2_work_end tool */
function _registerWorkEndTool(
  server: McpToolServer, z: typeof ZodType,
  config: SoulConfig, engine: SoulEngine, entityMemory: EntityMemory,
): void {
  server.tool(
    'n2_work_end',
    'End work sequence. Writes immutable ledger entry, updates soul-board handoff, releases file ownership.',
    {
      agent: z.string().describe('Agent name'),
      project: z.string().describe('Project name'),
      title: z.string().describe('Work title'),
      summary: z.string().describe('Work summary'),
      todo: z.array(z.string()).optional().describe('Next TODO items'),
      decisions: z.array(z.string()).optional().describe('Key decisions made'),
      entities: z.array(z.object({
        type: z.string().describe('Entity type'),
        name: z.string().describe('Entity name'),
        attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      })).optional().describe('Entities discovered during session'),
      insights: z.array(z.string()).optional().describe('Permanent knowledge/insights to remember'),
    },
    async (input: WorkEndInput) => _handleWorkEnd(input, config, engine, entityMemory),
  );
}

export function registerEndSequence(
  server: McpToolServer,
  z: typeof ZodType,
  config: SoulConfig,
  engine: SoulEngine,
): void {
  const entityMemory = new EntityMemory(config.DATA_DIR);
  _registerWorkEndTool(server, z, config, engine, entityMemory);
}


