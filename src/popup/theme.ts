import type { Theme } from '@/types';

/**
 * Applies the chosen theme by stamping `data-theme` on the root element. When the
 * theme is "system", the attribute is removed so the CSS `prefers-color-scheme`
 * media query takes over.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
