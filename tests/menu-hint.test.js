// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { stylesheet, declared } from './helpers/css.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

// The account menu gave "Sign in to Puter" a hint, "Save sheets to your own cloud", that the menu
// never rendered: menu items had no hint. It is now a muted second line under the label, and the item's
// description rather than part of its name.
describe('a menu item hint', () => {
  it('is rendered as a second line and spoken as the description of an item named by its label', () => {
    openMenu({ x: 10, y: 10, items: [{ label: 'Sign in', hint: 'Save sheets to your own cloud' }, { label: 'Plain' }] });
    const [withHint, plain] = document.querySelectorAll('.menu-item');
    const hint = withHint.querySelector('.menu-hint');
    expect(hint.textContent).toBe('Save sheets to your own cloud');
    expect(withHint.querySelector('.menu-label').contains(hint)).toBe(true);
    expect(withHint.getAttribute('aria-label')).toBe('Sign in');
    expect(withHint.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.id).toBeTruthy();
    expect(plain.querySelector('.menu-hint')).toBeNull();
    expect(plain.hasAttribute('aria-describedby')).toBe(false);
    expect(plain.hasAttribute('aria-label')).toBe(false);
  });

  it('is styled as a muted line of its own', () => {
    const rule = declared(stylesheet('components.css'), '.menu-hint');
    expect(rule.display).toBe('block');
    expect(rule.color).toBe('var(--ink-3)');
    expect(parseFloat(rule['font-size'])).toBeLessThan(13.5);
  });
});

