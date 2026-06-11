import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Space, Button, App, Tooltip, Tag, Typography, Dropdown, Input } from 'antd';
import {
  BookOutlined,
  BookFilled,
  DownloadOutlined,
  ShareAltOutlined,
  LikeOutlined,
  LikeFilled,
  DislikeOutlined,
  DislikeFilled,
  HeartOutlined,
  HeartFilled,
  UserOutlined,
  LockOutlined,
  LinkOutlined,
  FileImageOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';
import { useLocale } from '../../locales';
import { useBooruDomainEvents } from '../../hooks/useBooruDomainEvents';
import { colors } from '../../styles/tokens';

/**
 * 举报原因输入框（受控小组件）
 * modal.confirm 的 content 不会随外部 state 重渲染，
 * 因此由该组件持有自身受控 state，并通过 onChange 将最新值上报给调用方
 */
const ReportReasonInput: React.FC<{ onChange: (value: string) => void }> = ({ onChange }) => {
  const [value, setValue] = useState('');
  return (
    <Input.TextArea
      rows={3}
      placeholder="请输入举报原因"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      style={{ marginTop: 8 }}
    />
  );
};

interface ToolbarProps {
  post: BooruPost;
  site: BooruSite | null;
  onToggleFavorite?: (post: BooruPost) => void;
  onDownload?: (post: BooruPost) => void;
  /** 外部传入的服务端喜欢状态 */
  isServerFavorited?: boolean;
  /** 服务端喜欢切换回调（由父组件管理状态） */
  onToggleServerFavorite?: (post: BooruPost) => void;
}

/**
 * 工具栏组件
 * 显示：收藏、投票、服务端收藏、下载、分享等操作按钮
 */
export const Toolbar: React.FC<ToolbarProps> = React.memo(({
  post,
  site,
  onToggleFavorite,
  onDownload,
  isServerFavorited: externalServerFavorited,
  onToggleServerFavorite
}) => {
  const { message, modal } = App.useApp();
  const { t } = useLocale();
  const [voteState, setVoteState] = useState<1 | 0 | -1>(0);
  // 如果外部传入了 isServerFavorited，使用外部状态；否则用内部状态
  const [internalServerFavorited, setInternalServerFavorited] = useState(false);
  const serverFavorited = externalServerFavorited ?? internalServerFavorited;
  const setServerFavorited = setInternalServerFavorited;
  const [votingLoading, setVotingLoading] = useState(false);
  const [serverFavLoading, setServerFavLoading] = useState(false);

  // 收藏用户列表
  const [favoriteUsers, setFavoriteUsers] = useState<string[]>([]);
  const [favoriteUsersExpanded, setFavoriteUsersExpanded] = useState(false);

  // 举报原因（由弹窗内受控输入框上报最新值）
  const reportReasonRef = useRef('');

  // 是否已登录
  const isLoggedIn = !!site?.authenticated;

  useBooruDomainEvents({
    siteId: site?.id ?? null,
    active: Boolean(site && post.postId),
    onPostVoteChanged: (payload) => {
      if (payload.postId === post.postId) {
        setVoteState(payload.vote);
      }
    },
  });

  // 加载收藏用户列表
  useEffect(() => {
    if (!site || !post.postId) return;
    const loadFavoriteUsers = async () => {
      try {
        const result = await window.electronAPI.booru.getFavoriteUsers(site.id, post.postId);
        if (result.success && result.data) {
          setFavoriteUsers(result.data);
          console.log('[Toolbar] 收藏用户:', result.data.length, '人');
        }
      } catch (error) {
        console.error('[Toolbar] 加载收藏用户失败:', error);
      }
    };
    loadFavoriteUsers();
  }, [site, post.postId]);

  const handleToggleFavorite = useCallback(() => {
    console.log('[Toolbar] 切换本地收藏状态:', post.id, '当前:', post.isFavorited);
    if (onToggleFavorite) {
      onToggleFavorite(post);
    }
  }, [onToggleFavorite, post]);

  const handleDownload = useCallback(() => {
    console.log('[Toolbar] 下载图片:', post.postId);
    if (onDownload) {
      onDownload(post);
    }
  }, [onDownload, post]);

  // 投票
  const handleVote = useCallback(async (score: 1 | 0 | -1) => {
    if (!isLoggedIn || !site) {
      message.warning(t('details.loginRequiredVote'));
      return;
    }

    setVotingLoading(true);
    try {
      // 如果再次点击同一投票，取消投票
      const newScore = voteState === score ? 0 : score;
      const result = await window.electronAPI.booru.votePost(site.id, post.postId, newScore);
      if (result.success) {
        setVoteState(newScore);
        const labels: Record<number, string> = { 1: t('details.upvote'), 0: t('details.cancelVote'), [-1]: t('details.downvote') };
        message.success(labels[newScore] + ' ' + t('details.voteSuccess'));
      } else {
        message.error(t('details.voteFailed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('[Toolbar] 投票失败:', error);
      message.error(t('details.voteFailed'));
    } finally {
      setVotingLoading(false);
    }
  }, [isLoggedIn, site, voteState, post.postId, message, t]);

  // 服务端收藏/取消收藏
  const handleServerFavorite = useCallback(async () => {
    // 如果有外部回调，优先使用（由父组件统一管理状态）
    if (onToggleServerFavorite) {
      onToggleServerFavorite(post);
      return;
    }

    if (!isLoggedIn || !site) {
      message.warning(t('details.loginRequiredFav'));
      return;
    }

    setServerFavLoading(true);
    try {
      if (serverFavorited) {
        const result = await window.electronAPI.booru.serverUnfavorite(site.id, post.postId);
        if (result.success) {
          setServerFavorited(false);
          message.success(t('details.serverFavRemoved'));
        } else {
          message.error(t('details.serverFavFailed') + ': ' + result.error);
        }
      } else {
        const result = await window.electronAPI.booru.serverFavorite(site.id, post.postId);
        if (result.success) {
          setServerFavorited(true);
          message.success(t('details.serverFavAdded'));
        } else {
          message.error(t('details.serverFavFailed') + ': ' + result.error);
        }
      }
    } catch (error) {
      console.error('[Toolbar] 服务端收藏失败:', error);
      message.error(t('details.serverFavFailed'));
    } finally {
      setServerFavLoading(false);
    }
  }, [onToggleServerFavorite, isLoggedIn, site, serverFavorited, post, message, t]);

  const handleReportPost = useCallback(() => {
    if (!site || site.type !== 'danbooru') {
      message.warning('当前站点暂不支持举报');
      return;
    }
    if (!isLoggedIn) {
      message.warning('需要登录后才能举报');
      return;
    }

    // Electron 渲染进程不支持 window.prompt，改用确认弹窗内嵌受控输入框收集举报原因
    reportReasonRef.current = '';
    modal.confirm({
      title: '举报帖子',
      icon: <WarningOutlined />,
      content: <ReportReasonInput onChange={(value) => { reportReasonRef.current = value; }} />,
      okText: '提交',
      cancelText: '取消',
      // onOk 返回 Promise，确认按钮自动进入 loading；reject 时弹窗保持打开
      onOk: async () => {
        const reason = reportReasonRef.current.trim();
        if (!reason) {
          message.warning('请输入举报原因');
          return Promise.reject(new Error('举报原因不能为空'));
        }
        try {
          const result = await window.electronAPI.booru.reportPost(site.id, post.postId, reason);
          if (result.success) {
            message.success('举报已提交');
          } else {
            message.error('举报失败: ' + result.error);
            return Promise.reject(new Error(result.error || '举报失败'));
          }
        } catch (error) {
          console.error('[Toolbar] 举报帖子失败:', error);
          message.error('举报失败');
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
  }, [site, isLoggedIn, post.postId, message, modal]);

  const copyToClipboard = useCallback((text: string, successMsg: string) => {
    if (!text) { message.warning('链接不可用'); return; }
    navigator.clipboard.writeText(text).then(() => {
      message.success(successMsg);
    }).catch(err => {
      console.error('[Toolbar] 复制失败:', err);
      message.error(t('common.copyFailed'));
    });
  }, [message, t]);

  const shareMenuItems = useMemo(() => [
    {
      key: 'copy-post-url',
      icon: <LinkOutlined />,
      label: '复制帖子链接',
      onClick: () => {
        const url = site ? `${site.url}/post/show/${post.postId}` : '';
        console.log('[Toolbar] 复制帖子链接:', url);
        copyToClipboard(url, t('details.linkCopied'));
      }
    },
    {
      key: 'copy-image-url',
      icon: <FileImageOutlined />,
      label: '复制图片链接',
      onClick: () => {
        const url = post.fileUrl || post.sampleUrl || '';
        console.log('[Toolbar] 复制图片链接:', url);
        copyToClipboard(url, '图片链接已复制');
      }
    },
  ], [site, post.postId, post.fileUrl, post.sampleUrl, copyToClipboard, t]);

  // 检查站点是否支持收藏
  const supportsFavorite = site?.favoriteSupport ?? false;

  return (
    <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: `1px solid ${colors.separator}` }}>
      {/* 主操作行：收藏、喜欢、投票 */}
      <Space wrap style={{ marginBottom: 8 }}>
        {supportsFavorite && (
          <Button
            type={post.isFavorited ? 'primary' : 'default'}
            danger={post.isFavorited}
            icon={post.isFavorited ? <BookFilled /> : <BookOutlined />}
            onClick={handleToggleFavorite}
          >
            {post.isFavorited ? t('details.favorited') : t('details.favorite')}
          </Button>
        )}

        {isLoggedIn ? (
          <Tooltip title={t('details.syncToServer')}>
            <Button
              type={serverFavorited ? 'primary' : 'default'}
              icon={serverFavorited ? <HeartFilled /> : <HeartOutlined />}
              onClick={handleServerFavorite}
              loading={serverFavLoading}
              style={serverFavorited ? { background: colors.accent, borderColor: colors.accent } : undefined}
            >
              {serverFavorited ? t('details.liked') : t('details.like')}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title={t('details.loginHint')}>
            <Button icon={<LockOutlined />} disabled>
              {t('details.like')}
            </Button>
          </Tooltip>
        )}

        {isLoggedIn ? (
          <>
            <Tooltip title={t('details.upvote')}>
              <Button
                type={voteState === 1 ? 'primary' : 'default'}
                icon={voteState === 1 ? <LikeFilled /> : <LikeOutlined />}
                onClick={() => handleVote(1)}
                loading={votingLoading}
              />
            </Tooltip>
            <Tooltip title={t('details.downvote')}>
              <Button
                type={voteState === -1 ? 'primary' : 'default'}
                danger={voteState === -1}
                icon={voteState === -1 ? <DislikeFilled /> : <DislikeOutlined />}
                onClick={() => handleVote(-1)}
                loading={votingLoading}
              />
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title={t('details.loginRequired')}>
              <Button icon={<LikeOutlined />} disabled />
            </Tooltip>
            <Tooltip title={t('details.loginRequired')}>
              <Button icon={<DislikeOutlined />} disabled />
            </Tooltip>
          </>
        )}
      </Space>

      {/* 次操作行：下载、分享（幻灯片入口已移除，统一使用查看区底部的幻灯片控制条） */}
      <Space wrap>
        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownload}
        >
          {t('details.download')}
        </Button>
        <Dropdown menu={{ items: shareMenuItems }} trigger={['click']}>
          <Button icon={<ShareAltOutlined />}>
            {t('details.share')}
          </Button>
        </Dropdown>
        {site?.type === 'danbooru' && (
          <Button icon={<WarningOutlined />} danger onClick={handleReportPost}>
            举报
          </Button>
        )}
      </Space>

      {/* 收藏用户列表 */}
      {favoriteUsers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <UserOutlined style={{ marginRight: 4 }} />
            {t('details.favoritedBy', { count: favoriteUsers.length })}
            {favoriteUsers.length > 5 && (
              <a
                onClick={() => setFavoriteUsersExpanded(!favoriteUsersExpanded)}
                style={{ marginLeft: 8, fontSize: 12 }}
              >
                {favoriteUsersExpanded ? t('details.collapse') : t('details.expand')}
              </a>
            )}
          </Typography.Text>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(favoriteUsersExpanded ? favoriteUsers : favoriteUsers.slice(0, 5)).map(user => (
              <Tag key={user} style={{ fontSize: 11 }}>{user}</Tag>
            ))}
            {!favoriteUsersExpanded && favoriteUsers.length > 5 && (
              <Tag style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => setFavoriteUsersExpanded(true)}>
                +{favoriteUsers.length - 5}
              </Tag>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

Toolbar.displayName = 'Toolbar';
