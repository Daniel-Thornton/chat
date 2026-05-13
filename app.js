'use strict';

const STORAGE_KEY = 'calorie_log_v1';
const SETTINGS_KEY = 'calorie_settings_v1';

const SYSTEM_PROMPT = `You are a calorie estimation assistant. The user will describe food they have eaten.
You must respond ONLY with a valid JSON object and nothing else — no explanation, no markdown formatting, no code fences, no prose.
Use this exact structure:
{
  "items": [
    { "name": "food item description", "calories": 150 }
  ],
  "total_calories": 150,
  "notes": "brief note about the estimates, or empty string if nothing notable"
}
Rules:
- Estimate based on typical serving sizes when quantities are not specified.
- Keep item names short and clear.
- total_calories must equal the sum of all item calories.
- Respond with ONLY the JSON object, nothing else.

Known calorie values:
Huel drink = 400`;

// ── DOM references ──

const voiceBtn       = document.getElementById('voice-btn');
const voiceStatus    = document.getElementById('voice-status');
const mealInput      = document.getElementById('meal-input');
const logBtn         = document.getElementById('log-btn');
const loadingEl      = document.getElementById('loading');
const logEntriesEl   = document.getElementById('log-entries');
const totalCaloriesEl= document.getElementById('total-calories');
const currentDateEl  = document.getElementById('current-date');
const errorBanner    = document.getElementById('error-banner');
const settingsBtn    = document.getElementById('settings-btn');
const settingsModal  = document.getElementById('settings-modal');
const tunnelUrlInput = document.getElementById('tunnel-url');
const modelNameInput = document.getElementById('model-name');
const saveSettingsBtn  = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const cancelSettingsBtn= document.getElementById('cancel-settings');
const targetKcalInput  = document.getElementById('target-kcal');
const statsContent   = document.getElementById('stats-content');
const streakDisplay  = document.getElementById('streak-display');

// ── State ──

let settings    = loadSettings();
let recognition = null;
let isRecording = false;

// ── Boot ──

async function init() {
    currentDateEl.textContent = formatDate(new Date());
    tunnelUrlInput.value = settings.tunnelUrl || '';
    modelNameInput.value = settings.model || 'llama3.2';
    setupSpeechRecognition();
    setupEventListeners();
    await refreshView();
}

// ── Settings ──

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
}

function persistSettings() {
    settings.tunnelUrl  = tunnelUrlInput.value.trim().replace(/\/+$/, '');
    settings.model      = modelNameInput.value.trim() || 'llama3.2';
    settings.targetKcal = parseInt(targetKcalInput.value) || 0;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Event wiring ──

function setupEventListeners() {
    settingsBtn.addEventListener('click', openSettings);
    saveSettingsBtn.addEventListener('click', () => { persistSettings(); closeSettings(); });
    closeSettingsBtn.addEventListener('click', closeSettings);
    cancelSettingsBtn.addEventListener('click', closeSettings);
    document.getElementById('download-log').addEventListener('click', downloadLog);
    document.getElementById('upload-log').addEventListener('change', e => {
        if (e.target.files[0]) uploadLog(e.target.files[0]);
        e.target.value = '';
    });
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

    voiceBtn.addEventListener('click', toggleRecording);
    logBtn.addEventListener('click', handleLogMeal);

    logEntriesEl.addEventListener('click', async e => {
        const btn = e.target.closest('.log-delete');
        if (btn) await deleteLogEntry(getTodayKey(), Number(btn.dataset.id));
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function openSettings() {
    tunnelUrlInput.value  = settings.tunnelUrl || '';
    modelNameInput.value  = settings.model || 'llama3.2';
    targetKcalInput.value = settings.targetKcal || '';
    settingsModal.classList.remove('hidden');
    tunnelUrlInput.focus();
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

// ── Tabs ──

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
    if (tab === 'stats') renderStats();
}

// ── Speech recognition ──

function setupSpeechRecognition() {
    const w  = /** @type {any} */ (window);
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
        voiceStatus.textContent = 'Voice input not supported in this browser (try Chrome)';
        voiceBtn.disabled = true;
        return;
    }

    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.addEventListener('result', e => {
        mealInput.value = Array.from(e.results).map(r => r[0].transcript).join('');
    });
    recognition.addEventListener('end', () => {
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceStatus.textContent = 'Tap to speak';
    });
    recognition.addEventListener('error', e => {
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceStatus.textContent = e.error === 'not-allowed' ? 'Microphone access denied' : `Error: ${e.error}`;
    });
}

function toggleRecording() {
    if (!recognition) return;
    if (isRecording) {
        recognition.stop();
    } else {
        mealInput.value = '';
        recognition.start();
        isRecording = true;
        voiceBtn.classList.add('recording');
        voiceStatus.textContent = 'Listening...';
    }
}

// ── Data layer ──

// Returns the full log, preferring the server and falling back to localStorage cache.
async function loadLog() {
    if (settings.tunnelUrl) {
        try {
            const res = await fetch(`${settings.tunnelUrl}/log`);
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                return data;
            }
        } catch { /* fall through */ }
    }
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}

// Adds a single entry to the server (and updates the localStorage cache).
async function saveEntry(date, entry) {
    if (settings.tunnelUrl) {
        const res = await fetch(`${settings.tunnelUrl}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, entry })
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
    }

    // Keep localStorage in sync as a cache
    const log = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    if (!log[date]) log[date] = [];
    log[date].push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

// Removes an entry from the server (and updates the localStorage cache).
async function removeEntry(date, id) {
    if (settings.tunnelUrl) {
        await fetch(`${settings.tunnelUrl}/log/${date}/${id}`, { method: 'DELETE' });
    }

    const log = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    if (log[date]) {
        log[date] = log[date].filter(e => e.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    }
}

// ── Meal logging ──

async function handleLogMeal() {
    const text = mealInput.value.trim();
    if (!text) { showError('Please describe what you ate first.'); return; }
    if (!settings.tunnelUrl) { showError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.'); return; }

    clearError();
    setLoading(true);

    try {
        const result = await callOllama(text);
        const entry = {
            id: Date.now(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            items: result.items,
            total: result.total_calories,
            notes: result.notes || ''
        };
        await saveEntry(getTodayKey(), entry);
        mealInput.value = '';
        await refreshView();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
}

async function deleteLogEntry(date, id) {
    await removeEntry(date, id);
    await refreshView();
}

async function callOllama(mealDescription) {
    const model = settings.model || 'llama3.2';

    let response;
    try {
        response = await fetch(`${settings.tunnelUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: mealDescription }
                ],
                stream: false
            })
        });
    } catch {
        throw new Error('Could not reach your home PC. Check that the server is running and the tunnel is active.');
    }

    if (!response.ok) throw new Error(`Ollama error (HTTP ${response.status}). Check the model name in Settings.`);

    const data = await response.json();
    const raw = data?.message?.content ?? '';
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch {
        throw new Error(`The model returned invalid JSON. Try rephrasing.\n\nResponse: "${cleaned.slice(0, 200)}"`);
    }

    if (!Array.isArray(parsed.items) || typeof parsed.total_calories !== 'number') {
        throw new Error('Unexpected response format. Try a different model.');
    }

    return parsed;
}

// ── Import / Export ──

async function downloadLog() {
    const log = await loadLog();
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `calorie-log-${getTodayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function uploadLog(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        showError('Could not read file — make sure it is a valid JSON log.');
        return;
    }

    if (typeof data !== 'object' || Array.isArray(data)) {
        showError('Unrecognised format — file must be a calorie log JSON object.');
        return;
    }

    if (settings.tunnelUrl) {
        const res = await fetch(`${settings.tunnelUrl}/log`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) { showError('Failed to upload log to server.'); return; }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    closeSettings();
    await refreshView();
}

// ── View ──

async function refreshView() {
    const log = await loadLog();
    renderStreak(log);
    renderTodayLog(log);
}

function renderStreak(log) {
    const today     = getTodayKey();
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

    const sortedDates = Object.keys(log)
        .filter(d => (log[d] || []).some(e => e.total > 0))
        .sort();

    const streak       = calcStreak(sortedDates);
    const loggedToday  = sortedDates.includes(today);
    const hasStreak    = streak > 0;
    const atRisk       = !loggedToday && sortedDates.includes(yesterday) && hasStreak;

    let state, title, sub, displayCount;

    if (loggedToday && hasStreak) {
        state = 'active'; displayCount = streak;
        title = `${streak} day streak`;
        sub = streak === 1 ? 'Logged today — come back tomorrow!' : 'Logged today — keep it up!';
    } else if (atRisk) {
        state = 'risk'; displayCount = streak;
        title = `${streak} day streak at risk`;
        sub = 'Log a meal today before midnight to keep it going!';
    } else {
        state = 'none'; displayCount = 0;
        title = hasStreak ? 'Streak ended' : '0 day streak';
        sub = hasStreak
            ? `Best was ${streak} days. Start a new one by logging today.`
            : 'Log every day to build your streak.';
    }

    streakDisplay.innerHTML = `
        <div class="streak-bar state-${state}">
            <span class="streak-count">${displayCount}</span>
            <div class="streak-text">
                <span class="streak-title">${escapeHtml(title)}</span>
                <span class="streak-sub">${escapeHtml(sub)}</span>
            </div>
        </div>
    `;
}

function renderTodayLog(log) {
    const today   = getTodayKey();
    const entries = log[today] || [];
    const total   = entries.reduce((s, e) => s + e.total, 0);

    totalCaloriesEl.textContent = `${total} kcal`;

    if (entries.length === 0) {
        logEntriesEl.innerHTML = '<p class="empty-log">No meals logged today</p>';
        return;
    }

    logEntriesEl.innerHTML = entries.map(entry => `
        <div class="log-entry">
            <div class="log-entry-header">
                <span class="log-entry-time">${escapeHtml(entry.time)}</span>
                <div class="log-entry-right">
                    <span class="log-entry-kcal">${entry.total} kcal</span>
                    <button class="log-delete" data-id="${entry.id}" aria-label="Delete entry">remove</button>
                </div>
            </div>
            ${entry.items.map(item => `
                <div class="log-item">
                    <span class="log-item-name">${escapeHtml(item.name)}</span>
                    <span class="log-item-cal">${item.calories} kcal</span>
                </div>
            `).join('')}
            ${entry.notes ? `<p class="log-entry-note">${escapeHtml(entry.notes)}</p>` : ''}
        </div>
    `).join('');
}

async function renderStats() {
    statsContent.innerHTML = '<div class="stats-empty">Loading...</div>';
    const log = await loadLog();

    const dailyTotals = Object.entries(log)
        .map(([date, entries]) => ({
            date,
            total: entries.reduce((s, e) => s + e.total, 0),
            meals: entries.length
        }))
        .filter(d => d.total > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (dailyTotals.length === 0) {
        statsContent.innerHTML = '<div class="stats-empty">No data yet — start logging meals to see statistics.</div>';
        return;
    }

    const avg     = Math.round(dailyTotals.reduce((s, d) => s + d.total, 0) / dailyTotals.length);
    const highest = dailyTotals.reduce((m, d) => d.total > m.total ? d : m);
    const lowest  = dailyTotals.reduce((m, d) => d.total < m.total ? d : m);
    const streak  = calcStreak(dailyTotals.map(d => d.date));
    const target  = settings.targetKcal || 0;
    const mood    = target > 0 ? getMoodForAvg(avg, target) : null;

    statsContent.innerHTML = `
        <div class="stat-cards">
            <div class="stat-card stat-card-avg">
                <div class="stat-avg-main">
                    <div class="stat-card-value">${avg.toLocaleString()}</div>
                    <div class="stat-card-label">Avg kcal / day</div>
                    <div class="stat-card-sub">${target > 0 ? `Target: ${target.toLocaleString()} kcal` : 'No target set'}</div>
                </div>
                ${mood ? `
                <div class="stat-mood-block">
                    <img class="stat-mood-icon" src="icons/moods/${mood.icon}" alt="${escapeHtml(mood.label)}" title="${escapeHtml(mood.label)}">
                    <div class="stat-avg-mood-label">${escapeHtml(mood.label)}</div>
                </div>` : ''}
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${dailyTotals.length}</div>
                <div class="stat-card-label">Days logged</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${highest.total.toLocaleString()}</div>
                <div class="stat-card-label">Highest day</div>
                <div class="stat-card-sub">${formatShortDate(highest.date)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${lowest.total.toLocaleString()}</div>
                <div class="stat-card-label">Lowest day</div>
                <div class="stat-card-sub">${formatShortDate(lowest.date)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-value">${streak}</div>
                <div class="stat-card-label">Day streak</div>
            </div>
        </div>

        <div class="chart-card">
            <h3>Last ${Math.min(dailyTotals.length, 14)} days</h3>
            <div class="chart-wrap">${buildChart(dailyTotals, avg)}</div>
        </div>

        <div class="history-card">
            <h3>All days</h3>
            ${[...dailyTotals].reverse().map(d => `
                <div class="history-row">
                    <span class="history-date">${formatShortDate(d.date)}</span>
                    <span class="history-meals">${d.meals} meal${d.meals !== 1 ? 's' : ''}</span>
                    <span class="history-kcal">${d.total.toLocaleString()} kcal</span>
                </div>
            `).join('')}
        </div>
    `;

}

function getMoodForAvg(avg, target) {
    const pct = Math.abs(avg - target) / target;
    if (pct <= 0.05) return { icon: 'detective_01.png',          label: 'On target!' };
    if (pct <= 0.15) return { icon: 'detective_02.png', label: 'Close to target' };
    if (pct <= 0.30) return { icon: 'detective_03.png', label: 'Somewhat off target' };
    if (pct <= 0.50) return { icon: 'detective_04.png',   label: 'Off target' };
    return                   { icon: 'detective_05.png',            label: 'Far from target' };
}

function buildChart(dailyTotals, avg) {
    const recent   = dailyTotals.slice(-14);
    const svgW     = 540, svgH = 190;
    const padL     = 8, padR = 8, padTop = 24, padBottom = 32;
    const barAreaH = svgH - padTop - padBottom;
    const barAreaW = svgW - padL - padR;
    const slot     = barAreaW / recent.length;
    const barW     = Math.max(Math.floor(slot * 0.6), 4);
    const maxVal   = Math.max(...recent.map(d => d.total), avg * 1.1);
    const avgY     = padTop + barAreaH - Math.round((avg / maxVal) * barAreaH);

    const bars = recent.map((d, i) => {
        const barH  = Math.max(Math.round((d.total / maxVal) * barAreaH), 2);
        const x     = padL + i * slot + (slot - barW) / 2;
        const y     = padTop + barAreaH - barH;
        const label = `${parseInt(d.date.slice(8))}/${parseInt(d.date.slice(5, 7))}`;
        const today = d.date === getTodayKey();
        return `
            <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="0"
                  fill="${today ? '#000080' : '#1084d0'}" opacity="${today ? 1 : 0.8}"/>
            <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9"
                  fill="var(--text-muted)" font-family="inherit">
                ${d.total >= 1000 ? (Math.round(d.total / 100) / 10) + 'k' : d.total}
            </text>
            <text x="${x + barW / 2}" y="${svgH - padBottom + 14}" text-anchor="middle" font-size="9"
                  fill="${today ? '#000080' : 'var(--text-muted)'}"
                  font-weight="${today ? 600 : 400}" font-family="inherit">${label}</text>
        `;
    });

    return `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;display:block;overflow:visible">
        <line x1="${padL}" y1="${avgY}" x2="${svgW - padR}" y2="${avgY}"
              stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
        <text x="${svgW - padR - 2}" y="${avgY - 4}" text-anchor="end" font-size="8"
              fill="var(--text-muted)" font-family="inherit">avg</text>
        ${bars.join('')}
    </svg>`;
}

// ── Helpers ──

function calcStreak(sortedDates) {
    if (!sortedDates.length) return 0;
    const today     = getTodayKey();
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const last      = sortedDates[sortedDates.length - 1];
    if (last !== today && last !== yesterday) return 0;

    let streak = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
        const diff = (new Date(sortedDates[i + 1]) - new Date(sortedDates[i])) / 864e5;
        if (diff === 1) streak++;
        else break;
    }
    return streak;
}

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

function setLoading(on) {
    loadingEl.classList.toggle('hidden', !on);
    logBtn.disabled = on;
    voiceBtn.disabled = on;
}

function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
}

function clearError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('hidden');
}

function formatDate(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatShortDate(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ──

init();
