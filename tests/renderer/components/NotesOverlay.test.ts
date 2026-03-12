import { describe, it, expect } from 'vitest';

/**
 * NotesOverlay 组件纯逻辑测试
 *
 * 提取 NotesOverlay.tsx 中的两个核心纯函数进行单元测试：
 * 1. noteToPercent — 将注释框的绝对像素坐标转换为百分比定位
 * 2. parseNoteBody — 将包含 HTML 标签的注释内容解析为纯文本
 * 3. 注释可见性控制逻辑
 */

// ========= 等价实现：noteToPercent =========
// 对应 NotesOverlay.tsx 第 98-101 行的坐标转换逻辑

/**
 * 将注释框的绝对像素坐标转换为相对于图片尺寸的百分比字符串
 * @param note 注释框坐标（绝对像素值）
 * @param imgWidth 原图宽度（像素）
 * @param imgHeight 原图高度（像素）
 * @returns 百分比定位对象（left, top, width, height）
 */
function noteToPercent(
  note: { x: number; y: number; width: number; height: number },
  imgWidth: number,
  imgHeight: number
) {
  // 安全处理：避免除零错误
  const safeWidth = imgWidth || 1;
  const safeHeight = imgHeight || 1;
  return {
    left: `${(note.x / safeWidth) * 100}%`,
    top: `${(note.y / safeHeight) * 100}%`,
    width: `${(note.width / safeWidth) * 100}%`,
    height: `${(note.height / safeHeight) * 100}%`,
  };
}

// ========= 等价实现：parseNoteBody =========
// 对应 NotesOverlay.tsx 第 104-107 行的 HTML 解析逻辑

/**
 * 将注释内容中的 HTML 标签解析为纯文本
 * - <br> / <br /> 转换为换行符
 * - 其他 HTML 标签被移除
 * - 首尾空白被裁剪
 * @param body 注释 HTML 内容
 * @returns 纯文本内容
 */
function parseNoteBody(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// ========= 等价实现：shouldRenderNotes =========
// 对应 NotesOverlay.tsx 第 58 行的可见性判断

interface NoteData {
  id: number;
  post_id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  body: string;
  creator: string;
  is_active?: boolean;
}

/**
 * 判断注释层是否应该渲染
 * @param showNotes 用户是否开启注释显示
 * @param notes 注释列表
 * @returns 是否渲染
 */
function shouldRenderNotes(showNotes: boolean, notes: NoteData[]): boolean {
  if (!showNotes || notes.length === 0) return false;
  return true;
}

// ========= 测试：坐标转换 =========

describe('noteToPercent — 坐标转换', () => {
  it('正常坐标应正确转换为百分比（1920x1080 图片）', () => {
    const result = noteToPercent(
      { x: 192, y: 108, width: 384, height: 216 },
      1920,
      1080
    );
    expect(result.left).toBe('10%');
    expect(result.top).toBe('10%');
    expect(result.width).toBe('20%');
    expect(result.height).toBe('20%');
  });

  it('左上角原点坐标应转换为 0%', () => {
    const result = noteToPercent(
      { x: 0, y: 0, width: 100, height: 100 },
      1000,
      1000
    );
    expect(result.left).toBe('0%');
    expect(result.top).toBe('0%');
    expect(result.width).toBe('10%');
    expect(result.height).toBe('10%');
  });

  it('注释框位于图片右下角（x + width = imgWidth）', () => {
    const result = noteToPercent(
      { x: 800, y: 600, width: 200, height: 200 },
      1000,
      800
    );
    // x=800 / 1000 = 80%, width=200 / 1000 = 20%  => 80% + 20% = 100%
    expect(result.left).toBe('80%');
    expect(result.top).toBe('75%');
    expect(result.width).toBe('20%');
    expect(result.height).toBe('25%');
  });

  it('覆盖整张图片的注释框应产生 0%, 0%, 100%, 100%', () => {
    const result = noteToPercent(
      { x: 0, y: 0, width: 1920, height: 1080 },
      1920,
      1080
    );
    expect(result.left).toBe('0%');
    expect(result.top).toBe('0%');
    expect(result.width).toBe('100%');
    expect(result.height).toBe('100%');
  });

  it('小尺寸图片（100x100）应正确转换', () => {
    const result = noteToPercent(
      { x: 25, y: 50, width: 10, height: 20 },
      100,
      100
    );
    expect(result.left).toBe('25%');
    expect(result.top).toBe('50%');
    expect(result.width).toBe('10%');
    expect(result.height).toBe('20%');
  });

  it('非整除坐标应产生小数百分比', () => {
    const result = noteToPercent(
      { x: 100, y: 100, width: 100, height: 100 },
      300,
      300
    );
    // 100/300 = 33.333...
    expect(result.left).toMatch(/^33\.333/);
    expect(result.left).toContain('%');
  });

  it('零尺寸图片宽度应安全处理（不除零）', () => {
    // 组件中使用 post.width || 1 防止除零
    const result = noteToPercent(
      { x: 50, y: 50, width: 100, height: 100 },
      0,
      1080
    );
    // imgWidth=0 => safeWidth=1, x=50/1*100 = 5000%
    expect(result.left).toBe('5000%');
    expect(result.width).toBe('10000%');
  });

  it('零尺寸图片高度应安全处理（不除零）', () => {
    const result = noteToPercent(
      { x: 50, y: 50, width: 100, height: 100 },
      1920,
      0
    );
    // imgHeight=0 => safeHeight=1, y=50/1*100 = 5000%
    expect(result.top).toBe('5000%');
    expect(result.height).toBe('10000%');
  });

  it('宽高都为零时应安全处理', () => {
    // 不应抛出异常
    expect(() =>
      noteToPercent({ x: 10, y: 20, width: 30, height: 40 }, 0, 0)
    ).not.toThrow();
  });

  it('坐标为零、尺寸为零的注释框应返回全 0%', () => {
    const result = noteToPercent(
      { x: 0, y: 0, width: 0, height: 0 },
      1920,
      1080
    );
    expect(result.left).toBe('0%');
    expect(result.top).toBe('0%');
    expect(result.width).toBe('0%');
    expect(result.height).toBe('0%');
  });
});

// ========= 测试：HTML 内容解析 =========

describe('parseNoteBody — HTML 注释内容解析', () => {
  it('纯文本内容应保持不变', () => {
    expect(parseNoteBody('这是一段注释')).toBe('这是一段注释');
  });

  it('<br> 标签应转换为换行符', () => {
    expect(parseNoteBody('第一行<br>第二行')).toBe('第一行\n第二行');
  });

  it('<br /> 自闭合标签应转换为换行符', () => {
    expect(parseNoteBody('第一行<br />第二行')).toBe('第一行\n第二行');
  });

  it('<br/> 无空格自闭合标签应转换为换行符', () => {
    expect(parseNoteBody('第一行<br/>第二行')).toBe('第一行\n第二行');
  });

  it('<BR> 大写标签应不区分大小写处理', () => {
    expect(parseNoteBody('行1<BR>行2<Br>行3')).toBe('行1\n行2\n行3');
  });

  it('应移除 <b> 粗体标签，保留内容', () => {
    expect(parseNoteBody('<b>粗体文字</b>')).toBe('粗体文字');
  });

  it('应移除 <i> 斜体标签，保留内容', () => {
    expect(parseNoteBody('<i>斜体文字</i>')).toBe('斜体文字');
  });

  it('应移除 <a> 链接标签，保留内容', () => {
    expect(parseNoteBody('<a href="https://example.com">链接文字</a>')).toBe('链接文字');
  });

  it('应移除 <span> 标签及属性，保留内容', () => {
    expect(parseNoteBody('<span style="color:red">彩色文字</span>')).toBe('彩色文字');
  });

  it('混合 HTML 应正确解析', () => {
    const input = 'text<br>more <b>bold</b> text';
    expect(parseNoteBody(input)).toBe('text\nmore bold text');
  });

  it('多层嵌套标签应全部移除', () => {
    expect(parseNoteBody('<div><p><b>嵌套内容</b></p></div>')).toBe('嵌套内容');
  });

  it('空字符串应返回空字符串', () => {
    expect(parseNoteBody('')).toBe('');
  });

  it('仅包含 HTML 标签的内容应返回空', () => {
    expect(parseNoteBody('<br><br>')).toBe('');
  });

  it('首尾空格应被 trim 移除', () => {
    expect(parseNoteBody('  text with spaces  ')).toBe('text with spaces');
  });

  it('标签前后有空格应保留中间空格', () => {
    expect(parseNoteBody(' <b>hello</b> <i>world</i> ')).toBe('hello world');
  });

  it('连续多个 <br> 应产生多个换行符', () => {
    expect(parseNoteBody('a<br><br><br>b')).toBe('a\n\n\nb');
  });

  it('日文注释内容应正确保留', () => {
    expect(parseNoteBody('「こんにちは」<br>世界')).toBe('「こんにちは」\n世界');
  });
});

// ========= 测试：注释可见性控制 =========

describe('shouldRenderNotes — 注释可见性控制', () => {
  const sampleNote: NoteData = {
    id: 1,
    post_id: 100,
    x: 10,
    y: 20,
    width: 50,
    height: 30,
    body: '测试注释',
    creator: 'user1',
    is_active: true,
  };

  it('showNotes=true 且有注释时应渲染', () => {
    expect(shouldRenderNotes(true, [sampleNote])).toBe(true);
  });

  it('showNotes=false 时不应渲染（即使有注释）', () => {
    expect(shouldRenderNotes(false, [sampleNote])).toBe(false);
  });

  it('没有注释时不应渲染（即使 showNotes=true）', () => {
    expect(shouldRenderNotes(true, [])).toBe(false);
  });

  it('showNotes=false 且无注释时不应渲染', () => {
    expect(shouldRenderNotes(false, [])).toBe(false);
  });

  it('有多个注释时应渲染', () => {
    const notes = [
      sampleNote,
      { ...sampleNote, id: 2, body: '第二条注释' },
      { ...sampleNote, id: 3, body: '第三条注释' },
    ];
    expect(shouldRenderNotes(true, notes)).toBe(true);
  });

  it('is_active=false 的注释仍在数组中时应渲染（过滤在客户端层完成）', () => {
    // 组件层面只检查数组是否为空，不检查 is_active
    // is_active 的过滤在 MoebooruClient/DanbooruClient 的 getNotes 方法中完成
    const inactiveNote: NoteData = { ...sampleNote, is_active: false };
    expect(shouldRenderNotes(true, [inactiveNote])).toBe(true);
  });
});
