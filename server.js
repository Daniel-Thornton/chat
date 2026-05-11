'use strict';

const http = require('http');
const url  = require('url');

const PORT       = 8788;
const OLLAMA_URL = 'http://localhost:11434';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400'
};

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(data));
}

function proxyToOllama(req, res) {
    const ollamaUrl = new URL(req.url, OLLAMA_URL);
    const options = {
        hostname: ollamaUrl.hostname,
        port:     Number(ollamaUrl.port) || 11434,
        path:     ollamaUrl.pathname + (ollamaUrl.search || ''),
        method:   req.method,
        headers:  { ...req.headers, host: ollamaUrl.host }
    };

    const proxy = http.request(options, ollamaRes => {
        const headers = Object.fromEntries(
            Object.entries(ollamaRes.headers).filter(([k]) => !k.toLowerCase().startsWith('access-control-'))
        );
        res.writeHead(ollamaRes.statusCode, { ...headers, ...CORS_HEADERS });
        ollamaRes.pipe(res);
    });

    proxy.on('error', () => json(res, 502, { error: 'Ollama is not reachable on this PC.' }));
    req.pipe(proxy);
}

const server = http.createServer((req, res) => {
    const { pathname } = url.parse(req.url);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    if (pathname.startsWith('/api/')) {
        proxyToOllama(req, res);
        return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Chat server running');
    console.log(`  Listening on http://localhost:${PORT}`);
    console.log('');
    console.log('  Point your Cloudflare tunnel at:');
    console.log(`  http://localhost:${PORT}`);
    console.log('');
});
