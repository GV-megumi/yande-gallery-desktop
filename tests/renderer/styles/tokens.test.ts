import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDarkMode,
  isDarkMode,
  colors,
  shadows,
  spacing,
  radius,
  transitions,
  layout,
  fontSize,
  zIndex,
  iconColors,
} from '../../../src/renderer/styles/tokens';

describe('主题切换 (setDarkMode / isDarkMode)', () => {
  beforeEach(() => {
    // 每次测试前重置为亮色模式
    setDarkMode(false);
  });

  it('默认应为亮色模式', () => {
    expect(isDarkMode()).toBe(false);
  });

  it('setDarkMode(true) 应切换到暗色模式', () => {
    setDarkMode(true);
    expect(isDarkMode()).toBe(true);
  });

  it('setDarkMode(false) 应切换回亮色模式', () => {
    setDarkMode(true);
    setDarkMode(false);
    expect(isDarkMode()).toBe(false);
  });

  it('多次设置相同值不应有副作用', () => {
    setDarkMode(true);
    setDarkMode(true);
    expect(isDarkMode()).toBe(true);
    setDarkMode(false);
    setDarkMode(false);
    expect(isDarkMode()).toBe(false);
  });
});

describe('colors Proxy 动态切换', () => {
  it('亮色模式下 primary 应为品牌蓝紫', () => {
    setDarkMode(false);
    expect(colors.primary).toBe('#4F46E5');
  });

  it('暗色模式下 primary 应为亮蓝紫', () => {
    setDarkMode(true);
    expect(colors.primary).toBe('#818CF8');
  });

  it('切换模式后 textPrimary 应立即变化', () => {
    setDarkMode(false);
    expect(colors.textPrimary).toBe('#111827');

    setDarkMode(true);
    expect(colors.textPrimary).toBe('#F9FAFB');
  });

  it('切换模式后 bgBase 应立即变化', () => {
    setDarkMode(false);
    expect(colors.bgBase).toBe('#FFFFFF');

    setDarkMode(true);
    expect(colors.bgBase).toBe('#0F1117');
  });

  it('亮色和暗色的 ratingSafe 应不同', () => {
    setDarkMode(false);
    const lightSafe = colors.ratingSafe;
    setDarkMode(true);
    const darkSafe = colors.ratingSafe;
    expect(lightSafe).not.toBe(darkSafe);
  });

  it('所有颜色 key 都应有值', () => {
    setDarkMode(false);
    const keys: (keyof typeof colors)[] = [
      'primary', 'primaryHover', 'primaryActive', 'primaryBg',
      'success', 'warning', 'danger', 'info',
      'textPrimary', 'textSecondary', 'textTertiary',
      'bgBase', 'bgLight', 'bgGray',
      'border', 'borderLight',
      'ratingSafe', 'ratingQuestionable', 'ratingExplicit',
    ];
    for (const key of keys) {
      expect(colors[key]).toBeTruthy();
    }
  });
});

describe('shadows Proxy 动态切换', () => {
  it('亮色模式下 card 阴影应存在', () => {
    setDarkMode(false);
    expect(shadows.card).toBeTruthy();
    expect(shadows.card).toContain('rgba');
  });

  it('暗色模式下 card 阴影应更深', () => {
    setDarkMode(false);
    const lightCard = shadows.card;
    setDarkMode(true);
    const darkCard = shadows.card;
    // 暗色阴影应不同于亮色
    expect(lightCard).not.toBe(darkCard);
  });

  it('none 在两种模式下都应为 none', () => {
    setDarkMode(false);
    expect(shadows.none).toBe('none');
    setDarkMode(true);
    expect(shadows.none).toBe('none');
  });
});

describe('静态 Token 常量', () => {
  describe('spacing', () => {
    it('应基于 4px 栅格', () => {
      expect(spacing.xs).toBe(4);
      expect(spacing.sm).toBe(8);
      expect(spacing.md).toBe(12);
      expect(spacing.lg).toBe(16);
    });

    it('所有值应为正数', () => {
      for (const value of Object.values(spacing)) {
        expect(value).toBeGreaterThan(0);
      }
    });

    it('应递增排列', () => {
      expect(spacing.xs).toBeLessThan(spacing.sm);
      expect(spacing.sm).toBeLessThan(spacing.md);
      expect(spacing.md).toBeLessThan(spacing.lg);
      expect(spacing.lg).toBeLessThan(spacing.xl);
    });
  });

  describe('radius', () => {
    it('pill 应为极大值', () => {
      expect(radius.pill).toBe(9999);
    });

    it('round 应为 50%', () => {
      expect(radius.round).toBe('50%');
    });

    it('数值应递增', () => {
      expect(radius.xs).toBeLessThan(radius.sm);
      expect(radius.sm).toBeLessThan(radius.md);
      expect(radius.md).toBeLessThan(radius.lg);
    });
  });

  describe('fontSize', () => {
    it('应包含从 xs 到 largeTitle 的完整层级', () => {
      expect(fontSize.xs).toBeDefined();
      expect(fontSize.sm).toBeDefined();
      expect(fontSize.base).toBeDefined();
      expect(fontSize.heading).toBeDefined();
      expect(fontSize.largeTitle).toBeDefined();
    });

    it('应递增排列', () => {
      expect(fontSize.xs).toBeLessThan(fontSize.sm);
      expect(fontSize.sm).toBeLessThan(fontSize.base);
      expect(fontSize.base).toBeLessThan(fontSize.lg);
      expect(fontSize.heading).toBeLessThan(fontSize.largeTitle);
    });
  });

  describe('layout', () => {
    it('sidebarWidth 应大于 sidebarCollapsedWidth', () => {
      expect(layout.sidebarWidth).toBeGreaterThan(layout.sidebarCollapsedWidth);
    });

    it('应有合理的默认值', () => {
      expect(layout.headerHeight).toBeGreaterThan(0);
      expect(layout.toolbarHeight).toBeGreaterThan(0);
      expect(layout.contentPadding).toBeGreaterThan(0);
    });
  });

  describe('zIndex', () => {
    it('层级应递增', () => {
      expect(zIndex.base).toBeLessThan(zIndex.sticky);
      expect(zIndex.sticky).toBeLessThan(zIndex.toolbar);
      expect(zIndex.toolbar).toBeLessThan(zIndex.overlay);
      expect(zIndex.overlay).toBeLessThan(zIndex.modal);
      expect(zIndex.modal).toBeLessThan(zIndex.top);
    });
  });

  describe('transitions', () => {
    it('所有过渡值应包含 cubic-bezier 或 ease', () => {
      for (const [key, value] of Object.entries(transitions)) {
        expect(value).toMatch(/cubic-bezier|ease/);
      }
    });
  });

  describe('iconColors', () => {
    it('所有图标颜色应以 # 开头', () => {
      for (const [key, value] of Object.entries(iconColors)) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it('应包含核心菜单项颜色', () => {
      expect(iconColors.gallery).toBeDefined();
      expect(iconColors.booru).toBeDefined();
      expect(iconColors.settings).toBeDefined();
      expect(iconColors.favorites).toBeDefined();
      expect(iconColors.downloads).toBeDefined();
    });
  });
});
