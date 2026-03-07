import React, { useState } from 'react';
import { Space, Button, App, Tooltip } from 'antd';
import {
  BookOutlined,
  BookFilled,
  DownloadOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  LikeOutlined,
  LikeFilled,
  DislikeOutlined,
  DislikeFilled,
  HeartOutlined,
  HeartFilled
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
 * 显示：收藏、投票、服务端收藏、下载、分享等操作按钮
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  post,
  site,
  onToggleFavorite,
  onDownload
}) => {
  const { message } = App.useApp();
  const [voteState, setVoteState] = useState<1 | 0 | -1>(0);
  const [serverFavorited, setServerFavorited] = useState(false);
  const [votingLoading, setVotingLoading] = useState(false);
  const [serverFavLoading, setServerFavLoading] = useState(false);

  // 是否已登录
  const isLoggedIn = !!(site?.username && site?.passwordHash);

  const handleToggleFavorite = () => {
    console.log('[Toolbar] 切换本地收藏状态:', post.id, '当前:', post.isFavorited);
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

  // 投票
  const handleVote = async (score: 1 | 0 | -1) => {
    if (!isLoggedIn || !site) {
      message.warning('需要登录才能投票，请在站点配置中登录');
      return;
    }

    setVotingLoading(true);
    try {
      // 如果再次点击同一投票，取消投票
      const newScore = voteState === score ? 0 : score;
      const result = await window.electronAPI.booru.votePost(site.id, post.postId, newScore);
      if (result.success) {
        setVoteState(newScore);
        const labels = { 1: '点赞', 0: '取消投票', '-1': '踩' };
        message.success(labels[newScore] + '成功');
      } else {
        message.error('投票失败: ' + result.error);
      }
    } catch (error) {
      console.error('[Toolbar] 投票失败:', error);
      message.error('投票失败');
    } finally {
      setVotingLoading(false);
    }
  };

  // 服务端收藏/取消收藏
  const handleServerFavorite = async () => {
    if (!isLoggedIn || !site) {
      message.warning('需要登录才能服务端收藏，请在站点配置中登录');
      return;
    }

    setServerFavLoading(true);
    try {
      if (serverFavorited) {
        const result = await window.electronAPI.booru.serverUnfavorite(site.id, post.postId);
        if (result.success) {
          setServerFavorited(false);
          message.success('已取消服务端收藏');
        } else {
          message.error('取消服务端收藏失败: ' + result.error);
        }
      } else {
        const result = await window.electronAPI.booru.serverFavorite(site.id, post.postId);
        if (result.success) {
          setServerFavorited(true);
          message.success('已添加服务端收藏');
        } else {
          message.error('服务端收藏失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[Toolbar] 服务端收藏失败:', error);
      message.error('操作失败');
    } finally {
      setServerFavLoading(false);
    }
  };

  const handleSlideshow = () => {
    console.log('[Toolbar] 开始幻灯片播放');
    message.info('幻灯片功能开发中...');
  };

  const handleShare = () => {
    console.log('[Toolbar] 分享图片');
    // 复制链接到剪贴板
    const url = site ? `${site.url}/post/show/${post.postId}` : (post.fileUrl || post.sampleUrl || '');
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        message.success('链接已复制到剪贴板');
      }).catch(err => {
        console.error('[Toolbar] 复制失败:', err);
        message.error('复制失败');
      });
    }
  };

  // 检查站点是否支持收藏
  const supportsFavorite = site?.favoriteSupport ?? false;

  return (
    <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #f0f0f0' }}>
      <Space wrap>
        {/* 本地收藏按钮 */}
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

        {/* 服务端收藏按钮 */}
        {isLoggedIn && (
          <Tooltip title="同步收藏到服务端">
            <Button
              type={serverFavorited ? 'primary' : 'default'}
              icon={serverFavorited ? <HeartFilled /> : <HeartOutlined />}
              onClick={handleServerFavorite}
              loading={serverFavLoading}
              style={serverFavorited ? { background: '#ff4d4f', borderColor: '#ff4d4f' } : undefined}
            >
              {serverFavorited ? '已喜欢' : '喜欢'}
            </Button>
          </Tooltip>
        )}

        {/* 投票按钮 */}
        {isLoggedIn && (
          <>
            <Tooltip title="点赞">
              <Button
                type={voteState === 1 ? 'primary' : 'default'}
                icon={voteState === 1 ? <LikeFilled /> : <LikeOutlined />}
                onClick={() => handleVote(1)}
                loading={votingLoading}
              />
            </Tooltip>
            <Tooltip title="踩">
              <Button
                type={voteState === -1 ? 'primary' : 'default'}
                danger={voteState === -1}
                icon={voteState === -1 ? <DislikeFilled /> : <DislikeOutlined />}
                onClick={() => handleVote(-1)}
                loading={votingLoading}
              />
            </Tooltip>
          </>
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
