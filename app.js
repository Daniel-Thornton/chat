'use strict';

const SETTINGS_KEY = 'chat_settings_v1';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Answer clearly and concisely. Use markdown formatting where it helps readability — code blocks for code, bullet points for lists, bold for key terms.`;

// ── DOM ──

const messagesEl   = document.getElementById('messages');
const welcomeEl    = document.getElementById('welcome');
const userInputEl  = document.getElementById('user-input');
const sendBtn      = document.getElementById('send-btn');
const clearBtn     = document.getElementById('clear-btn');
const settingsBtn  = document.getElementById('settings-btn');
const settingsModal= document.getElementById('settings-modal');
const tunnelUrlIn  = document.getElementById('tunnel-url');
const modelNameIn  = document.getElementById('model-name');
const systemPromptIn = document.getElementById('system-prompt');
const saveSettingsBtn  = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const modelBadge   = document.getElementById('model-badge');

// ── State ──

let settings = loadSettings();
let messages = []; // { role, content }
let busy = false;

// ── Boot ──

function init() {
    applySettings();
    setupEventListeners();
    userInputEl.focus();
}

// ── Settings ──

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
}

function applySettings() {
    const model = settings.model || 'llama3.2';
    modelBadge.textContent = model;
    tunnelUrlIn.value    = settings.tunnelUrl    || '';
    modelNameIn.value    = settings.model        || '';
    systemPromptIn.value = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

function persistSettings() {
    settings.tunnelUrl    = tunnelUrlIn.value.trim().replace(/\/+$/, '');
    settings.model        = modelNameIn.value.trim() || 'llama3.2';
    settings.systemPrompt = systemPromptIn.value.trim() || DEFAULT_SYSTEM_PROMPT;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    applySettings();
}

// ── Events ──

function setupEventListeners() {
    settingsBtn.addEventListener('click', openSettings);
    saveSettingsBtn.addEventListener('click', () => { persistSettings(); closeSettings(); });
    closeSettingsBtn.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

    clearBtn.addEventListener('click', clearConversation);
    sendBtn.addEventListener('click', handleSend);

    userInputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Auto-grow textarea
    userInputEl.addEventListener('input', () => {
        userInputEl.style.height = 'auto';
        userInputEl.style.height = userInputEl.scrollHeight + 'px';
    });
}

function openSettings()  { applySettings(); settingsModal.classList.remove('hidden'); }
function closeSettings() { settingsModal.classList.add('hidden'); }

function clearConversation() {
    messages = [];
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.classList.remove('hidden');
    userInputEl.focus();
}

// ── Send ──

async function handleSend() {
    const text = userInputEl.value.trim();
    if (!text || busy) return;

    if (!settings.tunnelUrl) {
        showError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.');
        return;
    }

    welcomeEl.classList.add('hidden');

    appendMessage('user', text);
    messages.push({ role: 'user', content: text });

    userInputEl.value = '';
    userInputEl.style.height = 'auto';

    const typingEl = appendTypingIndicator();
    setBusy(true);

    try {
        const reply = await callOllama(messages);
        typingEl.remove();
        appendMessage('assistant', reply);
        messages.push({ role: 'assistant', content: reply });
    } catch (err) {
        typingEl.remove();
        showError(err.message);
    } finally {
        setBusy(false);
        userInputEl.focus();
    }
}

async function callOllama(history) {
    const systemPrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const model = settings.model || 'llama3.2';

    let response;
    try {
        response = await fetch(`${settings.tunnelUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history
                ],
                stream: false
            })
        });
    } catch {
        throw new Error('Could not reach your home PC. Check that the tunnel is running and the URL is up to date in Settings.');
    }

    if (!response.ok) throw new Error(`Ollama error (HTTP ${response.status}). Check the model name in Settings.`);

    const data = await response.json();
    return data?.message?.content ?? '';
}

// ── Rendering ──

function appendMessage(role, content) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = role === 'user' ? 'You' : (settings.model || 'Assistant');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = role === 'assistant' ? parseMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');

    msg.appendChild(label);
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
}

function appendTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
}

function showError(msg) {
    const el = document.createElement('div');
    el.className = 'error-bubble';
    el.textContent = msg;
    messagesEl.appendChild(el);
    scrollToBottom();
}

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    userInputEl.disabled = on;
}

// ── Markdown parser ──

function parseMarkdown(text) {
    // Protect code blocks first, replace at end
    const blocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = blocks.length;
        blocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
        return `\x00BLOCK${i}\x00`;
    });

    // Inline code
    text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);

    // Bold and italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headers
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

    // Unordered lists (group consecutive lines)
    text = text.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, match => {
        const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*+] /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
    });

    // Ordered lists
    text = text.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, match => {
        const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*\d+\. /, '')}</li>`).join('');
        return `<ol>${items}</ol>`;
    });

    // Paragraphs: split on blank lines
    const parts = text.split(/\n{2,}/);
    text = parts.map(part => {
        part = part.trim();
        if (!part) return '';
        if (/^\x00BLOCK|^<(h[1-3]|ul|ol|pre)/.test(part)) return part;
        return `<p>${part.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    // Restore code blocks
    text = text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[Number(i)]);

    return text;
}

// ── Utils ──

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ──

init();
