/**
 * Google Drive 文件管理页面
 * 功能：文件浏览、面包屑导航、搜索、上传、新建文件夹、下载、删除
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Input, Space, Spin, Empty, message, Breadcrumb,
  Card, Dropdown, Modal, Progress, Tooltip, Tag
} from 'antd';
import {
  FolderOutlined, FileImageOutlined, FileOutlined,
  UploadOutlined, FolderAddOutlined, DownloadOutlined,
  DeleteOutlined, ReloadOutlined, SearchOutlined,
  AppstoreOutlined, UnorderedListOutlined, EyeOutlined,
  LoginOutlined, LogoutOutlined, CloudOutlined
} from '@ant-design/icons';
import { colors, spacing, fontSize } from '../styles/tokens';

const { Search } = Input;

// ============= 类型定义 =============

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  thumbnailLink?: string;
  webViewLink?: string;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

// ============= 工具函数 =============

function formatFileSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isFolder(mimeType: string): boolean {
  return mimeType === 'application/vnd.google-apps.folder';
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function getFileIcon(mimeType: string) {
  if (isFolder(mimeType)) return <FolderOutlined style={{ fontSize: 40, color: '#FBBC04' }} />;
  if (isImage(mimeType)) return <FileImageOutlined style={{ fontSize: 40, color: '#4285F4' }} />;
  return <FileOutlined style={{ fontSize: 40, color: '#6B7280' }} />;
}

// ============= 组件 =============

export const GoogleDrivePage: React.FC = () => {
  // 认证状态
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // 文件列表
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();

  // 导航
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: 'root', name: '我的云端硬盘' }]);
  const currentFolderId = breadcrumbs[breadcrumbs.length - 1].id;

  // 存储空间
  const [storage, setStorage] = useState<{ totalGB: number; usedGB: number } | null>(null);

  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // 视图模式
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // ============= 认证 =============

  const checkAuth = useCallback(async () => {
    try {
      const result = await window.electronAPI.google.getAuthStatus();
      if (result.success && result.data) {
        setIsLoggedIn(result.data.isLoggedIn);
        setEmail(result.data.email || '');
      }
    } catch (error) {
      console.error('[GoogleDrive] 检查认证状态失败:', error);
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
        loadFiles('root');
        loadStorage();
      } else {
        message.error('登录失败: ' + (result.error || '未知错误'));
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
      setFiles([]);
      setStorage(null);
      message.success('已退出 Google 账号');
    }
  };

  // ============= 文件操作 =============

  const loadFiles = useCallback(async (folderId: string, pageToken?: string) => {
    setLoading(true);
    try {
      const result = await window.electronAPI.gdrive.listFiles(folderId, 50, pageToken);
      if (result.success && result.data) {
        if (pageToken) {
          setFiles(prev => [...prev, ...result.data.files]);
        } else {
          setFiles(result.data.files);
        }
        setNextPageToken(result.data.nextPageToken);
      } else {
        message.error('加载文件列表失败: ' + (result.error || ''));
      }
    } catch (error) {
      message.error('加载文件列表失败: ' + String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const result = await window.electronAPI.gdrive.getStorage();
      if (result.success && result.data) {
        setStorage(result.data);
      }
    } catch (error) {
      console.warn('[GoogleDrive] 加载存储空间失败:', error);
    }
  }, []);

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setIsSearching(false);
      loadFiles(currentFolderId);
      return;
    }
    setIsSearching(true);
    setLoading(true);
    try {
      const result = await window.electronAPI.gdrive.search(query);
      if (result.success && result.data) {
        setFiles(result.data.files);
        setNextPageToken(result.data.nextPageToken);
      }
    } catch (error) {
      message.error('搜索失败: ' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleFolderClick = (file: DriveFile) => {
    setBreadcrumbs(prev => [...prev, { id: file.id, name: file.name }]);
    setSearchQuery('');
    setIsSearching(false);
    loadFiles(file.id);
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setSearchQuery('');
    setIsSearching(false);
    loadFiles(newBreadcrumbs[newBreadcrumbs.length - 1].id);
  };

  const handleDownload = async (file: DriveFile) => {
    try {
      message.loading({ content: `正在下载 ${file.name}...`, key: 'download' });
      const result = await window.electronAPI.gdrive.download(file.id);
      if (result.success) {
        message.success({ content: `下载完成: ${result.data}`, key: 'download' });
      } else {
        message.error({ content: '下载失败: ' + (result.error || ''), key: 'download' });
      }
    } catch (error) {
      message.error({ content: '下载失败: ' + String(error), key: 'download' });
    }
  };

  const handleDelete = async (file: DriveFile) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要将 "${file.name}" 移到回收站吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await window.electronAPI.gdrive.delete(file.id);
          if (result.success) {
            message.success('已移到回收站');
            setFiles(prev => prev.filter(f => f.id !== file.id));
          } else {
            message.error('删除失败: ' + (result.error || ''));
          }
        } catch (error) {
          message.error('删除失败: ' + String(error));
        }
      },
    });
  };

  const handleUpload = async () => {
    try {
      // 使用系统文件选择对话框
      const result = await window.electronAPI.system.selectFolder();
      // selectFolder 只能选文件夹，对于上传需要选文件
      // 暂时使用简单方式：用户在前端输入路径或拖拽
      message.info('上传功能开发中...');
    } catch (error) {
      message.error('上传失败: ' + String(error));
    }
  };

  const handleCreateFolder = () => {
    let folderName = '';
    Modal.confirm({
      title: '新建文件夹',
      content: (
        <Input
          placeholder="文件夹名称"
          onChange={e => folderName = e.target.value}
          autoFocus
        />
      ),
      onOk: async () => {
        if (!folderName.trim()) {
          message.warning('请输入文件夹名称');
          return;
        }
        try {
          const result = await window.electronAPI.gdrive.createFolder(folderName, currentFolderId === 'root' ? undefined : currentFolderId);
          if (result.success) {
            message.success('文件夹创建成功');
            loadFiles(currentFolderId);
          } else {
            message.error('创建失败: ' + (result.error || ''));
          }
        } catch (error) {
          message.error('创建失败: ' + String(error));
        }
      },
    });
  };

  // ============= 初始化 =============

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isLoggedIn) {
      loadFiles('root');
      loadStorage();
    }
  }, [isLoggedIn, loadFiles, loadStorage]);

  // ============= 渲染 =============

  // 未登录状态
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
        <CloudOutlined style={{ fontSize: 64, color: '#4285F4' }} />
        <div style={{ fontSize: fontSize.xl, fontWeight: 600, color: colors.textPrimary }}>
          连接 Google Drive
        </div>
        <div style={{ fontSize: fontSize.md, color: colors.textTertiary, textAlign: 'center' }}>
          登录 Google 账号以管理您的云端硬盘文件
        </div>
        <Button type="primary" size="large" icon={<LoginOutlined />} onClick={handleLogin}>
          登录 Google 账号
        </Button>
      </div>
    );
  }

  // 右键菜单
  const getContextMenuItems = (file: DriveFile) => ({
    items: [
      ...(isImage(file.mimeType) ? [{
        key: 'preview',
        label: '预览',
        icon: <EyeOutlined />,
      }] : []),
      {
        key: 'download',
        label: '下载到本地',
        icon: <DownloadOutlined />,
        onClick: () => handleDownload(file),
      },
      { type: 'divider' as const },
      {
        key: 'delete',
        label: '移到回收站',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDelete(file),
      },
    ],
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
        <Space>
          {/* 面包屑导航 */}
          <Breadcrumb
            items={breadcrumbs.map((item, index) => ({
              title: (
                <a onClick={() => handleBreadcrumbClick(index)} style={{ cursor: 'pointer' }}>
                  {item.name}
                </a>
              ),
            }))}
          />
          {isSearching && <Tag color="blue">搜索结果</Tag>}
        </Space>

        <Space>
          <Search
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onSearch={handleSearch}
            allowClear
            onClear={() => {
              setIsSearching(false);
              loadFiles(currentFolderId);
            }}
            style={{ width: 240 }}
          />
          <Tooltip title="新建文件夹">
            <Button icon={<FolderAddOutlined />} onClick={handleCreateFolder} />
          </Tooltip>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={() => loadFiles(currentFolderId)} />
          </Tooltip>
          <Tooltip title={viewMode === 'grid' ? '列表视图' : '网格视图'}>
            <Button
              icon={viewMode === 'grid' ? <UnorderedListOutlined /> : <AppstoreOutlined />}
              onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
            />
          </Tooltip>
          <Tooltip title={`已登录: ${email}`}>
            <Button icon={<LogoutOutlined />} onClick={handleLogout} danger>
              退出
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* 文件列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && files.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
            <Spin size="large" />
          </div>
        ) : files.length === 0 ? (
          <Empty description={isSearching ? '没有找到匹配的文件' : '此文件夹为空'} />
        ) : viewMode === 'grid' ? (
          // 网格视图
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: spacing.md,
          }}>
            {files.map(file => (
              <Dropdown key={file.id} menu={getContextMenuItems(file)} trigger={['contextMenu']}>
                <Card
                  hoverable
                  size="small"
                  style={{
                    textAlign: 'center',
                    cursor: isFolder(file.mimeType) ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (isFolder(file.mimeType)) handleFolderClick(file);
                  }}
                  onDoubleClick={() => {
                    if (!isFolder(file.mimeType)) handleDownload(file);
                  }}
                >
                  <div style={{ padding: '12px 0' }}>
                    {file.thumbnailLink && isImage(file.mimeType) ? (
                      <img
                        src={file.thumbnailLink}
                        alt={file.name}
                        style={{ width: '100%', maxHeight: 100, objectFit: 'contain', borderRadius: 4 }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.removeAttribute('style');
                        }}
                      />
                    ) : (
                      getFileIcon(file.mimeType)
                    )}
                  </div>
                  <div style={{
                    fontSize: fontSize.sm,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: colors.textPrimary,
                  }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
                    {isFolder(file.mimeType) ? '文件夹' : formatFileSize(file.size)}
                  </div>
                </Card>
              </Dropdown>
            ))}
          </div>
        ) : (
          // 列表视图
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {files.map(file => (
              <Dropdown key={file.id} menu={getContextMenuItems(file)} trigger={['contextMenu']}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: `${spacing.xs}px ${spacing.sm}px`,
                    borderRadius: 6,
                    cursor: isFolder(file.mimeType) ? 'pointer' : 'default',
                  }}
                  className="hover-bg"
                  onClick={() => {
                    if (isFolder(file.mimeType)) handleFolderClick(file);
                  }}
                  onDoubleClick={() => {
                    if (!isFolder(file.mimeType)) handleDownload(file);
                  }}
                >
                  {getFileIcon(file.mimeType)}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: fontSize.md, color: colors.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </div>
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: colors.textTertiary, flexShrink: 0 }}>
                    {isFolder(file.mimeType) ? '-' : formatFileSize(file.size)}
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: colors.textTertiary, flexShrink: 0, width: 120, textAlign: 'right' }}>
                    {new Date(file.modifiedTime).toLocaleDateString()}
                  </div>
                </div>
              </Dropdown>
            ))}
          </div>
        )}

        {/* 加载更多 */}
        {nextPageToken && (
          <div style={{ textAlign: 'center', padding: spacing.lg }}>
            <Button onClick={() => loadFiles(currentFolderId, nextPageToken)} loading={loading}>
              加载更多
            </Button>
          </div>
        )}
      </div>

      {/* 底部存储空间 */}
      {storage && (
        <div style={{
          padding: `${spacing.sm}px 0`,
          borderTop: `1px solid ${colors.separator}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
        }}>
          <span style={{ fontSize: fontSize.sm, color: colors.textTertiary }}>
            存储空间: {storage.usedGB.toFixed(1)} GB / {storage.totalGB.toFixed(0)} GB
          </span>
          <Progress
            percent={Math.round((storage.usedGB / storage.totalGB) * 100)}
            size="small"
            style={{ flex: 1, maxWidth: 200 }}
            showInfo={false}
          />
        </div>
      )}
    </div>
  );
};
