/**
 * Per-session state that is not part of any document: the settings record
 * (theme, regional format) and a stable local identity. Views subscribe to
 * 'change' to re-render the pieces that show these.
 *
 * Everything is local: there is no account to sign in to and no server to ask.
 */

import { applyTheme } from '../ui/theme.js';
import { setLocale } from '../core/format.js';
import * as P from './platform.js';
import { setGuestStorage } from './account-storage.js';

class Session extends EventTarget {
  constructor() {
    super();
    // One namespace on this device, the same on every visit: there is no account to name it.
    setGuestStorage();
    this.settings = { theme: 'system' };
    this.user = P.LOCAL_USER;
    this.state = 'in';
  }

  async init() {
    this._adoptSettings(P.loadLocalSettings());
    this._emit();
  }

  _adoptSettings(settings) {
    const before = this.settings.locale || 'en-US';
    this.settings = settings;
    applyTheme(settings.theme || 'system');
    setLocale(settings.locale || 'en-US');
    if ((settings.locale || 'en-US') !== before && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app:locale', { detail: { locale: settings.locale || 'en-US' } }));
    }
  }

  get signedIn() { return true; }

  get signedOut() { return false; }

  signIn() { return Promise.resolve(true); }

  /** Regional format: how numbers and dates are shown and read (en-US, de-DE, ...). */
  async setLocale(code) {
    setLocale(code);
    window.dispatchEvent(new CustomEvent('app:locale', { detail: { locale: code } }));
    await this.update({ locale: code });
  }

  get username() { return 'You'; }

  async update(patch) {
    const next = this.settings = { ...this.settings, ...patch };
    this._emit();
    await P.saveSettings(patch, next);
  }

  async setTheme(mode) {
    applyTheme(mode);
    await this.update({ theme: mode });
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}

export const session = new Session();
