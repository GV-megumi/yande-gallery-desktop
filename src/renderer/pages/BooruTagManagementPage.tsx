/**
 * Booru 标签管理页面 — 合并"收藏标签"和"黑名单"为页内子导航
 * 使用 Ant Design Segmented 组件切换内部 tab
 */

import React, { useState, Suspense } from 'react';
import { Segmented } from 'antd';
import { spacing, colors } from '../styles/tokens';

const FavoriteTagsPage = React.lazy(() =>
  import('./FavoriteTagsPage').then(m => ({ default: m.FavoriteTagsPage }))
);
const BlacklistedTagsPage = React.lazy(() =>
  import('./BlacklistedTagsPage').then(m => ({ default: m.BlacklistedTagsPage }))
);

type TabKey = 'favorite' | 'blacklist';

interface BooruTagManagementPageProps {
  /** 标签点击回调（透传给 FavoriteTagsPage） */
  onTagClick?: (tag: string, siteId?: number | null) => void;
  /** 初始激活的 tab，默认 'favorite' */
  defaultTab?: TabKey;
}

export const BooruTagManagementPage: React.FC<BooruTagManagementPageProps> = ({
  onTagClick,
  defaultTab = 'favorite',
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  const suspenseFallback = (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh' }}>
      <div style={{ color: colors.textTertiary }}>加载中...</div>
    </div>
  );

  return (
    <div>
      {/* tab 切换栏 */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: spacing.lg }}>
        <Segmented
          value={activeTab}
          onChange={(value) => setActiveTab(value as TabKey)}
          options={[
            { label: '喜欢', value: 'favorite' },
            { label: '黑名单', value: 'blacklist' },
          ]}
        />
      </div>

      {/* tab 内容 — 保持两个页面都挂载以维持各自状态，非活跃的用 display:none 隐藏 */}
      <div style={activeTab !== 'favorite' ? { display: 'none' } : undefined}>
        <Suspense fallback={suspenseFallback}>
          <FavoriteTagsPage onTagClick={onTagClick} />
        </Suspense>
      </div>
      <div style={activeTab !== 'blacklist' ? { display: 'none' } : undefined}>
        <Suspense fallback={suspenseFallback}>
          <BlacklistedTagsPage />
        </Suspense>
      </div>
    </div>
  );
};

export default BooruTagManagementPage;
