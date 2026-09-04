import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { nativeSelectInputLabelProps } from './nativeSelect.js';

const [appSource, controllerSource] = await Promise.all([
  readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/ControllerPage.tsx', import.meta.url), 'utf8'),
]);

describe('native select labels', () => {
  it('always shrinks labels so selected and placeholder values are not obscured', () => {
    expect(nativeSelectInputLabelProps).toEqual({ shrink: true });
    expect(appSource.match(/InputLabelProps=\{nativeSelectInputLabelProps\}/g)).toHaveLength(4);
    expect(controllerSource).toContain('InputLabelProps={nativeSelectInputLabelProps}');
  });
});
