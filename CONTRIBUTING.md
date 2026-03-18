# Contributing to Soul

Thank you for your interest in contributing to Soul! 🧠

## Getting Started

### Prerequisites

- Node.js 18+
- Git

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/soul.git
   cd soul
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Test your setup:
   ```bash
   node index.js
   ```
   You should see the MCP server start without errors (it will wait for stdin input).

## How to Contribute

### Reporting Bugs

- Open an [issue](https://github.com/choihyunsus/soul/issues) with `[Bug]` in the title
- Include: Node.js version, OS, MCP client (Cursor/VS Code/etc.), and steps to reproduce
- If possible, include the relevant Soul Board or Ledger output

### Suggesting Features

- Open an [issue](https://github.com/choihyunsus/soul/issues) with `[Feature]` in the title
- Describe the use case and expected behavior
- Bonus: include a rough API design

### Submitting Code

1. Create a feature branch:
   ```bash
   git checkout -b feature/amazing-feature
   ```
2. Make your changes
3. Test manually with your MCP client
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m 'feat: add amazing feature'
   ```
5. Push and open a Pull Request:
   ```bash
   git push origin feature/amazing-feature
   ```

## Code Guidelines

### Project Structure

```
soul/
├── index.js              # Entry point (MCP server setup)
├── lib/                  # Core libraries
│   ├── config.js         # Config loader (default + local deep merge)
│   ├── config.default.js # Default settings (shipped)
│   ├── soul-engine.js    # Core engine
│   ├── utils.js          # Shared utilities
│   └── kv-cache/         # KV-Cache engine (snapshots, compression, search)
├── sequences/            # Agent lifecycle
│   ├── boot.js           # n2_boot
│   ├── work.js           # n2_work_start, n2_work_claim, n2_work_log
│   └── end.js            # n2_work_end
├── tools/                # MCP tool registrations
│   ├── brain.js          # n2_brain_read/write, n2_entity_*, n2_core_*
│   └── kv-cache.js       # n2_kv_save/load/search/backup/restore/gc
└── data/                 # Runtime data (gitignored, auto-created)
```

### Style

- **No build step** — Soul runs directly with Node.js
- **Minimal dependencies** — Think twice before adding a new package (currently only 3)
- **CommonJS** — Use `require()` / `module.exports` (not ESM)
- **Descriptive naming** — Functions and variables should be self-documenting
- **Error handling** — Always return meaningful error messages to the MCP client

### Adding a New Tool

1. Create or edit a file in `tools/`
2. Register the tool using the MCP SDK pattern:
   ```js
   server.tool('n2_your_tool', 'Description', { /* zod schema */ }, async (params) => {
       // implementation
       return { content: [{ type: 'text', text: 'result' }] };
   });
   ```
3. If it's a new file, import and register it in `index.js`

### Adding a New Sequence

1. Create or edit a file in `sequences/`
2. Follow the existing pattern in `boot.js` / `work.js` / `end.js`
3. Register in `index.js`

## Testing

Soul doesn't have a formal test suite yet — this is a great area to contribute!

Currently, testing is done by:
1. Starting Soul as an MCP server
2. Connecting from an MCP client (Cursor, VS Code, etc.)
3. Calling tools and verifying output

## Pull Request Guidelines

- **One feature per PR** — keep PRs focused and reviewable
- **Update README** if you add/change tools or features
- **No breaking changes** without discussion in an issue first
- **Keep dependencies minimal** — justify any new package

## Architecture Principles

- **Deterministic over probabilistic** — Soul forces saves/loads instead of relying on LLM decisions
- **Zero config by default** — Everything should work with just `node index.js`
- **Progressive complexity** — Simple for beginners, powerful for advanced users
- **Multi-agent first** — Every feature should consider concurrent agent scenarios

## Community

- 🌐 [nton2.com](https://nton2.com)
- 📦 [npm](https://www.npmjs.com/package/n2-soul)
- 🐛 [Issues](https://github.com/choihyunsus/soul/issues)
- ✉️ lagi0730@gmail.com

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
