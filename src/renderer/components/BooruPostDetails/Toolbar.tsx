import React from 'react';
import { Space, Button, message } from 'antd';
import {
  BookOutlined,
  BookFilled,
  DownloadOutlined,
  PlayCircleOutlined,
  ShareAltOutlined
} from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';

interface ToolbarProps {
  post: BooruPost;
  site: BooruSite | null;
  onToggleFavorite?: (post: BooruPost) => void;
  onDownload?: (post: BooruPost) => void;
}

/**
 * 工具栏组件
 * 显示：收藏、下载、幻灯片、分享等操作按钮
 * 参考 Boorusama 的 MoebooruPostDetailsActionToolbar
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  post,
  site,
  onToggleFavorite,
  onDownload
}) => {
  const handleToggleFavorite = () => {
    console.log('[Toolbar] 切换收藏状态:', post.id, '当前:', post.isFavorited);
    if (onToggleFavorite) {
      onToggleFavorite(post);
    } else {
      message.info('收藏功能需要传入 onToggleFavorite 回调');
    }
  };

  const handleDownload = () => {
    console.log('[Toolbar] 下载图片:', post.postId);
    if (onDownload) {
      onDownload(post);
    } else {
      message.info('下载功能需要传入 onDownload 回调');
    }
  };

  const handleSlideshow = () => {
    console.log('[Toolbar] 开始幻灯片播放');
    message.info('幻灯片功能开发中...');
  };

  const handleShare = () => {
    console.log('[Toolbar] 分享图片');
    if (navigator.share) {
      navigator.share({
        title: `Post ${post.postId}`,
        text: `查看这张图片: ${post.postId}`,
        url: post.fileUrl || post.sampleUrl || ''
      }).catch(err => {
        console.error('[Toolbar] 分享失败:', err);
      });
    } else {
      // 复制链接到剪贴板
      const url = post.fileUrl || post.sampleUrl || '';
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          message.success('链接已复制到剪贴板');
        }).catch(err => {
          console.error('[Toolbar] 复制失败:', err);
          message.error('复制失败');
        });
      }
    }
  };

  // 检查站点是否支持收藏
  const supportsFavorite = site?.favoriteSupport ?? false;

  return (
    <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #f0f0f0' }}>
      <Space wrap>
        {/* 收藏按钮 */}
        {supportsFavorite && (
          <Button
            type={post.isFavorited ? 'primary' : 'default'}
            danger={post.isFavorited}
            icon={post.isFavorited ? <BookFilled /> : <BookOutlined />}
            onClick={handleToggleFavorite}
          >
            {post.isFavorited ? '已收藏' : '收藏'}
          </Button>
        )}

        {/* 下载按钮 */}
        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownload}
        >
          下载
        </Button>

        {/* 幻灯片按钮 */}
        <Button
          icon={<PlayCircleOutlined />}
          onClick={handleSlideshow}
        >
          幻灯片
        </Button>

        {/* 分享按钮 */}
        <Button
          icon={<ShareAltOutlined />}
          onClick={handleShare}
        >
          分享
        </Button>
      </Space>
    </div>
  );
};

