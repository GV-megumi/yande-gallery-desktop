/**
 * Booru 下载中心页面 — 合并"下载管理"和"批量下载"为页内子导航
 * 使用 Ant Design Segmented 组件切换内部 tab
 */

import React, { useState, Suspense } from 'react';
import { Segmented } from 'antd';
import { spacing, colors } from '../styles/tokens';
import { useLocale } from '../locales';

const BooruDownloadPage = React.lazy(() => import('./BooruDownloadPage'));
const BooruBulkDownloadPage = React.lazy(() =>
  import('./BooruBulkDownloadPage').then(m => ({ default: m.BooruBulkDownloadPage }))
);

type TabKey = 'downloads' | 'bulk';

interface BooruDownloadHubPageProps {
  /** 初始激活的 tab，默认 'downloads' */
  defaultTab?: TabKey;
}

export const BooruDownloadHubPage: React.FC<BooruDownloadHubPageProps> = ({
  defaultTab = 'downloads',
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const { t } = useLocale();

  const suspenseFallback = (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh' }}>
      <div style={{ color: colors.textTertiary }}>{t('common.loading')}</div>
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
            { label: t('menu.download'), value: 'downloads' },
            { label: t('menu.bulkDownload'), value: 'bulk' },
          ]}
        />
      </div>

      {/* tab 内容 — 保持两个页面都挂载以维持各自状态，非活跃的用 display:none 隐藏 */}
      <div style={activeTab !== 'downloads' ? { display: 'none' } : undefined}>
        <Suspense fallback={suspenseFallback}>
          <BooruDownloadPage />
        </Suspense>
      </div>
      <div style={activeTab !== 'bulk' ? { display: 'none' } : undefined}>
        <Suspense fallback={suspenseFallback}>
          <BooruBulkDownloadPage />
        </Suspense>
      </div>
    </div>
  );
};

export default BooruDownloadHubPage;
