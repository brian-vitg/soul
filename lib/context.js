// Soul — Session context manager. Replaces global state anti-pattern.
const _ctx = {
    agentName: null,
    kvChain: {},       // { projectName: parentSessionId }
};

/** Get current session context */
function getContext() {
    return _ctx;
}

/** Set agent name (called during n2_boot) */
function setAgentName(name) {
    _ctx.agentName = name;
}

/** Get agent name with fallback */
function getAgentName() {
    return _ctx.agentName || process.env.N2_AGENT_NAME || 'default';
}

/** Set KV chain parent (for session linking) */
function setKvChainParent(project, sessionId) {
    _ctx.kvChain[project] = sessionId;
}

/** Get and consume KV chain parent */
function popKvChainParent(project) {
    const parent = _ctx.kvChain[project] || null;
    delete _ctx.kvChain[project];
    return parent;
}

module.exports = { getContext, setAgentName, getAgentName, setKvChainParent, popKvChainParent };
