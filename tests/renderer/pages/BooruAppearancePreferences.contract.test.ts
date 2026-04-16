import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Booru 页面外观偏好读取契约', () => {
  const pageNames = [
    'BooruPage.tsx',
    'BooruFavoritesPage.tsx',
    'BooruArtistPage.tsx',
    'BooruCharacterPage.tsx',
    'BooruServerFavoritesPage.tsx',
    'BooruTagSearchPage.tsx',
    'BooruPostDetailsPage.tsx',
  ] as const;

  it('目标页面不应再直接通过 config.get 读取 booru.appearance', () => {
    for (const pageName of pageNames) {
      const pagePath = path.resolve(process.cwd(), 'src/renderer/pages', pageName);
      const source = readFileSync(pagePath, 'utf-8');

      expect(source).not.toContain('window.electronAPI.config.get()');
      expect(source).not.toContain('window.electronAPI.config.onConfigChanged');
      expect(source).toContain('window.electronAPI.booruPreferences.appearance.get()');
    }
  });


  it('BooruPage 应通过 booruPreferences.appearance.onChanged 监听外观变更', () => {
    const pagePath = path.resolve(process.cwd(), 'src/renderer/pages/BooruPage.tsx');
    const source = readFileSync(pagePath, 'utf-8');

    expect(source).toContain('window.electronAPI?.booruPreferences?.appearance?.onChanged');
    expect(source).toContain('window.electronAPI.booruPreferences.appearance.onChanged');
    expect(source).not.toContain('window.electronAPI.config.onConfigChanged');
  });

  it('除 BooruPage 外的目标页面不应继续监听 config.onConfigChanged 读取外观', () => {
    const pagesWithoutLiveListener = pageNames.filter((pageName) => pageName !== 'BooruPage.tsx');

    for (const pageName of pagesWithoutLiveListener) {
      const pagePath = path.resolve(process.cwd(), 'src/renderer/pages', pageName);
      const source = readFileSync(pagePath, 'utf-8');

      expect(source).not.toContain('window.electronAPI.config.onConfigChanged');
    }
  });
});
