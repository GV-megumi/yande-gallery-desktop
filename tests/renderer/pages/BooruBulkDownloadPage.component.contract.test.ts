import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('BooruBulkDownloadPage component contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/renderer/pages/BooruBulkDownloadPage.tsx');
  const source = readFileSync(pagePath, 'utf-8');

  it('uses the renderer app-event hook instead of hand-written system.onAppEvent subscriptions', () => {
    expect(source).toContain('useRendererAppEvent([');
    expect(source).not.toContain('window.electronAPI?.system?.onAppEvent');
    expect(source).toContain("event.type === 'bulk-download:sessions-changed'");
    expect(source).toContain("event.type === 'bulk-download:tasks-changed'");
    expect(source).toContain("event.type === 'bulk-download:records-changed'");
    expect(source).toContain("event.type === 'favorite-tag-download:created'");
  });
});
