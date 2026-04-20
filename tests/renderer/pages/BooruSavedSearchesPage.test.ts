import { describe, it, expect } from 'vitest';

/**
 * BooruSavedSearchesPage UI 纯逻辑测试
 *
 * 从 BooruSavedSearchesPage.tsx 中提取纯函数逻辑进行测试，
 * 不涉及 React 渲染、DOM 操作或 Electron API。
 */

// ========= 等价实现：站点名称获取 =========

/**
 * 根据 siteId 获取站点名称
 * 对应 BooruSavedSearchesPage 中的 getSiteName 方法
 */
function getSiteName(
  sites: Array<{ id: number; name: string }>,
  siteId: number | null
): string {
  if (!siteId) return '全部站点';
  return sites.find(s => s.id === siteId)?.name || '未知站点';
}

// ========= 等价实现：表单验证逻辑 =========

/**
 * 验证保存搜索的表单
 * 对应 handleSave 中的验证逻辑
 * @returns 错误提示信息，null 表示验证通过
 */
function validateSavedSearchForm(name: string, query: string): string | null {
  if (!name.trim()) return '请输入名称';
  if (!query.trim()) return '请输入搜索词';
  return null;
}

// ========= 等价实现：编辑模式判断 =========

interface SavedSearch {
  id: number;
  siteId: number | null;
  name: string;
  query: string;
  createdAt: string;
}

/**
 * 判断当前是编辑模式还是新建模式
 * 对应 editingSearch 是否为 null 的判断
 */
function isEditMode(editingSearch: SavedSearch | null): boolean {
  return editingSearch !== null;
}

/**
 * 获取弹窗标题
 * 对应 Modal 的 title 属性
 */
function getModalTitle(editingSearch: SavedSearch | null): string {
  return editingSearch ? '编辑搜索' : '新建搜索';
}

/**
 * 获取确认按钮文字
 * 对应 Modal 的 okText 属性
 */
function getModalOkText(editingSearch: SavedSearch | null): string {
  return editingSearch ? '保存' : '创建';
}

/**
 * 判断是否显示站点选择器
 * 新建和编辑模式都应显示站点选择器，保证站点一致性可见且可编辑
 */
function shouldShowSiteSelector(_editingSearch: SavedSearch | null): boolean {
  return true;
}

// ========= 等价实现：新建弹窗初始化 =========

/**
 * 初始化新建搜索的表单数据
 * 对应 handleAdd 方法
 */
function initAddForm(currentSelectedSiteId: number | null): {
  editingSearch: null;
  formName: string;
  formQuery: string;
  formSiteId: number | null;
} {
  return {
    editingSearch: null,
    formName: '',
    formQuery: '',
    formSiteId: currentSelectedSiteId,
  };
}

/**
 * 初始化编辑搜索的表单数据
 * 对应 handleEdit 方法
 */
function initEditForm(search: SavedSearch): {
  editingSearch: SavedSearch;
  formName: string;
  formQuery: string;
  formSiteId: number | null;
} {
  return {
    editingSearch: search,
    formName: search.name,
    formQuery: search.query,
    formSiteId: search.siteId,
  };
}

// ========= 测试 =========

describe('BooruSavedSearchesPage - getSiteName', () => {
  const mockSites = [
    { id: 1, name: 'Yande.re' },
    { id: 2, name: 'Konachan' },
    { id: 3, name: 'Danbooru' },
  ];

  it('siteId 为 null 时应返回"全部站点"', () => {
    expect(getSiteName(mockSites, null)).toBe('全部站点');
  });

  it('siteId 为 0 时应返回"全部站点"（0 是 falsy）', () => {
    // 注意：源码中使用 !siteId 判断，0 被视为 falsy
    expect(getSiteName(mockSites, 0)).toBe('全部站点');
  });

  it('siteId 匹配已有站点时应返回站点名称', () => {
    expect(getSiteName(mockSites, 1)).toBe('Yande.re');
    expect(getSiteName(mockSites, 2)).toBe('Konachan');
    expect(getSiteName(mockSites, 3)).toBe('Danbooru');
  });

  it('siteId 不匹配任何站点时应返回"未知站点"', () => {
    expect(getSiteName(mockSites, 999)).toBe('未知站点');
  });

  it('站点列表为空时有效 siteId 应返回"未知站点"', () => {
    expect(getSiteName([], 1)).toBe('未知站点');
  });

  it('站点列表为空时 siteId 为 null 应返回"全部站点"', () => {
    expect(getSiteName([], null)).toBe('全部站点');
  });
});

describe('BooruSavedSearchesPage - validateSavedSearchForm', () => {
  it('名称和查询词都有效时应返回 null（验证通过）', () => {
    expect(validateSavedSearchForm('蓝色系', 'blue_eyes')).toBeNull();
  });

  it('名称为空时应返回"请输入名称"', () => {
    expect(validateSavedSearchForm('', 'blue_eyes')).toBe('请输入名称');
  });

  it('名称只有空格时应返回"请输入名称"', () => {
    expect(validateSavedSearchForm('  ', 'blue_eyes')).toBe('请输入名称');
  });

  it('名称只有 tab 时应返回"请输入名称"', () => {
    expect(validateSavedSearchForm('\t', 'blue_eyes')).toBe('请输入名称');
  });

  it('查询词为空时应返回"请输入搜索词"', () => {
    expect(validateSavedSearchForm('搜索名称', '')).toBe('请输入搜索词');
  });

  it('查询词只有空格时应返回"请输入搜索词"', () => {
    expect(validateSavedSearchForm('搜索名称', '   ')).toBe('请输入搜索词');
  });

  it('两者都为空时应优先返回名称的错误', () => {
    expect(validateSavedSearchForm('', '')).toBe('请输入名称');
  });

  it('含空格但有内容的名称应验证通过', () => {
    expect(validateSavedSearchForm(' 蓝色系 ', 'blue_eyes')).toBeNull();
  });

  it('含空格但有内容的查询词应验证通过', () => {
    expect(validateSavedSearchForm('搜索', ' blue_eyes ')).toBeNull();
  });

  it('支持标签+meta-tag 组合的查询词', () => {
    expect(validateSavedSearchForm('高分蓝眼', 'blue_eyes rating:s score:>50')).toBeNull();
  });

  it('支持只包含 meta-tag 的查询词', () => {
    expect(validateSavedSearchForm('评分筛选', 'rating:s')).toBeNull();
  });

  it('支持包含特殊字符的查询词', () => {
    expect(validateSavedSearchForm('特殊搜索', 'score:>100 order:id_desc')).toBeNull();
  });
});

describe('BooruSavedSearchesPage - 编辑模式 vs 新建模式', () => {
  const mockSearch: SavedSearch = {
    id: 42,
    siteId: 1,
    name: '蓝色系搜索',
    query: 'blue_eyes long_hair',
    createdAt: '2024-03-15T10:00:00.000Z',
  };

  describe('isEditMode', () => {
    it('editingSearch 为 null 时应为新建模式', () => {
      expect(isEditMode(null)).toBe(false);
    });

    it('editingSearch 有值时应为编辑模式', () => {
      expect(isEditMode(mockSearch)).toBe(true);
    });
  });

  describe('getModalTitle', () => {
    it('新建模式应显示"新建搜索"', () => {
      expect(getModalTitle(null)).toBe('新建搜索');
    });

    it('编辑模式应显示"编辑搜索"', () => {
      expect(getModalTitle(mockSearch)).toBe('编辑搜索');
    });
  });

  describe('getModalOkText', () => {
    it('新建模式应显示"创建"', () => {
      expect(getModalOkText(null)).toBe('创建');
    });

    it('编辑模式应显示"保存"', () => {
      expect(getModalOkText(mockSearch)).toBe('保存');
    });
  });

  describe('shouldShowSiteSelector', () => {
    it('新建模式应显示站点选择器', () => {
      expect(shouldShowSiteSelector(null)).toBe(true);
    });

    it('编辑模式也应显示站点选择器以保持站点一致性', () => {
      expect(shouldShowSiteSelector(mockSearch)).toBe(true);
    });
  });
});

describe('BooruSavedSearchesPage - 表单初始化', () => {
  describe('initAddForm（新建搜索）', () => {
    it('editingSearch 应为 null', () => {
      const form = initAddForm(null);
      expect(form.editingSearch).toBeNull();
    });

    it('formName 和 formQuery 应为空字符串', () => {
      const form = initAddForm(null);
      expect(form.formName).toBe('');
      expect(form.formQuery).toBe('');
    });

    it('formSiteId 应继承当前选中的站点 ID', () => {
      const form = initAddForm(2);
      expect(form.formSiteId).toBe(2);
    });

    it('当前未选中站点时 formSiteId 应为 null', () => {
      const form = initAddForm(null);
      expect(form.formSiteId).toBeNull();
    });
  });

  describe('initEditForm（编辑搜索）', () => {
    const mockSearch: SavedSearch = {
      id: 10,
      siteId: 3,
      name: '红发角色',
      query: 'red_hair rating:s',
      createdAt: '2024-06-01T08:00:00.000Z',
    };

    it('editingSearch 应为传入的搜索对象', () => {
      const form = initEditForm(mockSearch);
      expect(form.editingSearch).toBe(mockSearch);
    });

    it('formName 应为搜索的名称', () => {
      const form = initEditForm(mockSearch);
      expect(form.formName).toBe('红发角色');
    });

    it('formQuery 应为搜索的查询词', () => {
      const form = initEditForm(mockSearch);
      expect(form.formQuery).toBe('red_hair rating:s');
    });

    it('formSiteId 应为搜索的站点 ID', () => {
      const form = initEditForm(mockSearch);
      expect(form.formSiteId).toBe(3);
    });

    it('siteId 为 null 的全局搜索也应正确初始化', () => {
      const globalSearch: SavedSearch = {
        id: 20,
        siteId: null,
        name: '全局搜索',
        query: 'solo',
        createdAt: '2024-06-01T08:00:00.000Z',
      };
      const form = initEditForm(globalSearch);
      expect(form.formSiteId).toBeNull();
      expect(form.formName).toBe('全局搜索');
    });
  });
});

describe('BooruSavedSearchesPage - 搜索词格式验证', () => {
  /**
   * 检测查询词是否包含 meta-tag（如 rating:s, score:>50）
   */
  function hasMetaTags(query: string): boolean {
    return query.trim().split(/\s+/).some(part => part.includes(':'));
  }

  /**
   * 提取查询词中的所有标签（不含 meta-tag）
   */
  function extractPlainTags(query: string): string[] {
    return query.trim().split(/\s+/).filter(part => part && !part.includes(':'));
  }

  describe('hasMetaTags', () => {
    it('包含 rating meta-tag 时应返回 true', () => {
      expect(hasMetaTags('blue_eyes rating:s')).toBe(true);
    });

    it('包含 score meta-tag 时应返回 true', () => {
      expect(hasMetaTags('score:>50')).toBe(true);
    });

    it('包含 order meta-tag 时应返回 true', () => {
      expect(hasMetaTags('girl order:score')).toBe(true);
    });

    it('不包含 meta-tag 时应返回 false', () => {
      expect(hasMetaTags('blue_eyes long_hair')).toBe(false);
    });

    it('空查询词应返回 false', () => {
      expect(hasMetaTags('')).toBe(false);
    });
  });

  describe('extractPlainTags', () => {
    it('应提取纯标签，排除 meta-tag', () => {
      expect(extractPlainTags('blue_eyes rating:s long_hair score:>50')).toEqual([
        'blue_eyes',
        'long_hair',
      ]);
    });

    it('全部是 meta-tag 时应返回空数组', () => {
      expect(extractPlainTags('rating:s order:score')).toEqual([]);
    });

    it('全部是普通标签时应全部返回', () => {
      expect(extractPlainTags('girl solo blue_eyes')).toEqual(['girl', 'solo', 'blue_eyes']);
    });

    it('空查询词应返回空数组', () => {
      expect(extractPlainTags('')).toEqual([]);
    });

    it('多余空格应被正确处理', () => {
      expect(extractPlainTags('  girl   rating:s  ')).toEqual(['girl']);
    });
  });
});
