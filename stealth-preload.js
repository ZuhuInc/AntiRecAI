/**
 * AntiRecAI Stealth Preload for Google OAuth & Cloud AI Providers
 * Removes Chromium automation flags and standardizes navigator properties.
 */

try {
  // 1. Remove navigator.webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });

  // 2. Ensure standard window.chrome properties exist
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {};
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    };
  }

  // 3. Mock languages & plugins for consistency
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true
    });
  }
} catch (e) {
  // Silent fallback
}
