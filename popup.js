'use strict';

document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
        console.error('Ponude popup init failed:', error);
    });
});

const DEFAULT_SETTINGS = {
    themeMode: 'auto',
    uiLanguage: 'hr',
    pdfLanguage: 'hr',
    pdfRetentionDays: 8,
    pdfAccentColor: '#2c3e50',
    pdfLogoDataUrl: ''
};

const elements = {
    settingsToggle: null,
    settingsPanel: null,
    themeModeToggle: null,
    uiLanguageToggle: null,
    pdfLanguageToggle: null,
    retentionRange: null,
    retentionValue: null,
    pdfColorInput: null,
    pdfLogoInput: null,
    pdfLogoButton: null,
    pdfLogoClear: null,
    pdfLogoPreview: null
};

const state = {
    settings: { ...DEFAULT_SETTINGS },
    uiMessages: {},
    prefersDarkQuery: window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
};

async function init() {
    cacheElements();
    await loadSettings();
    await loadMessages();
    bindEvents();
    applyI18n();
    initTheme();
    updateSettingsUI();
}

function cacheElements() {
    elements.settingsToggle = getById('settings-toggle');
    elements.settingsPanel = getById('settings-panel');
    elements.themeModeToggle = getById('theme-mode-toggle');
    elements.uiLanguageToggle = getById('ui-language-toggle');
    elements.pdfLanguageToggle = getById('pdf-language-toggle');
    elements.retentionRange = getById('retention-range');
    elements.retentionValue = getById('retention-value');
    elements.pdfColorInput = getById('pdf-color-input');
    elements.pdfLogoInput = getById('pdf-logo-input');
    elements.pdfLogoButton = getById('pdf-logo-button');
    elements.pdfLogoClear = getById('pdf-logo-clear');
    elements.pdfLogoPreview = getById('pdf-logo-preview');
}

function getById(id) {
    return document.getElementById(id);
}

async function loadSettings() {
    const result = await chrome.storage.local.get([
        'themeMode',
        'uiLanguage',
        'pdfLanguage',
        'pdfRetentionDays',
        'pdfAccentColor',
        'pdfLogoDataUrl'
    ]);

    const legacyTheme = localStorage.getItem('theme');

    state.settings.themeMode = result.themeMode || legacyTheme || DEFAULT_SETTINGS.themeMode;
    state.settings.uiLanguage = normalizeLanguage(result.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
    state.settings.pdfLanguage = normalizeLanguage(result.pdfLanguage || state.settings.uiLanguage || DEFAULT_SETTINGS.pdfLanguage);
    state.settings.pdfRetentionDays = clampRetention(
        Number.isFinite(result.pdfRetentionDays) ? result.pdfRetentionDays : DEFAULT_SETTINGS.pdfRetentionDays
    );
    state.settings.pdfAccentColor = result.pdfAccentColor || DEFAULT_SETTINGS.pdfAccentColor;
    state.settings.pdfLogoDataUrl = result.pdfLogoDataUrl || DEFAULT_SETTINGS.pdfLogoDataUrl;
}

async function loadMessages() {
    state.uiMessages = await loadLocaleMessages(state.settings.uiLanguage);
}

function bindEvents() {
    if (elements.settingsToggle && elements.settingsPanel) {
        elements.settingsToggle.addEventListener('click', toggleSettingsPanel);
    }

    if (elements.themeModeToggle) {
        elements.themeModeToggle.addEventListener('click', toggleThemeMode);
    }
    if (elements.uiLanguageToggle) {
        elements.uiLanguageToggle.addEventListener('click', toggleUiLanguage);
    }
    if (elements.pdfLanguageToggle) {
        elements.pdfLanguageToggle.addEventListener('click', togglePdfLanguage);
    }

    if (elements.retentionRange) {
        elements.retentionRange.addEventListener('input', () => {
            state.settings.pdfRetentionDays = clampRetention(Number(elements.retentionRange.value));
            updateRetentionValue();
        });

        elements.retentionRange.addEventListener('change', async () => {
            state.settings.pdfRetentionDays = clampRetention(Number(elements.retentionRange.value));
            await chrome.storage.local.set({ pdfRetentionDays: state.settings.pdfRetentionDays });
        });
    }

    if (elements.pdfColorInput) {
        elements.pdfColorInput.addEventListener('input', async () => {
            state.settings.pdfAccentColor = elements.pdfColorInput.value;
            await chrome.storage.local.set({ pdfAccentColor: state.settings.pdfAccentColor });
        });
    }

    if (elements.pdfLogoButton && elements.pdfLogoInput) {
        elements.pdfLogoButton.addEventListener('click', () => elements.pdfLogoInput.click());
    }

    if (elements.pdfLogoInput) {
        elements.pdfLogoInput.addEventListener('change', async () => {
            const file = elements.pdfLogoInput.files && elements.pdfLogoInput.files[0];
            if (!file) return;
            const dataUrl = await readFileAsDataUrl(file);
            state.settings.pdfLogoDataUrl = dataUrl || '';
            await chrome.storage.local.set({ pdfLogoDataUrl: state.settings.pdfLogoDataUrl });
            updateLogoUI();
            elements.pdfLogoInput.value = '';
        });
    }

    if (elements.pdfLogoClear) {
        elements.pdfLogoClear.addEventListener('click', async () => {
            state.settings.pdfLogoDataUrl = '';
            await chrome.storage.local.set({ pdfLogoDataUrl: '' });
            updateLogoUI();
        });
    }

    if (state.prefersDarkQuery) {
        if (state.prefersDarkQuery.addEventListener) {
            state.prefersDarkQuery.addEventListener('change', handleSystemThemeChange);
        } else if (state.prefersDarkQuery.addListener) {
            state.prefersDarkQuery.addListener(handleSystemThemeChange);
        }
    }
}

function applyI18n() {
    document.documentElement.setAttribute('lang', state.settings.uiLanguage || 'en');

    const pageTitle = uiI18n('pageTitle');
    if (pageTitle) {
        document.title = pageTitle;
    }

    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        const message = uiI18n(key);
        if (message) {
            el.textContent = message;
        }
    });

    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        const message = uiI18n(key);
        if (message) {
            el.innerHTML = message;
        }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        const pairs = el.getAttribute('data-i18n-attr').split(',');
        pairs.forEach((pair) => {
            const [attr, key] = pair.split(':').map((part) => part.trim());
            if (!attr || !key) return;
            const message = uiI18n(key);
            if (message) {
                el.setAttribute(attr, message);
            }
        });
    });

    updateSettingsUI();
}

function toggleSettingsPanel() {
    const isOpen = elements.settingsPanel.classList.toggle('open');
    elements.settingsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    elements.settingsPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('settings-open', isOpen);
}

function updateSettingsUI() {
    if (elements.themeModeToggle) {
        const themeLabelKey = state.settings.themeMode === 'dark'
            ? 'themeDark'
            : state.settings.themeMode === 'light'
                ? 'themeLight'
                : 'themeAuto';
        elements.themeModeToggle.textContent = uiI18n(themeLabelKey);
    }

    if (elements.uiLanguageToggle) {
        const uiLangLabel = state.settings.uiLanguage === 'hr'
            ? uiI18n('languageCroatian')
            : uiI18n('languageEnglish');
        elements.uiLanguageToggle.textContent = uiLangLabel;
    }

    if (elements.pdfLanguageToggle) {
        const pdfLangLabel = state.settings.pdfLanguage === 'hr'
            ? uiI18n('languageCroatian')
            : uiI18n('languageEnglish');
        elements.pdfLanguageToggle.textContent = pdfLangLabel;
    }

    if (elements.retentionRange) {
        const stored = clampRetention(state.settings.pdfRetentionDays);
        elements.retentionRange.value = stored === RETENTION_FOREVER ? '17' : String(stored);
    }
    updateRetentionValue();

    if (elements.pdfColorInput) {
        elements.pdfColorInput.value = state.settings.pdfAccentColor || DEFAULT_SETTINGS.pdfAccentColor;
    }
    updateLogoUI();
}

function updateRetentionValue() {
    if (!elements.retentionValue) return;

    const days = clampRetention(state.settings.pdfRetentionDays);
    if (days === RETENTION_FOREVER) {
        elements.retentionValue.textContent = uiI18n('retentionForever') || 'Zauvijek';
        return;
    }
    if (days === 0) {
        elements.retentionValue.textContent = uiI18n('retentionImmediate') || '0 (cleared on close)';
        return;
    }

    if (days === 1) {
        const label = uiI18n('retentionDaysSingle') || 'day';
        elements.retentionValue.textContent = `1 ${label}`;
        return;
    }

    const label = uiI18n('retentionDaysPlural') || 'days';
    elements.retentionValue.textContent = `${days} ${label}`;
}

function updateLogoUI() {
    if (!elements.pdfLogoButton || !elements.pdfLogoClear || !elements.pdfLogoPreview) return;

    const hasLogo = Boolean(state.settings.pdfLogoDataUrl);
    elements.pdfLogoButton.textContent = hasLogo ? uiI18n('pdfLogoChange') : uiI18n('pdfLogoUpload');
    elements.pdfLogoClear.style.display = hasLogo ? 'inline-flex' : 'none';
    elements.pdfLogoPreview.classList.toggle('hidden', !hasLogo);

    if (!hasLogo) {
        elements.pdfLogoPreview.innerHTML = '';
        return;
    }

    elements.pdfLogoPreview.innerHTML = '';
    const img = document.createElement('img');
    img.alt = uiI18n('settingPdfLogo') || 'Logo';
    img.src = state.settings.pdfLogoDataUrl;
    elements.pdfLogoPreview.appendChild(img);
}

async function toggleThemeMode() {
    const order = ['auto', 'light', 'dark'];
    const currentIndex = order.indexOf(state.settings.themeMode);
    const nextMode = order[(currentIndex + 1) % order.length];
    state.settings.themeMode = nextMode;
    await chrome.storage.local.set({ themeMode: state.settings.themeMode });
    applyTheme(state.settings.themeMode);
    updateSettingsUI();
}

async function toggleUiLanguage() {
    state.settings.uiLanguage = state.settings.uiLanguage === 'hr' ? 'en' : 'hr';
    await chrome.storage.local.set({ uiLanguage: state.settings.uiLanguage });
    state.uiMessages = await loadLocaleMessages(state.settings.uiLanguage);
    applyI18n();
}

async function togglePdfLanguage() {
    state.settings.pdfLanguage = state.settings.pdfLanguage === 'hr' ? 'en' : 'hr';
    await chrome.storage.local.set({ pdfLanguage: state.settings.pdfLanguage });
    updateSettingsUI();
}

function initTheme() {
    applyTheme(state.settings.themeMode);
}

function applyTheme(mode) {
    const prefersDark = state.prefersDarkQuery ? state.prefersDarkQuery.matches : false;
    const useDark = mode === 'dark' || (mode === 'auto' && prefersDark);

    if (useDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function handleSystemThemeChange() {
    if (state.settings.themeMode === 'auto') {
        applyTheme('auto');
    }
}

const RETENTION_FOREVER = -1;
const RETENTION_MAX_DAYS = 16;

function clampRetention(value) {
    if (!Number.isFinite(value)) return DEFAULT_SETTINGS.pdfRetentionDays;
    if (value < 0) return RETENTION_FOREVER;
    if (value > RETENTION_MAX_DAYS) return RETENTION_FOREVER;
    return Math.floor(value);
}

function normalizeLanguage(language) {
    return window.AppShared && window.AppShared.normalizeLanguage
        ? window.AppShared.normalizeLanguage(language)
        : (String(language || 'hr').toLowerCase().startsWith('en') ? 'en' : 'hr');
}

function loadLocaleMessages(language) {
    if (!language) return Promise.resolve({});
    if (window.AppShared && window.AppShared.loadLocaleMessages) {
        return window.AppShared.loadLocaleMessages(language);
    }
    return Promise.resolve({});
}

function formatMessage(template, substitutions) {
    if (window.AppShared && window.AppShared.formatMessage) {
        return window.AppShared.formatMessage(template, substitutions);
    }
    if (!template) return '';
    if (!Array.isArray(substitutions) || substitutions.length === 0) return template;
    return template.replace(/\$(\d+)/g, (match, index) => {
        const value = substitutions[Number(index) - 1];
        return value === undefined ? '' : value;
    });
}

function getMessage(messages, key, substitutions) {
    if (!messages || !messages[key] || !messages[key].message) return '';
    return formatMessage(messages[key].message, substitutions);
}

function uiI18n(key, substitutions) {
    const message = getMessage(state.uiMessages, key, substitutions);
    if (message) return message;
    if (chrome.i18n && chrome.i18n.getMessage) {
        return chrome.i18n.getMessage(key, substitutions);
    }
    return '';
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
    });
}
