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

  if (language === null) {
    var navigatorLanguage = window.navigator.language || 'en';
    language = navigatorLanguage.toLowerCase().indexOf('ar') === 0 ? 'ar' : navigatorLanguage;
  }

  root.setAttribute('lang', language);
  root.setAttribute('dir', language.toLowerCase().indexOf('ar') === 0 ? 'rtl' : 'ltr');
})();
