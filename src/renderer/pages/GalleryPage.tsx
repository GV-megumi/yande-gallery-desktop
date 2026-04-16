import React, { useState, useEffect, useRef } from 'react';
import type { GalleryPagePreferencesBySubTab } from '../../main/services/config';
import { Button, Empty, message, Spin, Card, Tag, Space, Input, Row, Col, Segmented, Popover, Descriptions, Modal, Tooltip, Dropdown, Form } from 'antd';
import { FolderOpenOutlined, SearchOutlined, QuestionCircleOutlined, ReloadOutlined, SyncOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ImageGrid } from '../components/ImageGrid';
import { ImageListWrapper } from '../components/ImageListWrapper';
import { ImageSearchBar } from '../components/ImageSearchBar';
import { LazyLoadFooter } from '../components/LazyLoadFooter';
import { GalleryCoverImage } from '../components/GalleryCoverImage';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { localPathToAppUrl } from '../utils/url';
import { colors, spacing, radius, fontSize, zIndex } from '../styles/tokens';

const { Search } = Input;

const areGalleryPreferencesEqual = (
  left?: GalleryPagePreferencesBySubTab,
  right?: GalleryPagePreferencesBySubTab,
) => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

// 添加样式，限制超大屏幕上最多5列
const galleryGridStyle = `
  @media (min-width: 1200px) {
    .gallery-grid .gallery-col.ant-col-xl-4 {
      flex: 0 0 calc(20% - 13.6px) !important;
      max-width: calc(20% - 13.6px) !important;
    }
  }
`;

// 注入样式
if (typeof document !== 'undefined') {
  const styleId = 'gallery-grid-style';
  let styleElement = document.getElementById(styleId);
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = galleryGridStyle;
    document.head.appendChild(styleElement);
  }
}

interface GalleryPageProps {
  subTab?: 'recent' | 'all' | 'galleries';
}


export const GalleryPage: React.FC<GalleryPageProps> = ({ subTab = 'recent' }) => {
  // 分离不同模式的状态，避免相互干扰
  const [recentImages, setRecentImages] = useState<any[]>([]); // 最近图片数据（懒加载，一次2000张）
  const [allImages, setAllImages] = useState<any[]>([]); // 所有图片分页数据（每次20张）
  const [galleryImages, setGalleryImages] = useState<any[]>([]); // 图集图片数据（懒加载，一次1000张）
  const [galleries, setGalleries] = useState<any[]>([]);
  const [selectedGallery, setSelectedGallery] = useState<any | null>(null);
  // 最近图片懒加载：当前可见数量
  const [recentVisibleCount, setRecentVisibleCount] = useState(200);
  const [gallerySort, setGallerySort] = useState<'time' | 'name'>('time');
  const [allPage, setAllPage] = useState(1);
  const [allHasMore, setAllHasMore] = useState(true);
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(200);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [gallerySearchQuery, setGallerySearchQuery] = useState('');
  const [allGalleries, setAllGalleries] = useState<any[]>([]);
  const [selectedGalleryInfo, setSelectedGalleryInfo] = useState<any | null>(null);
  const [detailSourceFavoriteTags, setDetailSourceFavoriteTags] = useState<any[]>([]);
  const [modalSourceFavoriteTags, setModalSourceFavoriteTags] = useState<any[]>([]);
  // 搜索模式状态
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchTotal, setSearchTotal] = useState(0);
  // 图集排序相关状态
  const [gallerySortKey, setGallerySortKey] = useState<'name' | 'createdAt' | 'updatedAt'>('updatedAt');
  const [gallerySortOrder, setGallerySortOrder] = useState<'asc' | 'desc'>('desc');
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [preferencesHydrationVersion, setPreferencesHydrationVersion] = useState(0);
  const preferencesHydrationRunIdRef = useRef(0);
  const preferencesHydratingRef = useRef(false);
  const skipNextPreferenceSaveRef = useRef(false);
  const lastSavedPreferencesRef = useRef<GalleryPagePreferencesBySubTab | undefined>(undefined);
  const galleryDetailRequestRunIdRef = useRef(0);
  const galleryInfoRequestRunIdRef = useRef(0);

  // 同步文件夹状态
  const [syncing, setSyncing] = useState(false);

  // 编辑图集模态框状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingGallery, setEditingGallery] = useState<any>(null);
  const [editForm] = Form.useForm();

  // 同步图集文件夹
  const handleSyncGalleryFolder = async () => {
    if (!selectedGallery) return;
    setSyncing(true);
    try {
      const result = await window.electronAPI.gallery.syncGalleryFolder(selectedGallery.id);
      if (result.success && result.data) {
        message.success(`同步完成：导入 ${result.data.imported} 张，跳过 ${result.data.skipped} 张`);
        // 重新加载图集图片和图集信息以反映最新统计
        await loadGalleryImages(selectedGallery.id);
        await loadGalleries();
      } else {
        message.error(result.error || '同步失败');
      }
    } catch (error) {
      console.error('[GalleryPage] 同步图集文件夹失败:', error);
      message.error('同步文件夹失败');
    } finally {
      setSyncing(false);
    }
  };

  // 打开编辑图集模态框
  const handleOpenEditGallery = (gallery: any) => {
    setEditingGallery(gallery);
    editForm.setFieldsValue({ name: gallery.name });
    setEditModalOpen(true);
  };

  // 保存图集编辑
  const handleSaveGalleryEdit = async () => {
    try {
      const values = await editForm.validateFields();
      if (!editingGallery) return;
      const result = await window.electronAPI.gallery.updateGallery(editingGallery.id, { name: values.name.trim() });
      if (result.success) {
        message.success('图集已更新');
        setEditModalOpen(false);
        setEditingGallery(null);
        await loadGalleries();
        // 如果编辑的是当前选中的图集，更新其名称
        if (selectedGallery && selectedGallery.id === editingGallery.id) {
          setSelectedGallery({ ...selectedGallery, name: values.name.trim() });
        }
      } else {
        message.error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('[GalleryPage] 图集更新失败:', error);
    }
  };

  const handleDeleteGallery = (gallery: any) => {
    Modal.confirm({
      title: '删除图集',
      content: `确定要删除图集“${gallery.name}”吗？此操作只会删除图集记录及其关联记录，不会删除本地文件。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await window.electronAPI.gallery.deleteGallery(gallery.id);
          if (result.success) {
            message.success('图集已删除');
            if (selectedGallery?.id === gallery.id) {
              galleryDetailRequestRunIdRef.current += 1;
              setSelectedGallery(null);
              setGalleryImages([]);
              setDetailSourceFavoriteTags([]);
            }
            if (selectedGalleryInfo?.id === gallery.id) {
              galleryInfoRequestRunIdRef.current += 1;
              setSelectedGalleryInfo(null);
              setModalSourceFavoriteTags([]);
            }
            await loadGalleries();
          } else {
            message.error(result.error || '删除失败');
          }
        } catch (error) {
          console.error('[GalleryPage] 图集删除失败:', error);
          message.error('删除图集失败');
        }
      }
    });
  };

  // 加载最近图片
  const loadRecentImages = async (count: number = 2000) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    console.log(`[GalleryPage] 开始加载最近图片，数量: ${count}`);
    setLoading(true);
    // 每次重新加载最近图片时，重置可见数量
    setRecentVisibleCount(200);
    try {
      const result = await window.electronAPI.gallery.getRecentImages(count);
      if (result.success) {
        const data = result.data || [];
        console.log(`[GalleryPage] 最近图片加载成功，共 ${data.length} 张`);
        setRecentImages(data); // 存储到recentImages
      } else {
        console.error('[GalleryPage] 加载最近图片失败:', result.error);
        message.error('加载最近图片失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load recent images:', error);
      message.error('加载最近图片失败');
    } finally {
      setLoading(false);
      console.log('[GalleryPage] 最近图片加载完成');
    }
  };

  // 加载所有图片（分页加载，每次只加载一页，每页20张避免内存问题）
  const loadImages = async (page: number = 1, pageSize: number = 20) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    console.log(`[GalleryPage] 开始加载所有图片，页码: ${page}, 每页: ${pageSize}`);
    setLoading(true);
    // 切换页面时先清空旧数据，避免内存累积
    setAllImages([]); // 清空所有图片数据
    console.log(`[loadImages] 前端请求: page=${page}, pageSize=${pageSize}`);
    try {
      const result = await window.electronAPI.db.getImages(page, pageSize);
      if (result.success) {
        const list = result.data || [];
        console.log(`[loadImages] 前端收到数据数量: ${list.length}`);
        setAllImages(list); // 存储到allImages（只包含当前页的20张）
        // 如果返回数量少于 pageSize，说明已经没有更多
        setAllHasMore(list.length >= pageSize);
        console.log(`[GalleryPage] 所有图片加载成功，当前页 ${page}，共 ${list.length} 张`);
      } else {
        console.error('[GalleryPage] 加载所有图片失败:', result.error);
        message.error('加载图片失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load images:', error);
      message.error('加载图片失败');
    } finally {
      setLoading(false);
      console.log('[GalleryPage] 所有图片加载完成');
    }
  };

  // 加载图集列表
  const loadGalleries = async (options?: {
    query?: string;
    sortKey?: 'name' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
  }) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    const nextQuery = options?.query ?? gallerySearchQuery;
    const nextSortKey = options?.sortKey ?? gallerySortKey;
    const nextSortOrder = options?.sortOrder ?? gallerySortOrder;

    console.log('[GalleryPage] 开始加载图集列表');
    setLoading(true);
    try {
      const result = await window.electronAPI.gallery.getGalleries();
      if (result.success) {
        const galleryList = result.data || [];
        console.log(`[GalleryPage] 图集列表加载成功，共 ${galleryList.length} 个图集`);
        setAllGalleries(galleryList);
        setGalleries(filterAndSortGalleries(galleryList, nextQuery, nextSortKey, nextSortOrder));
      } else {
        console.error('[GalleryPage] 加载图集失败:', result.error);
        message.error('加载图集失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load galleries:', error);
      message.error('加载图集失败');
    } finally {
      setLoading(false);
      console.log('[GalleryPage] 图集列表加载完成');
    }
  };

  // 搜索图集名称
  const handleGallerySearch = (query: string) => {
    console.log(`[GalleryPage] 搜索图集，查询条件: ${query}`);
    setGallerySearchQuery(query);
    setGalleries(filterAndSortGalleries(allGalleries, query, gallerySortKey, gallerySortOrder));
  };

  // 搜索图片（支持分页，每次只加载一页，每页20张避免内存问题）
  const handleSearch = async (query: string, page: number = 1, pageSize: number = 20) => {
    if (!window.electronAPI) return;

    if (!query.trim()) {
      console.log('[GalleryPage] 搜索条件为空，退出搜索模式');
      setIsSearchMode(false);
      setSearchQuery('');
      setSearchPage(1);
      loadImages(1, 20);
      return;
    }

    console.log(`[GalleryPage] 开始搜索图片，查询: "${query}", 页码: ${page}, 每页: ${pageSize}`);
    setLoading(true);
    setIsSearchMode(true);
    setSearchPage(page);
    // 切换页面时先清空旧数据，避免内存累积
    setAllImages([]); // 清空所有图片数据
    try {
      const result: any = await window.electronAPI.db.searchImages(query, page, pageSize);
      if (result.success) {
        const list = result.data || [];
        console.log(`[GalleryPage] 图片搜索成功，页码: ${page}, 数量: ${list.length}, 总计: ${result.total || 0}`);
        setAllImages(list); // 存储到allImages（搜索结果，只包含当前页的20张）
        setSearchTotal(result.total || 0);
        // 如果返回数量少于 pageSize，说明已经没有更多
        setSearchHasMore(list.length >= pageSize);
      } else {
        console.error('[GalleryPage] 图片搜索失败:', result.error);
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('Search failed:', error);
      message.error('搜索失败');
    } finally {
      setLoading(false);
      console.log('[GalleryPage] 图片搜索完成');
    }
  };

  // 搜索输入框的回调（只接收一个参数）
  const handleSearchInput = (value: string) => {
    console.log(`[GalleryPage] 搜索输入: ${value}`);
    handleSearch(value, 1, 50);
  };

  // 加载图集图片
  const loadGalleryImages = async (galleryId: number) => {
    if (!window.electronAPI) return;

    const requestRunId = galleryDetailRequestRunIdRef.current + 1;
    galleryDetailRequestRunIdRef.current = requestRunId;
    const isLatestRequest = () => galleryDetailRequestRunIdRef.current === requestRunId;

    console.log(`[GalleryPage] 开始加载图集图片，图集ID: ${galleryId}`);
    setLoading(true);
    try {
      // 每次加载新图集时重置可见数量
      setGalleryVisibleCount(200);
      const galleryResult = await window.electronAPI.gallery.getGallery(galleryId);
      if (!isLatestRequest()) {
        return;
      }
      if (galleryResult.success && galleryResult.data) {
        const gallery = galleryResult.data;
        const sourceResult = await window.electronAPI.booru.getGallerySourceFavoriteTags(galleryId);
        if (!isLatestRequest()) {
          return;
        }
        if (sourceResult.success && sourceResult.data) {
          setDetailSourceFavoriteTags(sourceResult.data);
        } else {
          setDetailSourceFavoriteTags([]);
        }
        const folderPath = gallery.folderPath;
        console.log(`[GalleryPage] 图集 "${gallery.name}" 路径: ${folderPath}`);
        // 单个图集一次性加载较多图片（例如 1000 张），方便浏览
        const result = await window.electronAPI.gallery.getImagesByFolder(folderPath, 1, 1000);
        if (!isLatestRequest()) {
          return;
        }
        if (result.success) {
          const data = result.data || [];
          console.log(`[GalleryPage] 图集图片加载成功，数量: ${data.length}`);
          setGalleryImages(data); // 存储到galleryImages

          // 如果没有封面且有图片，自动设置第一张图为封面
          if (!gallery.coverImageId && data.length > 0 && data[0].id) {
            console.log('[GalleryPage] 图集无封面，自动设置第一张图片为封面');
            try {
              await window.electronAPI.gallery.setGalleryCover(galleryId, data[0].id);
              if (!isLatestRequest()) {
                return;
              }
              // 更新选中的图集信息
              const updatedResult = await window.electronAPI.gallery.getGallery(galleryId);
              if (!isLatestRequest()) {
                return;
              }
              if (updatedResult.success && updatedResult.data) {
                setSelectedGallery(updatedResult.data);
                // 刷新图集列表
                loadGalleries();
              }
            } catch (error) {
              console.error('自动设置封面失败:', error);
            }
          }
        } else {
          console.error('[GalleryPage] 加载图集图片失败:', result.error);
          message.error('加载图集图片失败: ' + result.error);
        }
      } else {
        console.error('[GalleryPage] 获取图集信息失败:', galleryResult.error);
      }
    } catch (error) {
      if (isLatestRequest()) {
        console.error('Failed to load gallery images:', error);
        message.error('加载图集图片失败');
      }
    } finally {
      if (isLatestRequest()) {
        setLoading(false);
        console.log('[GalleryPage] 图集图片加载完成');
      }
    }
  };

  // 设置图集封面
  const handleSetCover = async (imageId: number) => {
    if (!window.electronAPI || !selectedGallery) return;

    console.log(`[GalleryPage] 开始设置图集封面，图集ID: ${selectedGallery.id}, 图片ID: ${imageId}`);
    try {
      const result = await window.electronAPI.gallery.setGalleryCover(selectedGallery.id, imageId);
      if (result.success) {
        console.log('[GalleryPage] 封面设置成功');
        message.success('封面设置成功');

        // 找到新设置的封面图片（从当前已加载的图片中找）
        const newCoverImage = galleryImages.find((img: any) => img.id === imageId);

        // 更新当前选中的图集信息（直接使用已有数据，避免重新请求）
        setSelectedGallery((prev: any) => {
          if (!prev) return prev;
          console.log('[GalleryPage] 更新选中图集的封面信息');
          return {
            ...prev,
            coverImage: newCoverImage || prev.coverImage,
            coverImageId: imageId
          };
        });

        // 更新 allGalleries 中的封面信息（用于图集列表显示，不影响当前查看的图集）
        setAllGalleries((prevAllGalleries) => {
          return prevAllGalleries.map((gallery: any) => {
            if (gallery.id === selectedGallery.id) {
              return {
                ...gallery,
                coverImage: newCoverImage || gallery.coverImage,
                coverImageId: imageId
              };
            }
            return gallery;
          });
        });

        // 只有在显示图集列表且没有选中图集时才更新 galleries（避免触发不必要的 useEffect）
        // 这样当用户在查看图集内的图片时，不会触发 galleries 的 useEffect
        if (subTab === 'galleries' && !selectedGallery) {
          setGalleries((prevGalleries) => {
            return prevGalleries.map((gallery: any) => {
              if (gallery.id === selectedGallery.id) {
                return {
                  ...gallery,
                  coverImage: newCoverImage || gallery.coverImage,
                  coverImageId: imageId
                };
              }
              return gallery;
            });
          });
        }

        // 异步加载新封面的缩略图（不阻塞 UI）
        if (newCoverImage?.filepath) {
          console.log('[GalleryPage] 异步加载新封面的缩略图');
          window.electronAPI.image
            .getThumbnail(newCoverImage.filepath)
            .then((thumbResult) => {
              if (thumbResult.success && thumbResult.data) {
                setCoverThumbnails((prev) => ({
                  ...prev,
                  [selectedGallery.id]: thumbResult.data || null
                }));
                console.log('[GalleryPage] 新封面缩略图加载成功');
              }
            })
            .catch((error) => {
              console.error('获取新封面缩略图失败:', error);
            });
        }
      } else {
        console.error('[GalleryPage] 设置封面失败:', result.error);
        message.error('设置封面失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to set cover:', error);
      message.error('设置封面失败');
    }
  };

  // 创建新图集
  const handleCreateGallery = async () => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    const result = await window.electronAPI.system.selectFolder();
    if (!result.success || !result.data) {
      return;
    }

    const folderPath = result.data;
    const folderName = folderPath.split(/[/\\]/).pop() || '新图集';

    try {
      const createResult = await window.electronAPI.gallery.createGallery({
        folderPath,
        name: folderName,
        recursive: true
      });

      if (createResult.success) {
        message.success('图集创建成功');
        loadGalleries();
      } else {
        message.error('创建图集失败: ' + createResult.error);
      }
    } catch (error) {
      console.error('Failed to create gallery:', error);
      message.error('创建图集失败');
    }
  };

  const persistPreferences = async (preferences: GalleryPagePreferencesBySubTab) => {
    try {
      await window.electronAPI.pagePreferences.gallery.save(preferences);
      lastSavedPreferencesRef.current = preferences;
    } catch (error) {
      console.error('[GalleryPage] 保存页面偏好失败:', error);
    }
  };

  // 对图集列表进行排序
  const sortGalleries = (
    galleryList: any[],
    sortKey: 'name' | 'createdAt' | 'updatedAt' = gallerySortKey,
    sortOrder: 'asc' | 'desc' = gallerySortOrder,
  ): any[] => {
    console.log(`[GalleryPage] 开始对图集进行排序，排序字段: ${sortKey}, 排序顺序: ${sortOrder}`);

    const sorted = [...galleryList].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortKey) {
        case 'name':
          aValue = a.name?.toLowerCase() || '';
          bValue = b.name?.toLowerCase() || '';
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt || 0).getTime();
          bValue = new Date(b.createdAt || 0).getTime();
          break;
        case 'updatedAt':
          aValue = new Date(a.updatedAt || 0).getTime();
          bValue = new Date(b.updatedAt || 0).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    console.log(`[GalleryPage] 图集排序完成，共 ${sorted.length} 个`);
    return sorted;
  };

  const filterAndSortGalleries = (
    galleryList: any[],
    query: string = gallerySearchQuery,
    sortKey: 'name' | 'createdAt' | 'updatedAt' = gallerySortKey,
    sortOrder: 'asc' | 'desc' = gallerySortOrder,
  ) => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? galleryList.filter((gallery: any) => gallery.name.toLowerCase().includes(normalizedQuery))
      : galleryList;

    if (normalizedQuery) {
      console.log(`[GalleryPage] 图集搜索过滤后数量: ${filtered.length}`);
    } else {
      console.log('[GalleryPage] 显示全部图集');
    }

    return sortGalleries(filtered, sortKey, sortOrder);
  };

  useEffect(() => {
    let cancelled = false;
    const runId = preferencesHydrationRunIdRef.current + 1;
    preferencesHydrationRunIdRef.current = runId;
    preferencesHydratingRef.current = true;
    setPreferencesHydrated(false);

    const hydratePreferences = async () => {
      try {
        const result = await window.electronAPI.pagePreferences.gallery.get();
        if (!result.success || cancelled || preferencesHydrationRunIdRef.current !== runId) {
          return;
        }

        const allPreferences = result.data?.all;
        const galleriesPreferences = result.data?.galleries;
        skipNextPreferenceSaveRef.current = true;
        lastSavedPreferencesRef.current = result.data;

        console.log(`[GalleryPage] 切换标签页到: ${subTab}`);
        if (subTab === 'recent') {
          console.log('[GalleryPage] 初始化"最近图片"模式');
          galleryDetailRequestRunIdRef.current += 1;
          galleryInfoRequestRunIdRef.current += 1;
          setSelectedGalleryInfo(null);
          setModalSourceFavoriteTags([]);
          setRecentVisibleCount(200);
          setIsSearchMode(false);
          setSearchQuery('');
          console.log('[GalleryPage] 清空其他模式的数据');
          setAllImages([]);
          setGalleryImages([]);
          loadRecentImages(2000);
        } else if (subTab === 'all') {
          console.log('[GalleryPage] 初始化"所有图片"模式');
          galleryDetailRequestRunIdRef.current += 1;
          galleryInfoRequestRunIdRef.current += 1;
          setSelectedGalleryInfo(null);
          setModalSourceFavoriteTags([]);
          const nextSearchQuery = allPreferences?.searchQuery ?? '';
          const nextIsSearchMode = allPreferences?.isSearchMode ?? false;
          const nextAllPage = allPreferences?.allPage ?? 1;
          const nextSearchPage = allPreferences?.searchPage ?? 1;

          setAllPage(nextAllPage);
          setIsSearchMode(nextIsSearchMode);
          setSearchQuery(nextSearchQuery);
          console.log('[GalleryPage] 清空其他模式的数据');
          setRecentImages([]);
          setGalleryImages([]);
          setAllImages([]);

          if (nextIsSearchMode && nextSearchQuery.trim()) {
            setSearchPage(nextSearchPage);
            loadSearch(nextSearchQuery, nextSearchPage, 20);
          } else {
            loadImages(nextAllPage, 20);
          }
        } else if (subTab === 'galleries') {
          console.log('[GalleryPage] 初始化"图集"模式');
          setGallerySearchQuery(galleriesPreferences?.gallerySearchQuery ?? '');
          setGallerySortKey(galleriesPreferences?.gallerySortKey ?? 'updatedAt');
          setGallerySortOrder(galleriesPreferences?.gallerySortOrder ?? 'desc');
          setGallerySort(galleriesPreferences?.gallerySort ?? 'time');
          console.log('[GalleryPage] 清空其他模式的数据');
          galleryDetailRequestRunIdRef.current += 1;
          galleryInfoRequestRunIdRef.current += 1;
          setRecentImages([]);
          setAllImages([]);
          setGalleryImages([]);
          setSelectedGallery(null);
          setDetailSourceFavoriteTags([]);
          setModalSourceFavoriteTags([]);
          await loadGalleries({
            query: galleriesPreferences?.gallerySearchQuery ?? '',
            sortKey: galleriesPreferences?.gallerySortKey ?? 'updatedAt',
            sortOrder: galleriesPreferences?.gallerySortOrder ?? 'desc',
          });
          if (galleriesPreferences?.selectedGalleryId) {
            const galleryResult = await window.electronAPI.gallery.getGallery(galleriesPreferences.selectedGalleryId);
            if (galleryResult.success && galleryResult.data && !cancelled && preferencesHydrationRunIdRef.current === runId) {
              setSelectedGallery(galleryResult.data);
              loadGalleryImages(galleriesPreferences.selectedGalleryId);
            }
          }
        }
      } catch (error) {
        console.error('[GalleryPage] 加载页面偏好失败:', error);
      } finally {
        if (!cancelled && preferencesHydrationRunIdRef.current === runId) {
          preferencesHydratingRef.current = false;
          setPreferencesHydrated(true);
          setPreferencesHydrationVersion(runId);
        }
      }
    };

    const loadSearch = (query: string, page: number, pageSize: number) => {
      handleSearch(query, page, pageSize);
    };

    hydratePreferences();

    return () => {
      cancelled = true;
      if (preferencesHydrationRunIdRef.current === runId) {
        preferencesHydratingRef.current = false;
      }
    };
  }, [subTab]);

  useEffect(() => {
    if (!preferencesHydrated || preferencesHydratingRef.current) {
      return;
    }

    const hydrationVersionAtEffect = preferencesHydrationVersion;
    let nextPreferences: GalleryPagePreferencesBySubTab | undefined;

    if (subTab === 'all') {
      if (preferencesHydratingRef.current || hydrationVersionAtEffect !== preferencesHydrationRunIdRef.current) {
        return;
      }
      nextPreferences = {
        all: {
          searchQuery,
          isSearchMode,
          allPage,
          searchPage,
        },
      };
    }

    if (subTab === 'galleries') {
      if (preferencesHydratingRef.current || hydrationVersionAtEffect !== preferencesHydrationRunIdRef.current) {
        return;
      }
      nextPreferences = {
        galleries: {
          gallerySearchQuery,
          gallerySortKey,
          gallerySortOrder,
          selectedGalleryId: selectedGallery?.id,
          gallerySort,
        },
      };
    }

    if (!nextPreferences) {
      return;
    }

    if (skipNextPreferenceSaveRef.current) {
      skipNextPreferenceSaveRef.current = false;
      return;
    }

    const skipBecauseAlreadySaved = areGalleryPreferencesEqual(nextPreferences, lastSavedPreferencesRef.current);
    if (skipBecauseAlreadySaved) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      persistPreferences(nextPreferences);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [preferencesHydrated, preferencesHydrationVersion, subTab, searchQuery, isSearchMode, allPage, searchPage, gallerySearchQuery, gallerySortKey, gallerySortOrder, selectedGallery?.id, gallerySort]);

  // 当图集查询或排序参数改变时，重新派生图集列表
  useEffect(() => {
    if (subTab !== 'galleries') {
      return;
    }

    console.log(`[GalleryPage] 图集派生条件变更: query=${gallerySearchQuery}, sortKey=${gallerySortKey}, sortOrder=${gallerySortOrder}`);
    setGalleries(filterAndSortGalleries(allGalleries, gallerySearchQuery, gallerySortKey, gallerySortOrder));
  }, [gallerySearchQuery, gallerySortKey, gallerySortOrder, allGalleries, subTab]);

  // 内容容器 ref，用于监听滚动
  const contentRef = useRef<HTMLDivElement>(null);

  // 最近图片：滚动到底部附近时，自动再加载 200 张（懒加载渲染）
  useEffect(() => {
    if (subTab !== 'recent') return;

    console.log('[GalleryPage] 注册滚动事件监听器（最近图片懒加载）');
    
    // 查找最近的滚动容器（父级的 Content 元素）
    const findScrollContainer = (): HTMLElement | null => {
      if (!contentRef.current) return null;
      
      let parent = contentRef.current.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    };

    const scrollContainer = findScrollContainer();
    if (!scrollContainer) {
      console.warn('[GalleryPage] 未找到滚动容器，使用 window 滚动');
      return;
    }

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

      // 距离底部 300px 以内并且还有未显示的图片时，增加可见数量
      if (scrollHeight - (scrollTop + clientHeight) < 300) {
        setRecentVisibleCount((prev) => {
          if (prev >= recentImages.length) return prev;
          const newCount = Math.min(prev + 200, recentImages.length);
          console.log(`[GalleryPage] 滚动触发懒加载，可见数量: ${newCount}/${recentImages.length}`);
          return newCount;
        });
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => {
      console.log('[GalleryPage] 移除滚动事件监听器');
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
    // 依赖于 recentImages.length，保证新数据加载后滚动逻辑仍然生效
    // 注意：不依赖 recentImages 引用本身，只依赖 .length，避免每次 setState 都重新注册事件
  }, [subTab, recentImages.length]);

  // 图集封面缩略图状态
  const [coverThumbnails, setCoverThumbnails] = useState<Record<number, string | null>>({});

  // 加载图集封面缩略图（并发加载 + 取消支持）
  useEffect(() => {
    if (!window.electronAPI || galleries.length === 0) return;

    let cancelled = false;
    console.log(`[GalleryPage] 开始加载图集封面缩略图，图集数量: ${galleries.length}`);

    const loadThumbnails = async () => {
      // 筛选需要加载缩略图的图集
      const galleriesWithCover = galleries.filter(g => g.coverImage?.filepath);
      const concurrency = 4;

      for (let i = 0; i < galleriesWithCover.length; i += concurrency) {
        if (cancelled) return;
        const batch = galleriesWithCover.slice(i, i + concurrency);

        const results = await Promise.all(batch.map(async (gallery) => {
          if (cancelled) return null;
          try {
            const result = await window.electronAPI.image.getThumbnail(gallery.coverImage.filepath);
            if (result.success && result.data) {
              return { id: gallery.id, path: result.data };
            }
          } catch (error) {
            console.error(`获取封面缩略图失败 ${gallery.id}:`, error);
          }
          return null;
        }));

        if (cancelled) return;
        // 批量更新状态，减少渲染次数
        const batchUpdate: Record<number, string | null> = {};
        for (const r of results) {
          if (r) batchUpdate[r.id] = r.path;
        }
        if (Object.keys(batchUpdate).length > 0) {
          setCoverThumbnails(prev => ({ ...prev, ...batchUpdate }));
        }
      }

      console.log(`[GalleryPage] 图集封面缩略图加载完成`);
    };

    loadThumbnails();
    return () => { cancelled = true; };
  }, [galleries]);

  // 将本地文件路径转换为 app:// 协议 URL（用于图集封面）
  const getImageUrl = (filePath: string): string => {
    if (!filePath) return '';
    if (filePath.startsWith('app://')) return filePath;
    return localPathToAppUrl(filePath);
  };


  // 根据 subTab 渲染不同内容
  const renderContent = () => {
    if (subTab === 'recent') {
      return (
        <>
          <ImageSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onSearch={handleSearchInput}
          />

          <ImageListWrapper
            images={recentImages.slice(0, recentVisibleCount)}
            loading={loading}
            emptyDescription="暂无最近图片"
            onReload={loadRecentImages}
            groupBy="day"
            showTimeline
            layout="waterfall"
          >
            <LazyLoadFooter
              current={recentVisibleCount}
              total={recentImages.length}
              onLoadMore={() =>
                setRecentVisibleCount((prev) =>
                  Math.min(prev + 200, recentImages.length)
                )
              }
            />
          </ImageListWrapper>
        </>
      );
    } else if (subTab === 'all') {
      return (
        <>
          <ImageSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onSearch={handleSearchInput}
          />

          {isSearchMode && !loading && allImages.length > 0 && (
            <div style={{ marginBottom: spacing.lg, color: colors.textSecondary }}>
              找到 {searchTotal} 张匹配的图片
            </div>
          )}
          <ImageListWrapper
            images={allImages}
            loading={loading}
            emptyDescription={isSearchMode ? `未找到匹配"${searchQuery}"的图片` : '暂无图片'}
            onReload={() => isSearchMode ? handleSearch(searchQuery, searchPage, 20) : loadImages(allPage, 20)}
            sortBy="time"
            layout="waterfall"
            groupBy="none"
          >
            <div style={{
              marginTop: spacing.xxl,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: spacing.lg,
            }}>
              <Button
                disabled={isSearchMode ? searchPage <= 1 : allPage <= 1}
                onClick={() => {
                  if (isSearchMode) {
                    const next = Math.max(1, searchPage - 1);
                    handleSearch(searchQuery, next, 20);
                  } else {
                    const next = Math.max(1, allPage - 1);
                    setAllPage(next);
                    loadImages(next, 20);
                  }
                }}
              >
                上一页
              </Button>
              <span style={{
                fontSize: fontSize.base,
                color: colors.textSecondary,
                minWidth: 80,
                textAlign: 'center',
              }}>
                第 {isSearchMode ? searchPage : allPage} 页
                {isSearchMode && searchTotal > 0 && ` / ${Math.ceil(searchTotal / 20)}`}
              </span>
              <Button
                disabled={isSearchMode ? !searchHasMore : !allHasMore}
                onClick={() => {
                  if (isSearchMode) {
                    if (!searchHasMore) return;
                    const next = searchPage + 1;
                    handleSearch(searchQuery, next, 20);
                  } else {
                    if (!allHasMore) return;
                    const next = allPage + 1;
                    setAllPage(next);
                    loadImages(next, 20);
                  }
                }}
              >
                下一页
              </Button>
            </div>
          </ImageListWrapper>
        </>
      );
    } else if (subTab === 'galleries') {
      return (
        <>
          {!selectedGallery && (
            <div style={{ marginBottom: spacing.xl, display: 'flex', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
              <Button
                type="primary"
                icon={<FolderOpenOutlined />}
                onClick={handleCreateGallery}
              >
                创建图集
              </Button>
              <Search
                placeholder="搜索图集名称..."
                allowClear
                enterButton={<SearchOutlined />}
                style={{ width: 260 }}
                value={gallerySearchQuery}
                onChange={(e) => setGallerySearchQuery(e.target.value)}
                onSearch={handleGallerySearch}
              />
              <div style={{ flex: 1 }} />
              {/* 排序控件 */}
              <Space size={spacing.sm}>
                <span style={{ fontSize: fontSize.md, color: colors.textTertiary }}>排序:</span>
                <Segmented
                  size="small"
                  value={gallerySortKey}
                  onChange={(val) => {
                    console.log(`[GalleryPage] 图集排序字段变更: ${val}`);
                    setGallerySortKey(val as 'name' | 'createdAt' | 'updatedAt');
                  }}
                  options={[
                    { label: '名字', value: 'name' },
                    { label: '创建时间', value: 'createdAt' },
                    { label: '更新时间', value: 'updatedAt' }
                  ]}
                />
                <Segmented
                  size="small"
                  value={gallerySortOrder}
                  onChange={(val) => {
                    console.log(`[GalleryPage] 图集排序顺序变更: ${val}`);
                    setGallerySortOrder(val as 'asc' | 'desc');
                  }}
                  options={[
                    { label: '升序', value: 'asc' },
                    { label: '降序', value: 'desc' }
                  ]}
                />
              </Space>
            </div>
          )}

          {selectedGallery ? (
            <>
              <div style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: zIndex.toolbar,
                  marginBottom: spacing.lg,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: colors.materialRegular,
                  backdropFilter: 'blur(20px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  padding: `${spacing.sm}px ${spacing.lg}px`,
                  borderRadius: radius.lg,
                  border: `0.5px solid ${colors.separator}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
                    <Button onClick={() => {
                      console.log('[GalleryPage] 返回图集列表');
                      galleryDetailRequestRunIdRef.current += 1;
                      setSelectedGallery(null);
                      setGalleryImages([]);
                      setDetailSourceFavoriteTags([]);
                    }}>
                      返回
                    </Button>
                    <span style={{ fontWeight: 600, fontSize: fontSize.lg, color: colors.textPrimary }}>
                      {selectedGallery.name}
                    </span>
                    <div style={{ width: 1, height: 20, background: colors.separator, margin: `0 ${spacing.xs}px` }} />
                    <Space size={spacing.sm}>
                      <span style={{ fontSize: fontSize.md, color: colors.textTertiary }}>排序:</span>
                      <Segmented
                        size="small"
                        value={gallerySort}
                        onChange={(val) => setGallerySort(val as 'time' | 'name')}
                        options={[
                          { label: '按时间', value: 'time' },
                          { label: '按文件名', value: 'name' }
                        ]}
                      />
                    </Space>
                  </div>
                  <Space>
                    <Tooltip title="刷新当前图集">
                      <Button
                        type="text"
                        icon={<ReloadOutlined />}
                        onClick={() => {
                          if (selectedGallery) {
                            loadGalleryImages(selectedGallery.id);
                          }
                        }}
                        loading={loading}
                        style={{ fontSize: 16 }}
                      />
                    </Tooltip>
                    <Tooltip title="同步文件夹">
                      <Button
                        type="text"
                        icon={<SyncOutlined />}
                        onClick={handleSyncGalleryFolder}
                        loading={syncing}
                        style={{ fontSize: 16 }}
                      />
                    </Tooltip>
                    <Popover
                      content={
                        <Descriptions bordered column={1} size="small" style={{ maxWidth: 400 }}>
                          <Descriptions.Item label="图集名称">{selectedGallery.name}</Descriptions.Item>
                          <Descriptions.Item label="文件夹路径">
                            <span 
                              style={{ color: colors.primary, cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={() => {
                                if (selectedGallery.folderPath && window.electronAPI) {
                                  window.electronAPI.system.showItem(selectedGallery.folderPath);
                                }
                              }}
                              title="点击在资源管理器中打开"
                            >
                              {selectedGallery.folderPath}
                            </span>
                          </Descriptions.Item>
                          <Descriptions.Item label="图片数量">{selectedGallery.imageCount}</Descriptions.Item>
                          {selectedGallery.lastScannedAt && (
                            <Descriptions.Item label="最后扫描">
                              {new Date(selectedGallery.lastScannedAt).toLocaleString()}
                            </Descriptions.Item>
                          )}
                          <Descriptions.Item label="创建时间">
                            {new Date(selectedGallery.createdAt).toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="更新时间">
                            {new Date(selectedGallery.updatedAt).toLocaleString()}
                          </Descriptions.Item>
                          <Descriptions.Item label="递归扫描">{selectedGallery.recursive ? '是' : '否'}</Descriptions.Item>
                          <Descriptions.Item label="监视目录">{selectedGallery.isWatching ? '是' : '否'}</Descriptions.Item>
                          {selectedGallery.extensions && selectedGallery.extensions.length > 0 && (
                            <Descriptions.Item label="支持格式">
                              {selectedGallery.extensions.join(', ')}
                            </Descriptions.Item>
                          )}
                          <Descriptions.Item label="来源收藏标签">
                            {detailSourceFavoriteTags.length > 0
                              ? detailSourceFavoriteTags.map((tag: any) => (
                                  <Tooltip key={tag.id} title={
                                    <div>
                                      <div>状态: {tag.downloadBinding?.lastStatus || '未配置'}</div>
                                      {tag.downloadBinding?.lastCompletedAt && (
                                        <div>上次下载: {new Date(tag.downloadBinding.lastCompletedAt).toLocaleString()}</div>
                                      )}
                                    </div>
                                  }>
                                    <Tag
                                      color={tag.downloadBinding?.lastStatus === 'completed' ? 'success' : tag.downloadBinding?.lastStatus === 'failed' ? 'error' : 'blue'}
                                    >
                                      {tag.tagName}
                                    </Tag>
                                  </Tooltip>
                                ))
                              : '-'}
                          </Descriptions.Item>
                        </Descriptions>
                      }
                      title="图集详细信息"
                      trigger="click"
                      placement="bottomRight"
                    >
                      <Button
                        type="text"
                        icon={<QuestionCircleOutlined />}
                        style={{ fontSize: 16 }}
                      />
                    </Popover>
                  </Space>
                </div>
              <ImageListWrapper
                images={galleryImages.slice(0, galleryVisibleCount)}
                loading={loading}
                emptyDescription="该图集暂无图片"
                onReload={() => loadGalleryImages(selectedGallery.id)}
                groupBy={gallerySort === 'time' ? 'day' : 'none'}
                sortBy={gallerySort}
                layout="waterfall"
                onSetCover={handleSetCover}
                currentGallery={selectedGallery}
              >
                <LazyLoadFooter
                  current={galleryVisibleCount}
                  total={galleryImages.length}
                  onLoadMore={() =>
                    setGalleryVisibleCount((prev) =>
                      Math.min(prev + 200, galleryImages.length)
                    )
                  }
                />
              </ImageListWrapper>
            </>
          ) : loading ? (
            <SkeletonGrid count={8} cardWidth={250} gap={16} />
          ) : galleries.length === 0 ? (
            <Empty
              description={gallerySearchQuery ? '未找到匹配的图集' : '暂无图集'}
              style={{ marginTop: '100px' }}
            >
              <Button type="primary" onClick={handleCreateGallery}>
                创建图集
              </Button>
            </Empty>
          ) : (
            <Row gutter={[16, 16]} className="gallery-grid">
              {galleries.map((gallery: any) => (
                <Col 
                  key={gallery.id} 
                  xs={24} 
                  sm={12} 
                  md={8} 
                  lg={8} 
                  xl={4}
                  className="gallery-col"
                >
                  <Dropdown
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'edit', label: '编辑', icon: <EditOutlined /> },
                        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'edit') handleOpenEditGallery(gallery);
                        if (key === 'delete') handleDeleteGallery(gallery);
                      },
                    }}
                  >
                    <div
                      style={{
                        cursor: 'pointer',
                        background: 'transparent'
                      }}
                      onClick={() => {
                        console.log(`[GalleryPage] 点击图集: ${gallery.name} (ID: ${gallery.id})`);
                        setSelectedGallery(gallery);
                        loadGalleryImages(gallery.id);
                      }}
                    >
                      {/* 图片区域 - 使用独立的封面组件 */}
                      <GalleryCoverImage
                        coverImage={gallery.coverImage}
                        thumbnailPath={coverThumbnails[gallery.id] || null}
                        getImageUrl={getImageUrl}
                        onInfoClick={async () => {
                        const requestRunId = galleryInfoRequestRunIdRef.current + 1;
                        galleryInfoRequestRunIdRef.current = requestRunId;
                        const isLatestRequest = () => galleryInfoRequestRunIdRef.current === requestRunId;

                        console.log(`[GalleryPage] 查看图集详情: ${gallery.name}`);
                        setSelectedGalleryInfo(gallery);
                        setModalSourceFavoriteTags([]);
                        try {
                          const sourceResult = await window.electronAPI.booru.getGallerySourceFavoriteTags(gallery.id);
                          if (!isLatestRequest()) {
                            return;
                          }
                          if (sourceResult.success && sourceResult.data) {
                            setModalSourceFavoriteTags(sourceResult.data);
                          } else {
                            setModalSourceFavoriteTags([]);
                          }
                        } catch (error) {
                          if (!isLatestRequest()) {
                            return;
                          }
                          console.error('[GalleryPage] 加载图集来源收藏标签失败:', error);
                          setModalSourceFavoriteTags([]);
                        }
                      }}
                      />
                      {/* 文字区域 */}
                      <div
                        style={{
                          fontSize: gallery.name.length > 20 ? fontSize.sm : fontSize.md,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 500,
                          lineHeight: '1.2',
                          textAlign: 'center',
                          padding: `0 ${spacing.xs}px`,
                          background: 'transparent'
                        }}
                        title={gallery.name}
                      >
                        {gallery.name}
                      </div>
                    </div>
                  </Dropdown>
                </Col>
              ))}
            </Row>
          )}
        </>
      );
    }
    return null;
  };

  return (
    <div ref={contentRef} style={{ padding: spacing.xl }}>
      {renderContent()}
      
      {/* 图集信息模态框 */}
      {selectedGalleryInfo && (
        <Modal
          open
          title="图集信息"
          closable
          maskClosable
          keyboard
          footer={
            <Button onClick={() => { console.log('[GalleryPage] 关闭图集信息模态框'); galleryInfoRequestRunIdRef.current += 1; setSelectedGalleryInfo(null); setModalSourceFavoriteTags([]); }}>
              关闭
            </Button>
          }
          onCancel={() => {
            console.log('[GalleryPage] 关闭图集信息模态框');
            galleryInfoRequestRunIdRef.current += 1;
            setSelectedGalleryInfo(null);
            setModalSourceFavoriteTags([]);
          }}
          width={600}
        >
          <Descriptions bordered column={1}>
            <Descriptions.Item label="图集名称">{selectedGalleryInfo.name}</Descriptions.Item>
            <Descriptions.Item label="文件夹路径">
              <span
                style={{ color: colors.primary, cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => {
                  if (selectedGalleryInfo.folderPath && window.electronAPI) {
                    window.electronAPI.system.showItem(selectedGalleryInfo.folderPath);
                  }
                }}
                title="点击在资源管理器中打开"
              >
                {selectedGalleryInfo.folderPath}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="图片数量">{selectedGalleryInfo.imageCount}</Descriptions.Item>
            {selectedGalleryInfo.lastScannedAt && (
              <Descriptions.Item label="最后扫描">
                {new Date(selectedGalleryInfo.lastScannedAt).toLocaleString()}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="创建时间">
              {new Date(selectedGalleryInfo.createdAt).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(selectedGalleryInfo.updatedAt).toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="递归扫描">{selectedGalleryInfo.recursive ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="监视目录">{selectedGalleryInfo.isWatching ? '是' : '否'}</Descriptions.Item>
            {selectedGalleryInfo.extensions && selectedGalleryInfo.extensions.length > 0 && (
              <Descriptions.Item label="支持格式">
                {selectedGalleryInfo.extensions.join(', ')}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="来源收藏标签">
              {modalSourceFavoriteTags.length > 0
                ? modalSourceFavoriteTags.map((tag: any) => (
                    <Tooltip key={tag.id} title={
                      <div>
                        <div>状态: {tag.downloadBinding?.lastStatus || '未配置'}</div>
                        {tag.downloadBinding?.lastCompletedAt && (
                          <div>上次下载: {new Date(tag.downloadBinding.lastCompletedAt).toLocaleString()}</div>
                        )}
                      </div>
                    }>
                      <Tag
                        color={tag.downloadBinding?.lastStatus === 'completed' ? 'success' : tag.downloadBinding?.lastStatus === 'failed' ? 'error' : 'blue'}
                      >
                        {tag.tagName}
                      </Tag>
                    </Tooltip>
                  ))
                : '-'}
            </Descriptions.Item>
          </Descriptions>
        </Modal>
      )}

      {/* 编辑图集模态框 */}
      <Modal
        open={editModalOpen}
        title="编辑图集"
        closable
        maskClosable
        keyboard
        onCancel={() => { setEditModalOpen(false); setEditingGallery(null); }}
        onOk={handleSaveGalleryEdit}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="图集名称" rules={[{ required: true, message: '请输入图集名称' }]}>
            <Input placeholder="请输入图集名称" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
