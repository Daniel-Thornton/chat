'use strict';

const http  = require('http');
const https = require('https');
const url   = require('url');

const PORT       = 8788;
const OLLAMA_URL = 'http://localhost:11434';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400'
};

const SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'web_search',
        description: 'Search the web for current information, recent news, or facts you are uncertain about. Use this whenever the user asks about something that may have changed recently or that you don\'t know with confidence.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    }
};

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

function ollamaChat(body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const opts = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = http.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
                } catch {
                    reject(new Error('Invalid JSON from Ollama'));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function braveSearch(query, apiKey) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.search.brave.com',
            path: `/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'identity',
                'X-Subscription-Token': apiKey
            }
        };
        const req = https.request(opts, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                } catch {
                    reject(new Error('Invalid JSON from Brave'));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function formatSearchResults(data) {
    const results = data?.web?.results ?? [];
    if (results.length === 0) return 'No search results found.';
    return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description || ''}`)
        .join('\n\n');
}

async function handleChat(req, res) {
    let body;
    try {
        body = JSON.parse(await readBody(req));
    } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
    }

    const { braveApiKey, ...ollamaBody } = body;

    if (braveApiKey) {
        ollamaBody.tools = [SEARCH_TOOL];
    }

    // Agentic loop — cap at 3 tool calls to prevent runaway
    const messages = [...ollamaBody.messages];
    for (let turn = 0; turn < 4; turn++) {
        let result;
        try {
            result = await ollamaChat({ ...ollamaBody, messages });
        } catch {
            return json(res, 502, { error: 'Ollama is not reachable on this PC.' });
        }

        if (result.status !== 200) {
            return json(res, result.status, result.data);
        }

        const msg = result.data?.message;

        // No tool calls — this is the final response
        if (!msg?.tool_calls?.length) {
            return json(res, 200, result.data);
        }

        // Append the assistant's tool-call turn to history
        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });

        // Execute each requested tool
        for (const call of msg.tool_calls) {
            const { name, arguments: args } = call.function;
            let toolResult;

            if (name === 'web_search' && braveApiKey) {
                try {
                    console.log(`  [search] "${args.query}"`);
                    const data = await braveSearch(args.query, braveApiKey);
                    toolResult = formatSearchResults(data);
                } catch (err) {
                    toolResult = `Search failed: ${err.message}`;
                }
            } else {
                toolResult = 'Unknown tool.';
            }

            messages.push({ role: 'tool', content: toolResult });
        }
    }

    json(res, 500, { error: 'Tool loop limit reached without a final response.' });
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

    // Intercept chat to handle tool-use loop
    if (pathname === '/api/chat' && req.method === 'POST') {
        handleChat(req, res);
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
