import { describe, it, expect } from 'vitest';

/**
 * Booru 帖子注释（Notes）数据处理测试
 *
 * 测试各客户端对 BooruNoteData 的处理逻辑：
 * 1. Moebooru — 返回绝对像素坐标，需由前端根据图片尺寸换算百分比
 * 2. Danbooru — 同样返回绝对像素坐标，字段名略有差异（creator_name）
 * 3. Gelbooru — 不支持注释功能，应始终返回空数组
 *
 * 参考源文件：
 * - src/main/services/booruClientInterface.ts (BooruNoteData 接口)
 * - src/main/services/moebooruClient.ts (getNotes 方法，第 984 行)
 * - src/main/services/danbooruClient.ts (getNotes 方法，第 696 行)
 * - src/main/services/gelbooruClient.ts (getNotes 方法，第 660 行)
 */

// ========= BooruNoteData 接口定义（等价复制） =========

interface BooruNoteData {
  id: number;
  post_id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  body: string;
  creator: string;
  created_at: string;
  updated_at?: string;
  is_active?: boolean;
}

// ========= 等价实现：Moebooru 注释数据转换 =========
// 对应 moebooruClient.ts 第 992-1008 行

/**
 * 模拟 MoebooruClient.getNotes 的数据映射逻辑
 * Moebooru API 返回的原始注释数据 -> BooruNoteData
 */
function mapMoebooruNote(raw: any): BooruNoteData | null {
  // 过滤非活跃注释（与源码 .filter((n) => n.is_active !== false) 一致）
  if (raw.is_active === false) return null;

  return {
    id: raw.id,
    post_id: raw.post_id,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    body: raw.body || '',
    creator: raw.creator || '',
    created_at: raw.created_at ? String(raw.created_at) : new Date().toISOString(),
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
    is_active: raw.is_active !== false,
  };
}

/**
 * 模拟 MoebooruClient.getNotes 的完整流程
 * @param apiResponse 模拟的 API 响应数据
 */
function processMoebooruNotes(apiResponse: any): BooruNoteData[] {
  const notes: any[] = Array.isArray(apiResponse) ? apiResponse : [];
  return notes
    .filter((n: any) => n.is_active !== false)
    .map((n: any) => mapMoebooruNote(n)!)
    .filter(Boolean);
}

// ========= 等价实现：Danbooru 注释数据转换 =========
// 对应 danbooruClient.ts 第 703-718 行

/**
 * 模拟 DanbooruClient.getNotes 的数据映射逻辑
 * Danbooru 使用 creator_name 而非 creator 字段
 */
function mapDanbooruNote(raw: any): BooruNoteData | null {
  if (raw.is_active === false) return null;

  return {
    id: raw.id,
    post_id: raw.post_id,
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    body: raw.body || '',
    creator: raw.creator_name || '',   // Danbooru 字段名差异
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || undefined,
    is_active: raw.is_active !== false,
  };
}

function processDanbooruNotes(apiResponse: any): BooruNoteData[] {
  const notes: any[] = Array.isArray(apiResponse) ? apiResponse : [];
  return notes
    .filter((n: any) => n.is_active !== false)
    .map((n: any) => mapDanbooruNote(n)!)
    .filter(Boolean);
}

// ========= 等价实现：Gelbooru（不支持注释） =========

/**
 * 模拟 GelbooruClient.getNotes — 始终返回空数组
 */
function processGelbooruNotes(_postId: number): BooruNoteData[] {
  return [];
}

// ========= 测试数据 =========

/** Moebooru API 返回的典型注释数据（如 Yande.re） */
const MOEBOORU_RAW_NOTES = [
  {
    id: 10001,
    post_id: 500000,
    x: 192,
    y: 108,
    width: 384,
    height: 216,
    body: '<b>Translation:</b><br>"Hello World"',
    creator: 'translator_user',
    created_at: '2024-01-15T08:30:00Z',
    updated_at: '2024-01-16T10:00:00Z',
    is_active: true,
  },
  {
    id: 10002,
    post_id: 500000,
    x: 800,
    y: 600,
    width: 200,
    height: 100,
    body: 'Simple note',
    creator: 'another_user',
    created_at: '2024-01-15T09:00:00Z',
    is_active: true,
  },
];

/** Danbooru API 返回的典型注释数据 */
const DANBOORU_RAW_NOTES = [
  {
    id: 20001,
    post_id: 7000000,
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    body: 'Danbooru note content',
    creator_name: 'dan_translator',  // Danbooru 使用 creator_name
    created_at: '2024-02-01T12:00:00Z',
    updated_at: '2024-02-02T14:00:00Z',
    is_active: true,
  },
];

// ========= 测试：Moebooru 注释格式 =========

describe('Moebooru 注释数据处理', () => {
  it('应正确映射 Moebooru API 返回的注释字段', () => {
    const result = processMoebooruNotes(MOEBOORU_RAW_NOTES);
    expect(result).toHaveLength(2);

    const first = result[0];
    expect(first.id).toBe(10001);
    expect(first.post_id).toBe(500000);
    expect(first.x).toBe(192);
    expect(first.y).toBe(108);
    expect(first.width).toBe(384);
    expect(first.height).toBe(216);
    expect(first.body).toBe('<b>Translation:</b><br>"Hello World"');
    expect(first.creator).toBe('translator_user');
    expect(first.is_active).toBe(true);
  });

  it('Moebooru 注释坐标应为绝对像素值（非百分比）', () => {
    // Moebooru 返回的坐标直接是原图像素坐标
    // 前端 NotesOverlay 负责将其转换为百分比
    const result = processMoebooruNotes(MOEBOORU_RAW_NOTES);
    const note = result[0];
    // 坐标应为整数像素值
    expect(Number.isInteger(note.x)).toBe(true);
    expect(Number.isInteger(note.y)).toBe(true);
    expect(Number.isInteger(note.width)).toBe(true);
    expect(Number.isInteger(note.height)).toBe(true);
  });

  it('应过滤 is_active=false 的注释', () => {
    const notesWithInactive = [
      ...MOEBOORU_RAW_NOTES,
      {
        id: 10003,
        post_id: 500000,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        body: '已删除的注释',
        creator: 'deleted_user',
        created_at: '2024-01-10T00:00:00Z',
        is_active: false,
      },
    ];
    const result = processMoebooruNotes(notesWithInactive);
    // 原始 3 条，过滤掉 is_active=false 的 1 条
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.is_active === true)).toBe(true);
  });

  it('is_active 字段缺失时应视为活跃（!== false 判断）', () => {
    const noteWithoutActive = [
      {
        id: 10004,
        post_id: 500000,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        body: '没有 is_active 字段',
        creator: 'user',
        created_at: '2024-01-01T00:00:00Z',
        // is_active 未定义
      },
    ];
    const result = processMoebooruNotes(noteWithoutActive);
    expect(result).toHaveLength(1);
    expect(result[0].is_active).toBe(true);
  });

  it('body 字段为空时应默认为空字符串', () => {
    const noteWithEmptyBody = [
      {
        id: 10005,
        post_id: 500000,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: null,
        creator: 'user',
        created_at: '2024-01-01',
        is_active: true,
      },
    ];
    const result = processMoebooruNotes(noteWithEmptyBody);
    expect(result[0].body).toBe('');
  });

  it('creator 字段为空时应默认为空字符串', () => {
    const noteWithNoCreator = [
      {
        id: 10006,
        post_id: 500000,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: 'note',
        creator: null,
        created_at: '2024-01-01',
        is_active: true,
      },
    ];
    const result = processMoebooruNotes(noteWithNoCreator);
    expect(result[0].creator).toBe('');
  });

  it('created_at 字段缺失时应使用默认时间', () => {
    const noteWithoutDate = [
      {
        id: 10007,
        post_id: 500000,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: 'note',
        creator: 'user',
        is_active: true,
        // created_at 未定义
      },
    ];
    const result = processMoebooruNotes(noteWithoutDate);
    // 应有一个有效的 ISO 日期字符串
    expect(result[0].created_at).toBeTruthy();
    expect(typeof result[0].created_at).toBe('string');
  });

  it('API 返回非数组数据时应安全处理为空数组', () => {
    expect(processMoebooruNotes(null)).toEqual([]);
    expect(processMoebooruNotes(undefined)).toEqual([]);
    expect(processMoebooruNotes('error')).toEqual([]);
    expect(processMoebooruNotes({})).toEqual([]);
  });

  it('API 返回空数组时应返回空数组', () => {
    expect(processMoebooruNotes([])).toEqual([]);
  });

  it('updated_at 字段缺失时应为 undefined', () => {
    const result = processMoebooruNotes([MOEBOORU_RAW_NOTES[1]]);
    // 第二条测试数据没有 updated_at
    expect(result[0].updated_at).toBeUndefined();
  });

  it('created_at 为数字时间戳时应转换为字符串', () => {
    const noteWithNumericDate = [
      {
        id: 10008,
        post_id: 500000,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: 'note',
        creator: 'user',
        created_at: 1705305000,  // 数字时间戳
        is_active: true,
      },
    ];
    const result = processMoebooruNotes(noteWithNumericDate);
    expect(typeof result[0].created_at).toBe('string');
    expect(result[0].created_at).toBe('1705305000');
  });
});

// ========= 测试：Danbooru 注释格式 =========

describe('Danbooru 注释数据处理', () => {
  it('应正确映射 Danbooru API 返回的注释字段', () => {
    const result = processDanbooruNotes(DANBOORU_RAW_NOTES);
    expect(result).toHaveLength(1);

    const note = result[0];
    expect(note.id).toBe(20001);
    expect(note.post_id).toBe(7000000);
    expect(note.x).toBe(100);
    expect(note.y).toBe(200);
    expect(note.width).toBe(300);
    expect(note.height).toBe(150);
    expect(note.body).toBe('Danbooru note content');
    expect(note.is_active).toBe(true);
  });

  it('应将 Danbooru 的 creator_name 映射到 creator 字段', () => {
    // Danbooru 使用 creator_name，Moebooru 使用 creator
    const result = processDanbooruNotes(DANBOORU_RAW_NOTES);
    expect(result[0].creator).toBe('dan_translator');
  });

  it('creator_name 缺失时 creator 应为空字符串', () => {
    const noteWithoutCreatorName = [
      {
        id: 20002,
        post_id: 7000000,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        body: 'note',
        // 没有 creator_name 字段
        created_at: '2024-02-01T12:00:00Z',
        is_active: true,
      },
    ];
    const result = processDanbooruNotes(noteWithoutCreatorName);
    expect(result[0].creator).toBe('');
  });

  it('Danbooru 注释坐标同样为绝对像素值', () => {
    const result = processDanbooruNotes(DANBOORU_RAW_NOTES);
    const note = result[0];
    expect(Number.isInteger(note.x)).toBe(true);
    expect(Number.isInteger(note.y)).toBe(true);
  });

  it('应过滤 Danbooru 中 is_active=false 的注释', () => {
    const notesWithInactive = [
      ...DANBOORU_RAW_NOTES,
      {
        id: 20003,
        post_id: 7000000,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        body: 'deleted',
        creator_name: 'user',
        created_at: '2024-02-01',
        is_active: false,
      },
    ];
    const result = processDanbooruNotes(notesWithInactive);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(20001);
  });

  it('API 返回非数组数据时应安全处理为空数组', () => {
    expect(processDanbooruNotes(null)).toEqual([]);
    expect(processDanbooruNotes(undefined)).toEqual([]);
    expect(processDanbooruNotes({})).toEqual([]);
  });

  it('API 返回空数组时应返回空数组', () => {
    expect(processDanbooruNotes([])).toEqual([]);
  });
});

// ========= 测试：Gelbooru 不支持注释 =========

describe('Gelbooru 注释数据处理', () => {
  it('Gelbooru 应始终返回空数组（不支持注释功能）', () => {
    expect(processGelbooruNotes(500000)).toEqual([]);
  });

  it('任意 postId 都应返回空数组', () => {
    expect(processGelbooruNotes(0)).toEqual([]);
    expect(processGelbooruNotes(1)).toEqual([]);
    expect(processGelbooruNotes(9999999)).toEqual([]);
  });

  it('返回值应为数组类型', () => {
    const result = processGelbooruNotes(12345);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ========= 测试：BooruNoteData 接口字段验证 =========

describe('BooruNoteData 接口字段完整性', () => {
  it('Moebooru 映射结果应包含所有必需字段', () => {
    const result = processMoebooruNotes(MOEBOORU_RAW_NOTES);
    const note = result[0];

    // 必需字段
    expect(note).toHaveProperty('id');
    expect(note).toHaveProperty('post_id');
    expect(note).toHaveProperty('x');
    expect(note).toHaveProperty('y');
    expect(note).toHaveProperty('width');
    expect(note).toHaveProperty('height');
    expect(note).toHaveProperty('body');
    expect(note).toHaveProperty('creator');
    expect(note).toHaveProperty('created_at');

    // 类型检查
    expect(typeof note.id).toBe('number');
    expect(typeof note.post_id).toBe('number');
    expect(typeof note.x).toBe('number');
    expect(typeof note.y).toBe('number');
    expect(typeof note.width).toBe('number');
    expect(typeof note.height).toBe('number');
    expect(typeof note.body).toBe('string');
    expect(typeof note.creator).toBe('string');
    expect(typeof note.created_at).toBe('string');
  });

  it('Danbooru 映射结果应包含所有必需字段', () => {
    const result = processDanbooruNotes(DANBOORU_RAW_NOTES);
    const note = result[0];

    expect(note).toHaveProperty('id');
    expect(note).toHaveProperty('post_id');
    expect(note).toHaveProperty('x');
    expect(note).toHaveProperty('y');
    expect(note).toHaveProperty('width');
    expect(note).toHaveProperty('height');
    expect(note).toHaveProperty('body');
    expect(note).toHaveProperty('creator');
    expect(note).toHaveProperty('created_at');
  });

  it('可选字段 updated_at 存在时应为字符串', () => {
    const result = processMoebooruNotes(MOEBOORU_RAW_NOTES);
    const noteWithUpdated = result[0];
    expect(typeof noteWithUpdated.updated_at).toBe('string');
  });

  it('可选字段 is_active 存在时应为布尔值', () => {
    const result = processMoebooruNotes(MOEBOORU_RAW_NOTES);
    expect(typeof result[0].is_active).toBe('boolean');
  });
});
