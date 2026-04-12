import { describe, it, expect } from 'vitest';

/**
 * SubWindowApp 路由解析与页面映射测试
 * parseHash 和 renderSecondaryMenuPage 的等价纯逻辑测试
 */

// ========= 等价实现：parseHash =========

interface SubWindowRoute {
  type: 'tag-search' | 'artist' | 'character' | 'secondary-menu' | 'unknown';
  params: URLSearchParams;
}

function parseHash(hash: string): SubWindowRoute {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const [type, queryStr] = cleaned.split('?');
  const params = new URLSearchParams(queryStr || '');

  if (['tag-search', 'artist', 'character', 'secondary-menu'].includes(type)) {
    return { type: type as SubWindowRoute['type'], params };
  }
  return { type: 'unknown', params };
}

// ========= 等价实现：二级菜单标题映射 =========

const SECONDARY_MENU_TITLES: Record<string, Record<string, string>> = {
  gallery: {
    recent: '最近',
    all: '全部',
    galleries: '图集',
    'invalid-images': '无效图片',
    settings: '设置',
  },
  booru: {
    posts: '帖子',
    popular: '热门',
    pools: '图集',
    forums: '论坛',
    'user-profile': '用户',
    favorites: '收藏',
    'server-favorites': '服务端喜欢',
    'tag-management': '标签管理',
    download: '下载',
    'saved-searches': '保存的搜索',
    'booru-settings': '站点配置',
    settings: '设置',
  },
  google: {
    gdrive: 'Google Drive',
    gphotos: 'Google Photos',
    gemini: 'Gemini',
  },
};

// ========= 等价实现：页面路由有效性检查 =========

/** 返回 section+key 组合是否能被路由到有效页面 */
function isValidSecondaryRoute(section: string, key: string): boolean {
  // Gallery 区域
  if (section === 'gallery') {
    return ['recent', 'all', 'galleries', 'invalid-images', 'settings'].includes(key);
  }
  // Booru 区域
  if (section === 'booru') {
    return ['posts', 'popular', 'pools', 'forums', 'user-profile', 'favorites',
      'server-favorites', 'tag-management', 'download', 'saved-searches',
      'booru-settings', 'settings'].includes(key);
  }
  // Google 区域
  if (section === 'google') {
    return ['gdrive', 'gphotos', 'gemini'].includes(key);
  }
  return false;
}

// ========= 测试 =========

describe('SubWindowApp - parseHash 路由解析', () => {
  it('应解析 tag-search 路由', () => {
    const route = parseHash('#tag-search?tag=blue_eyes&siteId=1');
    expect(route.type).toBe('tag-search');
    expect(route.params.get('tag')).toBe('blue_eyes');
    expect(route.params.get('siteId')).toBe('1');
  });

  it('应解析 artist 路由', () => {
    const route = parseHash('#artist?name=pixiv_user&siteId=2');
    expect(route.type).toBe('artist');
    expect(route.params.get('name')).toBe('pixiv_user');
  });

  it('应解析 character 路由', () => {
    const route = parseHash('#character?name=hatsune_miku&siteId=1');
    expect(route.type).toBe('character');
    expect(route.params.get('name')).toBe('hatsune_miku');
  });

  it('应解析 secondary-menu 路由（完整参数）', () => {
    const route = parseHash('#secondary-menu?section=booru&key=tag-management&tab=blacklist');
    expect(route.type).toBe('secondary-menu');
    expect(route.params.get('section')).toBe('booru');
    expect(route.params.get('key')).toBe('tag-management');
    expect(route.params.get('tab')).toBe('blacklist');
  });

  it('应解析 secondary-menu 路由（无 tab）', () => {
    const route = parseHash('#secondary-menu?section=gallery&key=galleries');
    expect(route.type).toBe('secondary-menu');
    expect(route.params.get('section')).toBe('gallery');
    expect(route.params.get('key')).toBe('galleries');
    expect(route.params.get('tab')).toBeNull();
  });

  it('应解析 secondary-menu 路由（缺少 section 和 key 时返回空字符串）', () => {
    const route = parseHash('#secondary-menu');
    expect(route.type).toBe('secondary-menu');
    expect(route.params.get('section')).toBeNull();
    expect(route.params.get('key')).toBeNull();
  });

  it('无 # 前缀时仍能解析', () => {
    const route = parseHash('tag-search?tag=solo');
    expect(route.type).toBe('tag-search');
    expect(route.params.get('tag')).toBe('solo');
  });

  it('未知路由类型返回 unknown', () => {
    const route = parseHash('#some-unknown-type?foo=bar');
    expect(route.type).toBe('unknown');
  });

  it('空字符串返回 unknown', () => {
    const route = parseHash('');
    expect(route.type).toBe('unknown');
  });

  it('只有 # 时返回 unknown', () => {
    const route = parseHash('#');
    expect(route.type).toBe('unknown');
  });

  it('无 query 参数时 params 为空', () => {
    const route = parseHash('#tag-search');
    expect(route.type).toBe('tag-search');
    expect([...route.params.entries()]).toHaveLength(0);
  });
});

describe('SubWindowApp - 二级菜单标题映射', () => {
  it('booru section 所有合并后的 key 都有标题', () => {
    expect(SECONDARY_MENU_TITLES['booru']['tag-management']).toBe('标签管理');
    expect(SECONDARY_MENU_TITLES['booru']['download']).toBe('下载');
  });

  it('gallery section 所有 key 都有标题', () => {
    const galleryKeys = ['recent', 'all', 'galleries', 'invalid-images', 'settings'];
    for (const key of galleryKeys) {
      expect(SECONDARY_MENU_TITLES['gallery'][key]).toBeTruthy();
    }
  });

  it('google section 所有 key 都有标题', () => {
    const googleKeys = ['gdrive', 'gphotos', 'gemini'];
    for (const key of googleKeys) {
      expect(SECONDARY_MENU_TITLES['google'][key]).toBeTruthy();
    }
  });

  it('不存在的 section 返回 undefined', () => {
    expect(SECONDARY_MENU_TITLES['invalid']).toBeUndefined();
  });
});

describe('SubWindowApp - 页面路由有效性', () => {
  it('gallery 区域所有有效 key 都能匹配', () => {
    expect(isValidSecondaryRoute('gallery', 'recent')).toBe(true);
    expect(isValidSecondaryRoute('gallery', 'all')).toBe(true);
    expect(isValidSecondaryRoute('gallery', 'galleries')).toBe(true);
    expect(isValidSecondaryRoute('gallery', 'invalid-images')).toBe(true);
    expect(isValidSecondaryRoute('gallery', 'settings')).toBe(true);
  });

  it('booru 区域合并后的 key 有效', () => {
    expect(isValidSecondaryRoute('booru', 'tag-management')).toBe(true);
    expect(isValidSecondaryRoute('booru', 'download')).toBe(true);
  });

  it('booru 区域旧 key 不再有效', () => {
    expect(isValidSecondaryRoute('booru', 'favorite-tags')).toBe(false);
    expect(isValidSecondaryRoute('booru', 'blacklisted-tags')).toBe(false);
    expect(isValidSecondaryRoute('booru', 'downloads')).toBe(false);
    expect(isValidSecondaryRoute('booru', 'bulk-download')).toBe(false);
  });

  it('google 区域所有有效 key', () => {
    expect(isValidSecondaryRoute('google', 'gdrive')).toBe(true);
    expect(isValidSecondaryRoute('google', 'gphotos')).toBe(true);
    expect(isValidSecondaryRoute('google', 'gemini')).toBe(true);
  });

  it('无效 section 返回 false', () => {
    expect(isValidSecondaryRoute('invalid', 'posts')).toBe(false);
  });

  it('有效 section 但无效 key 返回 false', () => {
    expect(isValidSecondaryRoute('booru', 'nonexistent')).toBe(false);
  });
});
