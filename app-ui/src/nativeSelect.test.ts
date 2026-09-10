import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [appSource, controllerSource, selectSource, themeSource] = await Promise.all([
  readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/ControllerPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./designSystemSelect.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./main.tsx', import.meta.url), 'utf8'),
]);

describe('design-system selects', () => {
  it('replaces native browser selects with accessible styled MUI menus', () => {
    expect(appSource).toContain("WallySelect");
    expect(controllerSource).toContain("WallySelect");
    expect(`${appSource}\n${controllerSource}`).not.toMatch(/native:\s*true|<option/);
    expect(selectSource).toContain('MenuItem');
    expect(selectSource).toContain("className: 'wally-select-menu'");
    expect(themeSource).toContain('MuiMenuItem');
    expect(themeSource).toContain('#d8a54b');
  });
});
