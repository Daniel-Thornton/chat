'use strict';

const SETTINGS_KEY  = 'chat_settings_v1';
const LAST_CHAT_KEY = 'last_chat_id';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, knowledgeable assistant. Answer clearly and concisely. Use markdown formatting where it helps readability — code blocks for code, bullet points for lists, bold for key terms.`;


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
const chatsBtn         = document.getElementById('chats-btn');
const chatsModal       = document.getElementById('chats-modal');
const newChatBtn       = document.getElementById('new-chat-btn');
const closeChatsBtn    = document.getElementById('close-chats');
const chatsListEl      = document.getElementById('chats-list');

// ── State ──

let settings = loadSettings();
let messages = []; // { role, content, images?, imageUrls? }
let messageEls = []; // parallel DOM elements for each entry in messages
let busy = false;
let darkMode = localStorage.getItem('darkMode') === 'true';
let pendingImages = []; // { dataUrl, base64 }
let currentChatId = null;
let currentChatCreatedAt = null;
let currentChatTitle = null;

// ── Boot ──

async function init() {
    applySettings();
    applyDarkMode();
    setupEventListeners();
    await restoreLastChat();
    userInputEl.focus();
}

// ── Dark mode ──

function applyDarkMode() {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    darkModeBtn.innerHTML = `<img src="icons/${darkMode ? 'mode-light' : 'mode-dark'}.png" alt="" width="16" height="16">`;
    darkModeBtn.title = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
    darkModeBtn.setAttribute('aria-label', darkMode ? 'Switch to light mode' : 'Switch to dark mode');

    const newChatIcon = document.getElementById('new-chat-icon');
    if (newChatIcon) newChatIcon.src = `icons/${darkMode ? 'new_chat_light' : 'new_chat_dark'}.png`;
    const newChatModalIcon = document.getElementById('new-chat-modal-icon');
    if (newChatModalIcon) newChatModalIcon.src = `icons/${darkMode ? 'new_chat_light' : 'new_chat_dark'}.png`;
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
    document.getElementById('close-settings-x').addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
    document.getElementById('close-chats-x').addEventListener('click', closeChatsPanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSettings(); closeChatsPanel(); } });

    darkModeBtn.addEventListener('click', toggleDarkMode);
    clearBtn.addEventListener('click', newChat);
    sendBtn.addEventListener('click', handleSend);
    chatsBtn.addEventListener('click', openChatsPanel);
    newChatBtn.addEventListener('click', newChat);
    closeChatsBtn.addEventListener('click', closeChatsPanel);
    chatsModal.addEventListener('click', e => { if (e.target === chatsModal) closeChatsPanel(); });

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

    setupVoiceInput();
}

// ── Voice input ──

function setupVoiceInput() {
    const micBtn = document.getElementById('mic-btn');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        micBtn.disabled = true;
        micBtn.title = 'Voice input not supported in this browser';
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let isListening = false;
    let interimStart = 0;

    micBtn.addEventListener('click', () => {
        if (isListening) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    recognition.addEventListener('start', () => {
        isListening = true;
        micBtn.classList.add('recording');
        micBtn.title = 'Recording… click to stop';
        micBtn.setAttribute('aria-label', 'Stop voice input');
        setStatus('Listening…');
        interimStart = userInputEl.value.length;
        if (interimStart > 0 && !userInputEl.value.endsWith(' ')) {
            userInputEl.value += ' ';
            interimStart = userInputEl.value.length;
        }
    });

    recognition.addEventListener('result', e => {
        const transcript = Array.from(e.results)
            .map(r => r[0].transcript)
            .join('');
        userInputEl.value = userInputEl.value.slice(0, interimStart) + transcript;
        userInputEl.style.height = 'auto';
        userInputEl.style.height = userInputEl.scrollHeight + 'px';
    });

    recognition.addEventListener('end', () => {
        isListening = false;
        micBtn.classList.remove('recording');
        micBtn.title = 'Voice input';
        micBtn.setAttribute('aria-label', 'Start voice input');
        setStatus('Ready');
        userInputEl.focus();
    });

    recognition.addEventListener('error', e => {
        isListening = false;
        micBtn.classList.remove('recording');
        micBtn.title = 'Voice input';
        micBtn.setAttribute('aria-label', 'Start voice input');
        const msg = e.error === 'not-allowed'
            ? 'Microphone access denied'
            : `Voice error: ${e.error}`;
        setStatus(msg);
        setTimeout(() => setStatus('Ready'), 3000);
    });
}

function openSettings()  { applySettings(); settingsModal.classList.remove('hidden'); }
function closeSettings() { settingsModal.classList.add('hidden'); }

// ── Chat history ──

function generateChatId() {
    return 'chat_' + Date.now();
}

async function getChatTitle() {
    if (currentChatTitle) return currentChatTitle;

    const first = messages.find(m => m.role === 'user');
    if (!first) return 'New Chat';

    const fallback = (() => {
        const text = (typeof first.content === 'string' ? first.content : 'Image conversation').trim();
        return text.length > 45 ? text.slice(0, 42) + '...' : text;
    })();

    if (!settings.tunnelUrl || messages.length < 2) return fallback;

    try {
        const transcript = messages
            .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : '[image]'}`)
            .join('\n');
        const response = await fetch(`${settings.tunnelUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.model || 'llama3.2',
                messages: [
                    { role: 'system', content: 'Generate a chat title of 6 words or fewer. Reply with ONLY the title, no punctuation, no quotes, no explanation.' },
                    { role: 'user', content: transcript }
                ],
                stream: false
            })
        });
        if (response.ok) {
            const data = await response.json();
            const title = data?.message?.content?.trim().replace(/^["']+|["']+$/g, '');
            if (title) {
                currentChatTitle = title;
                return currentChatTitle;
            }
        }
    } catch {}

    return fallback;
}

async function saveCurrentChat() {
    if (messages.length === 0 || !settings.tunnelUrl) return;
    if (!currentChatId) {
        currentChatId = generateChatId();
        currentChatCreatedAt = Date.now();
    }
    try {
        await fetch(`${settings.tunnelUrl}/api/chats/${currentChatId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: currentChatId,
                title: await getChatTitle(),
                createdAt: currentChatCreatedAt,
                updatedAt: Date.now(),
                messages: messages.slice()
            })
        });
        localStorage.setItem(LAST_CHAT_KEY, currentChatId);
    } catch {}
}

async function loadChat(id) {
    if (!settings.tunnelUrl) return;
    await saveCurrentChat();
    try {
        const r = await fetch(`${settings.tunnelUrl}/api/chats/${id}`);
        if (!r.ok) return;
        const chat = await r.json();
        currentChatId = chat.id;
        currentChatCreatedAt = chat.createdAt;
        currentChatTitle = chat.title || null;
        messages = chat.messages.slice();
        messageEls = [];
        localStorage.setItem(LAST_CHAT_KEY, currentChatId);
        messagesEl.innerHTML = '';
        messagesEl.appendChild(welcomeEl);
        if (messages.length === 0) {
            welcomeEl.classList.remove('hidden');
        } else {
            welcomeEl.classList.add('hidden');
            messages.forEach(m => appendMessage(m.role, m.content, m.imageUrls || []));
        }
        closeChatsPanel();
        userInputEl.focus();
    } catch {}
}

async function deleteChat(id) {
    if (settings.tunnelUrl) {
        try {
            await fetch(`${settings.tunnelUrl}/api/chats/${id}`, { method: 'DELETE' });
        } catch {}
    }
    if (currentChatId === id) {
        currentChatId = null;
        currentChatCreatedAt = null;
        currentChatTitle = null;
        localStorage.removeItem(LAST_CHAT_KEY);
    }
    renderChatsList();
}

async function restoreLastChat() {
    if (!settings.tunnelUrl) return;
    const lastId = localStorage.getItem(LAST_CHAT_KEY);
    if (!lastId) return;
    try {
        const r = await fetch(`${settings.tunnelUrl}/api/chats/${lastId}`);
        if (!r.ok) return;
        const chat = await r.json();
        if (!chat.messages?.length) return;
        currentChatId = chat.id;
        currentChatCreatedAt = chat.createdAt;
        currentChatTitle = chat.title || null;
        messages = chat.messages.slice();
        messageEls = [];
        welcomeEl.classList.add('hidden');
        messages.forEach(m => appendMessage(m.role, m.content, m.imageUrls || []));
    } catch {}
}

function formatChatDate(ts) {
    const d = new Date(ts);
    const diffDays = Math.floor((Date.now() - ts) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function renderChatsList() {
    chatsListEl.innerHTML = '<div class="chats-empty">Loading…</div>';
    let chats = [];
    if (settings.tunnelUrl) {
        try {
            const r = await fetch(`${settings.tunnelUrl}/api/chats`);
            if (r.ok) chats = await r.json();
        } catch {}
    }
    chatsListEl.innerHTML = '';
    if (chats.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chats-empty';
        empty.textContent = settings.tunnelUrl ? 'No saved chats yet.' : 'Set a tunnel URL in Settings to use chat history.';
        chatsListEl.appendChild(empty);
        return;
    }
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'chat-item-info';

        const title = document.createElement('div');
        title.className = 'chat-item-title';
        title.textContent = chat.title;

        const meta = document.createElement('div');
        meta.className = 'chat-item-meta';
        meta.textContent = formatChatDate(chat.updatedAt);

        info.appendChild(title);
        info.appendChild(meta);

        const del = document.createElement('button');
        del.className = 'chat-item-delete';
        del.setAttribute('aria-label', 'Delete chat');
        del.innerHTML = `<img src="icons/delete.png" alt="Delete" width="13" height="13">`;
        del.addEventListener('click', e => { e.stopPropagation(); deleteChat(chat.id); });

        item.appendChild(info);
        item.appendChild(del);
        item.addEventListener('click', () => loadChat(chat.id));
        chatsListEl.appendChild(item);
    });
}

function openChatsPanel()  { chatsModal.classList.remove('hidden'); renderChatsList(); }
function closeChatsPanel() { chatsModal.classList.add('hidden'); }

async function newChat() {
    await saveCurrentChat();
    currentChatId = null;
    currentChatCreatedAt = null;
    currentChatTitle = null;
    localStorage.removeItem(LAST_CHAT_KEY);
    messages = [];
    messageEls = [];
    pendingImages = [];
    renderImagePreviews();
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeEl);
    welcomeEl.classList.remove('hidden');
    closeChatsPanel();
    userInputEl.focus();
}

// ── Image handling ──

const IMAGE_MAX_PX  = 1024; // longest side cap before sending to API / saving
const IMAGE_QUALITY = 0.82;  // JPEG compression quality (0–1)

function compressImage(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, IMAGE_MAX_PX / Math.max(img.width, img.height));
            const w = Math.round(img.width  * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
            resolve({ dataUrl: compressed, base64: compressed.split(',')[1] });
        };
        img.src = dataUrl;
    });
}

function handleImageSelect() {
    const files = Array.from(imageInput.files);
    const readers = files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => compressImage(e.target.result).then(resolve);
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
    if (images.length > 0) {
        userMsg.images    = images.map(i => i.base64);
        userMsg.imageUrls = images.map(i => i.dataUrl);
    }

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
        saveCurrentChat();
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
                    ...history.map(({ imageUrls, ...rest }) => rest)
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
    const msgIndex = messageEls.length;
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const header = document.createElement('div');
    header.className = 'msg-header';

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = role === 'user' ? 'You' : (settings.model || 'Assistant');
    header.appendChild(label);

    if (role === 'user') {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-edit-btn';
        editBtn.title = 'Edit message';
        editBtn.setAttribute('aria-label', 'Edit message');
        editBtn.textContent = '✏';
        editBtn.addEventListener('click', () => enterEditMode(msg, msgIndex));
        header.appendChild(editBtn);
    }

    msg.appendChild(header);

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
    messageEls.push(msg);
    scrollToBottom();
    return msg;
}

function enterEditMode(msgEl, msgIndex) {
    if (busy) return;
    const bubble = msgEl.querySelector('.bubble');
    if (!bubble) return;

    const originalContent = messages[msgIndex].content;
    bubble.remove();

    const editArea = document.createElement('div');
    editArea.className = 'edit-area';

    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = originalContent;

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });

    const actions = document.createElement('div');
    actions.className = 'edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary';
    saveBtn.textContent = 'Save & Send';
    saveBtn.addEventListener('click', () => {
        const newText = textarea.value.trim();
        if (newText) submitEdit(msgIndex, newText);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelEdit(msgEl, originalContent, editArea));

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editArea.appendChild(textarea);
    editArea.appendChild(actions);
    msgEl.appendChild(editArea);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const newText = textarea.value.trim();
            if (newText) submitEdit(msgIndex, newText);
        }
        if (e.key === 'Escape') cancelEdit(msgEl, originalContent, editArea);
    });
}

function cancelEdit(msgEl, originalContent, editArea) {
    editArea.remove();
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = escapeHtml(originalContent).replace(/\n/g, '<br>');
    msgEl.appendChild(bubble);
}

async function submitEdit(msgIndex, newText) {
    if (!settings.tunnelUrl) {
        showError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.');
        return;
    }

    const origMsg = messages[msgIndex];
    const imageUrls = origMsg.imageUrls || [];
    const images = origMsg.images || [];

    // Remove all message DOM elements from msgIndex onwards
    for (let i = msgIndex; i < messageEls.length; i++) {
        messageEls[i].remove();
    }
    // Remove any stray typing indicators / error bubbles after the last kept message
    const lastKept = msgIndex > 0 ? messageEls[msgIndex - 1] : welcomeEl;
    let next = lastKept.nextSibling;
    while (next) {
        const toRemove = next;
        next = next.nextSibling;
        toRemove.remove();
    }

    messageEls.length = msgIndex;
    messages.length = msgIndex;

    const userMsg = { role: 'user', content: newText };
    if (images.length > 0) {
        userMsg.images = images;
        userMsg.imageUrls = imageUrls;
    }

    appendMessage('user', newText, imageUrls);
    messages.push(userMsg);

    const typingEl = appendTypingIndicator();
    setBusy(true);

    try {
        const reply = await callOllama(messages);
        typingEl.remove();
        appendMessage('assistant', reply);
        messages.push({ role: 'assistant', content: reply });
        saveCurrentChat();
    } catch (err) {
        typingEl.remove();
        showError(err.message);
    } finally {
        setBusy(false);
        userInputEl.focus();
    }
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

function setStatus(text) {
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = text;
}

function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    userInputEl.disabled = on;
    imageBtn.disabled = on;
    setStatus(on ? 'Thinking...' : 'Ready');
}

// ── Markdown parser ──

function parseMarkdown(text) {
    const blocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
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
