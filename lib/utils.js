// Soul MCP v4.0 — Shared utility functions (file I/O, time, security, logging)
const fs = require('fs');
const path = require('path');

// -- Logging --

function logError(context, err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[soul:${context}]`, msg);
}

// -- File I/O --

function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        logError('readFile', e);
        return null;
    }
}

function readJson(filePath) {
    const content = readFile(filePath);
    if (!content) return null;
    try {
        return JSON.parse(content);
    } catch (e) {
        logError('readJson', e);
        return null;
    }
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

// -- Time --

function today() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function nowISO() {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const get = (type) => parts.find(p => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`;
}

// -- Security --

function safePath(filePath, baseDir) {
    const resolved = path.resolve(baseDir, filePath);
    const normalizedBase = path.resolve(baseDir);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
        logError('safePath', `Path traversal blocked: ${filePath}`);
        return null;
    }
    return resolved;
}

// -- First-line comment validation --

function validateFirstLineComment(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const firstLine = content.split('\n')[0].trim();
        const patterns = [
            /^\/\/\s*.+/,     // JS/TS
            /^#\s*.+/,        // Python/Shell/YAML
            /^<!--\s*.+/,     // HTML/MD
            /^\/\*\s*.+/,     // CSS/Java
            /^\{.*"_desc"/,   // JSON with _desc field
        ];
        return patterns.some(p => p.test(firstLine));
    } catch (e) {
        logError('validateFirstLineComment', e);
        return false;
    }
}

module.exports = {
    logError, readFile, readJson, writeJson, writeFile,
    today, nowISO, safePath, validateFirstLineComment,
};
