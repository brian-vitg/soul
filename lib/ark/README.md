# Ark — AI Safety (Soul Plugin)

Core engine of Ark. Unconditionally loaded at Soul boot. Checks every MCP tool call against safety rules.
- `gate.js`: SafetyGate — blacklist / gate / contract check engine
- `parser.js`: .n2 rule file parser
- `audit.js`: Audit logger (logs all blocks and passes)
- `index.js`: createArk() factory
