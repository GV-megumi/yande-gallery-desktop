/**
 * Google Photos 浏览/上传页面
 * 功能：浏览照片、查看相册、按日期筛选、上传本地照片、下载到本地
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, Spin, Empty, message, Tabs, Card,
  Image, Modal, Select, DatePicker, Tooltip, Tag
} from 'antd';
import {
  CameraOutlined, PictureOutlined, UploadOutlined,
  DownloadOutlined, ReloadOutlined, LoginOutlined,
  LogoutOutlined, CloudOutlined, FolderOpenOutlined,
  PlusOutlined
} from '@ant-design/icons';
import { colors, spacing, fontSize } from '../styles/tokens';

// ============= 类型定义 =============

interface PhotoItem {
  id: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  mediaMetadata: {
    creationTime: string;
    width: string;
    height: string;
  };
}

interface Album {
  id: string;
  title: string;
  productUrl: string;
  mediaItemsCount: number;
  coverPhotoBaseUrl: string;
}

// ============= 工具函数 =============

function getThumbnailUrl(baseUrl: string, size: number = 400): string {
  return `${baseUrl}=w${size}-h${size}`;
}

function getOriginalUrl(baseUrl: string): string {
  return `${baseUrl}=d`;
}

/**
 * 按月份分组照片
 */
function groupPhotosByMonth(photos: PhotoItem[]): Map<string, PhotoItem[]> {
  const groups = new Map<string, PhotoItem[]>();
  for (const photo of photos) {
    const date = new Date(photo.mediaMetadata.creationTime);
    const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(photo);
  }
  return groups;
}

// ============= 组件 =============

export const GooglePhotosPage: React.FC = () => {
  // 认证状态
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // Tab
  const [activeTab, setActiveTab] = useState('all');

  // 照片列表
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosNextToken, setPhotosNextToken] = useState<string | undefined>();

  // 相册列表
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsNextToken, setAlbumsNextToken] = useState<string | undefined>();

  // 相册内照片
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<PhotoItem[]>([]);
  const [albumPhotosLoading, setAlbumPhotosLoading] = useState(false);
  const [albumPhotosNextToken, setAlbumPhotosNextToken] = useState<string | undefined>();

  // 预览
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  // ============= 认证 =============

  const checkAuth = useCallback(async () => {
    try {
      const result = await window.electronAPI.google.getAuthStatus();
      if (result.success && result.data) {
        setIsLoggedIn(result.data.isLoggedIn);
        setEmail(result.data.email || '');
      }
    } catch (error) {
      console.error('[GooglePhotos] 检查认证状态失败:', error);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const result = await window.electronAPI.google.login();
      if (result.success) {
        setIsLoggedIn(true);
        setEmail(result.email || '');
        message.success('Google 登录成功');
      } else {
        message.error('登录失败: ' + (result.error || ''));
      }
    } catch (error) {
      message.error('登录失败: ' + String(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const result = await window.electronAPI.google.logout();
    if (result.success) {
      setIsLoggedIn(false);
      setEmail('');
      setPhotos([]);
      setAlbums([]);
      message.success('已退出 Google 账号');
    }
  };

  // ============= 照片加载 =============

  const loadPhotos = useCallback(async (pageToken?: string) => {
    setPhotosLoading(true);
    try {
      const result = await window.electronAPI.gphotos.listPhotos(50, pageToken);
      if (result.success && result.data) {
        if (pageToken) {
          setPhotos(prev => [...prev, ...result.data.items]);
        } else {
          setPhotos(result.data.items);
        }
        setPhotosNextToken(result.data.nextPageToken);
      } else {
        message.error('加载照片失败: ' + (result.error || ''));
      }
    } catch (error) {
      message.error('加载照片失败: ' + String(error));
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  const loadAlbums = useCallback(async (pageToken?: string) => {
    setAlbumsLoading(true);
    try {
      const result = await window.electronAPI.gphotos.listAlbums(50, pageToken);
      if (result.success && result.data) {
        if (pageToken) {
          setAlbums(prev => [...prev, ...result.data.albums]);
        } else {
          setAlbums(result.data.albums);
        }
        setAlbumsNextToken(result.data.nextPageToken);
      } else {
        message.error('加载相册失败: ' + (result.error || ''));
      }
    } catch (error) {
      message.error('加载相册失败: ' + String(error));
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  const loadAlbumPhotos = useCallback(async (albumId: string, pageToken?: string) => {
    setAlbumPhotosLoading(true);
    try {
      const result = await window.electronAPI.gphotos.getAlbumPhotos(albumId, 50, pageToken);
      if (result.success && result.data) {
        if (pageToken) {
          setAlbumPhotos(prev => [...prev, ...result.data.items]);
        } else {
          setAlbumPhotos(result.data.items);
        }
        setAlbumPhotosNextToken(result.data.nextPageToken);
      } else {
        message.error('加载相册照片失败: ' + (result.error || ''));
      }
    } catch (error) {
      message.error('加载相册照片失败: ' + String(error));
    } finally {
      setAlbumPhotosLoading(false);
    }
  }, []);

  // ============= 操作 =============

  const handleDownload = async (photo: PhotoItem) => {
    try {
      message.loading({ content: `正在下载 ${photo.filename}...`, key: 'download' });
      const result = await window.electronAPI.gphotos.download(photo.id);
      if (result.success) {
        message.success({ content: `下载完成: ${result.data}`, key: 'download' });
      } else {
        message.error({ content: '下载失败: ' + (result.error || ''), key: 'download' });
      }
    } catch (error) {
      message.error({ content: '下载失败: ' + String(error), key: 'download' });
    }
  };

  const handleCreateAlbum = () => {
    let albumTitle = '';
    Modal.confirm({
      title: '创建相册',
      content: (
        <input
          placeholder="相册名称"
          onChange={e => albumTitle = e.target.value}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            border: `1px solid ${colors.separator}`, fontSize: 14,
          }}
          autoFocus
        />
      ),
      onOk: async () => {
        if (!albumTitle.trim()) {
          message.warning('请输入相册名称');
          return;
        }
        try {
          const result = await window.electronAPI.gphotos.createAlbum(albumTitle);
          if (result.success) {
            message.success('相册创建成功');
            loadAlbums();
          } else {
            message.error('创建失败: ' + (result.error || ''));
          }
        } catch (error) {
          message.error('创建失败: ' + String(error));
        }
      },
    });
  };

  const handlePreview = (photo: PhotoItem) => {
    // 使用较大尺寸预览
    setPreviewUrl(`${photo.baseUrl}=w1600-h1200`);
    setPreviewVisible(true);
  };

  const openAlbum = (album: Album) => {
    setSelectedAlbum(album);
    setAlbumPhotos([]);
    loadAlbumPhotos(album.id);
  };

  const closeAlbum = () => {
    setSelectedAlbum(null);
    setAlbumPhotos([]);
    setAlbumPhotosNextToken(undefined);
  };

  // ============= 初始化 =============

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isLoggedIn) {
      loadPhotos();
      loadAlbums();
    }
  }, [isLoggedIn, loadPhotos, loadAlbums]);

  // ============= 渲染照片网格 =============

  const renderPhotoGrid = (photoList: PhotoItem[], loading: boolean, nextToken?: string, onLoadMore?: () => void) => {
    if (loading && photoList.length === 0) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Spin size="large" />
        </div>
      );
    }

    if (photoList.length === 0) {
      return <Empty description="没有照片" />;
    }

    // 按月分组
    const grouped = groupPhotosByMonth(photoList);

    return (
      <div>
        {Array.from(grouped.entries()).map(([month, monthPhotos]) => (
          <div key={month} style={{ marginBottom: spacing.xl }}>
            <div style={{
              fontSize: fontSize.lg,
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: spacing.sm,
              paddingBottom: spacing.xs,
              borderBottom: `1px solid ${colors.separator}`,
            }}>
              {month}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: spacing.sm,
            }}>
              {monthPhotos.map(photo => (
                <div
                  key={photo.id}
                  style={{
                    position: 'relative',
                    paddingBottom: '100%',
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: colors.bgElevated || '#f0f0f0',
                  }}
                  onClick={() => handlePreview(photo)}
                >
                  <img
                    src={getThumbnailUrl(photo.baseUrl, 400)}
                    alt={photo.filename}
                    loading="lazy"
                    style={{
                      position: 'absolute',
                      top: 0, left: 0, width: '100%', height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                  {/* 悬浮操作 */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0, left: 0, right: 0,
                      padding: '20px 8px 8px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                      display: 'flex',
                      justifyContent: 'flex-end',
                      opacity: 0,
                      transition: 'opacity 0.2s',
                    }}
                    className="photo-hover-overlay"
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                  >
                    <Tooltip title="下载">
                      <Button
                        size="small"
                        type="text"
                        icon={<DownloadOutlined style={{ color: '#fff' }} />}
                        onClick={e => { e.stopPropagation(); handleDownload(photo); }}
                      />
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 加载更多 */}
        {nextToken && onLoadMore && (
          <div style={{ textAlign: 'center', padding: spacing.lg }}>
            <Button onClick={onLoadMore} loading={loading}>加载更多</Button>
          </div>
        )}
      </div>
    );
  };

  // ============= 主渲染 =============

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" tip="检查登录状态..." />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 24 }}>
        <CameraOutlined style={{ fontSize: 64, color: '#FBBC04' }} />
        <div style={{ fontSize: fontSize.xl, fontWeight: 600, color: colors.textPrimary }}>
          连接 Google Photos
        </div>
        <div style={{ fontSize: fontSize.md, color: colors.textTertiary, textAlign: 'center' }}>
          登录 Google 账号以浏览您的照片和相册
        </div>
        <Button type="primary" size="large" icon={<LoginOutlined />} onClick={handleLogin}>
          登录 Google 账号
        </Button>
      </div>
    );
  }

  // 查看相册内容
  if (selectedAlbum) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button onClick={closeAlbum}>返回相册列表</Button>
            <span style={{ fontSize: fontSize.lg, fontWeight: 600, color: colors.textPrimary }}>
              {selectedAlbum.title}
            </span>
            <Tag color="blue">{selectedAlbum.mediaItemsCount} 张</Tag>
          </Space>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {renderPhotoGrid(
            albumPhotos,
            albumPhotosLoading,
            albumPhotosNextToken,
            () => loadAlbumPhotos(selectedAlbum.id, albumPhotosNextToken)
          )}
        </div>

        <Image
          style={{ display: 'none' }}
          preview={{
            visible: previewVisible,
            src: previewUrl,
            onVisibleChange: (visible) => setPreviewVisible(visible),
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'all', label: '全部照片' },
            { key: 'albums', label: '相册' },
          ]}
          style={{ marginBottom: 0 }}
        />
        <Space>
          <Tooltip title="刷新">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                if (activeTab === 'all') loadPhotos();
                else loadAlbums();
              }}
            />
          </Tooltip>
          {activeTab === 'albums' && (
            <Tooltip title="创建相册">
              <Button icon={<PlusOutlined />} onClick={handleCreateAlbum} />
            </Tooltip>
          )}
          <Tooltip title={`已登录: ${email}`}>
            <Button icon={<LogoutOutlined />} onClick={handleLogout} danger>退出</Button>
          </Tooltip>
        </Space>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'all' && renderPhotoGrid(
          photos,
          photosLoading,
          photosNextToken,
          () => loadPhotos(photosNextToken)
        )}

        {activeTab === 'albums' && (
          albumsLoading && albums.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
              <Spin size="large" />
            </div>
          ) : albums.length === 0 ? (
            <Empty description="没有相册" />
          ) : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: spacing.md,
              }}>
                {albums.map(album => (
                  <Card
                    key={album.id}
                    hoverable
                    cover={
                      album.coverPhotoBaseUrl ? (
                        <img
                          src={getThumbnailUrl(album.coverPhotoBaseUrl, 400)}
                          alt={album.title}
                          style={{ height: 160, objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{
                          height: 160,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: colors.bgElevated || '#f5f5f5',
                        }}>
                          <FolderOpenOutlined style={{ fontSize: 40, color: colors.textTertiary }} />
                        </div>
                      )
                    }
                    onClick={() => openAlbum(album)}
                  >
                    <Card.Meta
                      title={album.title}
                      description={`${album.mediaItemsCount} 张照片`}
                    />
                  </Card>
                ))}
              </div>

              {albumsNextToken && (
                <div style={{ textAlign: 'center', padding: spacing.lg }}>
                  <Button onClick={() => loadAlbums(albumsNextToken)} loading={albumsLoading}>
                    加载更多
                  </Button>
                </div>
              )}
            </>
          )
        )}
      </div>

      {/* 照片预览 */}
      <Image
        style={{ display: 'none' }}
        preview={{
          visible: previewVisible,
          src: previewUrl,
          onVisibleChange: (visible) => setPreviewVisible(visible),
        }}
      />
    </div>
  );
};
