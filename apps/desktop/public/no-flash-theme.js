/**
 * Applies the persisted appearance and language before first paint.
 *
 * This file is referenced from index.html as a classic (non-module, non-deferred)
 * script. It must stay that way: Tauri's CSP is `script-src 'self'` with no
 * `'unsafe-inline'`, so an inline script would be blocked and the theme would
 * flash. Do not move this logic into the bundle, and do not add `type="module"`
 * or `defer`.
 *
 * It sets className, dir and lang together on purpose. Setting only the theme
 * class still leaves an LTR frame on an Arabic machine, which is the same flash
 * problem wearing a different hat.
 */
(function applyStoredPreferences() {
  var root = document.documentElement;
  var STORAGE_KEY = 'adham.appearance';

  var stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or a blocked storage partition: fall through to system.
  }

  var systemPrefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  var resolved =
    stored === 'light' || stored === 'dark' ? stored : systemPrefersDark ? 'dark' : 'light';
  root.classList.toggle('dark', resolved === 'dark');

  var language = null;
  try {
    language = window.localStorage.getItem('adham.language');
  } catch {
    // Same fallback as above.
  }

  // Supported set mirrors SUPPORTED_LANGUAGES in
  // apps/desktop/src/shared/i18n/languages.ts (kept inline: this classic
  // script cannot import modules). normalizeLanguage() there is authoritative.
  var SUPPORTED = { en: 1, ar: 1, 'zh-CN': 1, ru: 1 };
  function normalize(tag) {
    var lower = String(tag || '')
      .toLowerCase()
      .replace('_', '-');
    if (SUPPORTED[lower]) return lower;
    var base = lower.split('-')[0];
    if (base === 'ar') return 'ar';
    if (base === 'zh') return 'zh-CN';
    if (base === 'ru') return 'ru';
    return 'en';
  }

  if (language === null || !SUPPORTED[language]) {
    var tags =
      window.navigator.languages && window.navigator.languages.length > 0
        ? window.navigator.languages
        : [window.navigator.language || 'en'];
    language = 'en';
    for (var i = 0; i < tags.length; i++) {
      var code = normalize(tags[i]);
      if (code !== 'en') {
        language = code;
        break;
      }
    }
    if (language === 'en' && tags.length > 0) language = normalize(tags[0]);
  }

  root.setAttribute('lang', language);
  root.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
})();
