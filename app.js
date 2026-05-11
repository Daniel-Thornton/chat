'use strict';

const SETTINGS_KEY = 'chat_settings_v1';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Answer clearly and concisely. Use markdown formatting where it helps readability — code blocks for code, bullet points for lists, bold for key terms.`;

const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const SUN_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

// ── DOM ──

const messagesEl       = document.getElementById('messages');
const welcomeEl        = document.getElementById('welcome');
const userInputEl      = document.getElementById('user-input');
const sendBtn          = document.getElementById('send-btn');
const clearBtn         = document.getElementById('clear-btn');
const settingsBtn      = document.getElementById('settings-btn');
const darkModeBtn      = document.getElementById('dark-mode-btn');
const settingsModal    = document.getElementById('settings-modal');
const tunnelUrlIn      = document.getElementById('tunnel-url');
const modelNameIn      = document.getElementById('model-name');
const systemPromptIn   = document.getElementById('system-prompt');
const saveSettingsBtn  = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const modelBadge       = document.getElementById('model-badge');
const braveApiKeyIn    = document.getElementById('brave-api-key');
const imageBtn         = document.getElementById('image-btn');
const imageInput       = document.getElementById('image-input');
const imagePreviewBar  = document.getElementById('image-preview-bar');

// ── State ──

let settings = loadSettings();
let messages = []; // { role, content, images? }
let busy = false;
let darkMode = localStorage.getItem('darkMode') === 'true';
let pendingImages = []; // { dataUrl, base64 }

// ── Boot ──

function init() {
    applySettings();
    applyDarkMode();
    setupEventListeners();
    userInputEl.focus();
}

// ── Dark mode ──

function applyDarkMode() {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    darkModeBtn.innerHTML = darkMode ? SUN_SVG : MOON_SVG;
    darkModeBtn.title = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
    darkModeBtn.setAttribute('aria-label', darkMode ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleDarkMode() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', String(darkMode));
    applyDarkMode();
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
    braveApiKeyIn.value  = settings.braveApiKey  || '';
    systemPromptIn.value = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

function persistSettings() {
    settings.tunnelUrl    = tunnelUrlIn.value.trim().replace(/\/+$/, '');
    settings.model        = modelNameIn.value.trim() || 'llama3.2';
    settings.braveApiKey  = braveApiKeyIn.value.trim();
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

    darkModeBtn.addEventListener('click', toggleDarkMode);
    clearBtn.addEventListener('click', clearConversation);
    sendBtn.addEventListener('click', handleSend);

    userInputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    userInputEl.addEventListener('input', () => {
        userInputEl.style.height = 'auto';
        userInputEl.style.height = userInputEl.scrollHeight + 'px';
    });

    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageSelect);
}

function openSettings()  { applySettings(); settingsModal.classList.remove('hidden'); }
function closeSettings() { settingsModal.classList.add('hidden'); }

function clearConversation() {
    messages = [];
    pendingImages = [];
    renderImagePreviews();
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.classList.remove('hidden');
    userInputEl.focus();
}

// ── Image handling ──

function handleImageSelect() {
    const files = Array.from(imageInput.files);
    const readers = files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
            const dataUrl = e.target.result;
            resolve({ dataUrl, base64: dataUrl.split(',')[1] });
        };
        reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(imgs => {
        pendingImages.push(...imgs);
        imageInput.value = '';
        renderImagePreviews();
    });
}

function renderImagePreviews() {
    if (pendingImages.length === 0) {
        imagePreviewBar.classList.add('hidden');
        imagePreviewBar.innerHTML = '';
        return;
    }
    imagePreviewBar.classList.remove('hidden');
    imagePreviewBar.innerHTML = '';
    pendingImages.forEach((img, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'preview-thumb';

        const imgEl = document.createElement('img');
        imgEl.src = img.dataUrl;
        imgEl.alt = '';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'preview-remove';
        removeBtn.setAttribute('aria-label', 'Remove image');
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            pendingImages.splice(i, 1);
            renderImagePreviews();
        });

        wrap.appendChild(imgEl);
        wrap.appendChild(removeBtn);
        imagePreviewBar.appendChild(wrap);
    });
}

// ── Send ──

async function handleSend() {
    const text = userInputEl.value.trim();
    if ((!text && pendingImages.length === 0) || busy) return;

    if (!settings.tunnelUrl) {
        showError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.');
        return;
    }

    welcomeEl.classList.add('hidden');

    const images = [...pendingImages];
    pendingImages = [];
    renderImagePreviews();

    const userMsg = { role: 'user', content: text };
    if (images.length > 0) userMsg.images = images.map(i => i.base64);

    appendMessage('user', text, images.map(i => i.dataUrl));
    messages.push(userMsg);

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
                stream: false,
                ...(settings.braveApiKey ? { braveApiKey: settings.braveApiKey } : {})
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

function appendMessage(role, content, imageUrls = []) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = role === 'user' ? 'You' : (settings.model || 'Assistant');
    msg.appendChild(label);

    if (imageUrls.length > 0) {
        const imgRow = document.createElement('div');
        imgRow.className = 'bubble-images';
        imageUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'bubble-image';
            img.alt = 'Attached image';
            imgRow.appendChild(img);
        });
        msg.appendChild(imgRow);
    }

    if (content) {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = role === 'assistant'
            ? parseMarkdown(content)
            : escapeHtml(content).replace(/\n/g, '<br>');
        msg.appendChild(bubble);
    }

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
    imageBtn.disabled = on;
}

// ── Markdown parser ──

function parseMarkdown(text) {
    const blocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = blocks.length;
        blocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
        return `\x00BLOCK${i}\x00`;
    });

    text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);

    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

    text = text.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, match => {
        const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*+] /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
    });

    text = text.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, match => {
        const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*\d+\. /, '')}</li>`).join('');
        return `<ol>${items}</ol>`;
    });

    const parts = text.split(/\n{2,}/);
    text = parts.map(part => {
        part = part.trim();
        if (!part) return '';
        if (/^\x00BLOCK|^<(h[1-3]|ul|ol|pre)/.test(part)) return part;
        return `<p>${part.replace(/\n/g, '<br>')}</p>`;
    }).join('');

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
