import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Table,
  Modal,
  Form,
  Input,
  Switch,
  Space,
  message as antdMessage,
  Tabs,
  Select,
  InputNumber,
  Divider,
  Tag,
  Popconfirm,
  App,
  Slider,
  Typography,
  Alert
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CloudOutlined, ApiOutlined, BgColorsOutlined, FileTextOutlined, InfoCircleOutlined, UserOutlined, LockOutlined, LoginOutlined, LogoutOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';

const { Option } = Select;
const { Text, Paragraph } = Typography;

const BOORU_APPEARANCE_FIELDS = [
  'gridSize',
  'previewQuality',
  'itemsPerPage',
  'paginationPosition',
  'spacing',
  'borderRadius',
  'margin',
  'maxCacheSizeMB'
] as const;

type BooruAppearanceField = (typeof BOORU_APPEARANCE_FIELDS)[number];
type BooruAppearanceConfig = Partial<Record<BooruAppearanceField, unknown>>;

const sanitizeAppearanceConfig = (appearance: unknown): BooruAppearanceConfig => {
  if (!appearance || typeof appearance !== 'object') {
    return {};
  }

  return BOORU_APPEARANCE_FIELDS.reduce<BooruAppearanceConfig>((sanitized, field) => {
    if (Object.prototype.hasOwnProperty.call(appearance, field)) {
      sanitized[field] = (appearance as Record<string, unknown>)[field];
    }
    return sanitized;
  }, {});
};

// 缓存统计信息显示组件
const CacheStatsDisplay: React.FC = () => {
  const [stats, setStats] = useState<{ sizeMB: number; fileCount: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.booru?.getCacheStats) {
        const result = await window.electronAPI.booru.getCacheStats();
        if (result.success && result.data) {
          setStats(result.data);
        }
      }
    } catch (error) {
      console.error('[CacheStatsDisplay] 加载缓存统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadStats();
    // 每 5 秒刷新一次（页面不可见时暂停轮询）
    let interval: NodeJS.Timeout | null = setInterval(loadStats, 5000);
    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        if (!interval) { loadStats(); interval = setInterval(loadStats, 5000); }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (!stats) {
    return null;
  }

  return (
    <Form.Item label="当前缓存状态">
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Text>缓存大小: </Text>
          <Text strong>{stats.sizeMB.toFixed(2)} MB</Text>
        </div>
        <div>
          <Text>缓存文件数: </Text>
          <Text strong>{stats.fileCount}</Text>
        </div>
        <Button size="small" onClick={loadStats} loading={loading}>
          刷新统计
        </Button>
      </Space>
    </Form.Item>
  );
};

interface BooruSettingsPageProps {}

// 支持的token列表
const SUPPORTED_TOKENS = [
  { token: '{id}', desc: '图片ID' },
  { token: '{md5}', desc: 'MD5哈希' },
  { token: '{extension}', desc: '文件扩展名' },
  { token: '{width}', desc: '图片宽度' },
  { token: '{height}', desc: '图片高度' },
  { token: '{rating}', desc: '分级(safe/questionable/explicit)' },
  { token: '{score}', desc: '评分' },
  { token: '{site}', desc: '站点名称' },
  { token: '{artist}', desc: '艺术家标签' },
  { token: '{character}', desc: '角色标签' },
  { token: '{copyright}', desc: '版权标签' },
  { token: '{date}', desc: '日期' },
  { token: '{tags}', desc: '所有标签' },
  { token: '{source}', desc: '来源URL' }
];

export const BooruSettingsPage: React.FC<BooruSettingsPageProps> = () => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSite, setEditingSite] = useState<BooruSite | null>(null);
  const [form] = Form.useForm();
  const [appearanceForm] = Form.useForm();
  const [filenameForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState('sites');
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [savingFilename, setSavingFilename] = useState(false);
  const [filenamePreview, setFilenamePreview] = useState('');

  // 加载站点列表
  const loadSites = async () => {
    console.log('[BooruSettingsPage] 加载Booru站点列表');
    setLoading(true);
    try {
      if (!window.electronAPI) {
        console.error('[BooruSettingsPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booru.getSites();
      if (result.success) {
        const siteList = result.data || [];
        console.log('[BooruSettingsPage] 站点列表加载成功:', siteList.length, '个站点');
        setSites(siteList);
      } else {
        console.error('[BooruSettingsPage] 加载站点列表失败:', result.error);
        message.error('加载站点列表失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 加载站点列表失败:', error);
      message.error('加载站点列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruSettingsPage] 加载外观配置');
    try {
      if (!window.electronAPI?.booruPreferences?.appearance) {
        console.error('[BooruSettingsPage] appearance API is not available');
        return;
      }

      const result = await window.electronAPI.booruPreferences.appearance.get();
      if (result.success && result.data) {
        const sanitizedAppearance = sanitizeAppearanceConfig(result.data);
        console.log('[BooruSettingsPage] 外观配置加载成功:', sanitizedAppearance);
        appearanceForm.setFieldsValue(sanitizedAppearance);
      } else {
        console.error('[BooruSettingsPage] 加载外观配置失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 加载外观配置失败:', error);
    }
  };

  // 加载文件名模板配置
  const loadFilenameConfig = async () => {
    console.log('[BooruSettingsPage] 加载文件名模板配置');
    try {
      if (!window.electronAPI) {
        console.error('[BooruSettingsPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        const downloadConfig = config.booru?.download || {
          filenameTemplate: '{site}_{id}_{md5}.{extension}',
          tokenDefaults: {
            tags: { limit: 10, maxlength: 50, case: 'lower', delimiter: '_', unsafe: false },
            artist: { limit: 5, maxlength: 30, case: 'lower', delimiter: '_', unsafe: false },
            character: { limit: 5, maxlength: 30, case: 'lower', delimiter: '_', unsafe: false },
            copyright: { limit: 3, maxlength: 30, case: 'lower', delimiter: '_', unsafe: false },
            date: { format: 'yyyy-MM-dd' },
            rating: { case: 'lower', single_letter: false },
            site: { case: 'lower' },
            id: { pad_left: 0 },
            md5: { maxlength: 32 },
            width: { unsafe: true },
            height: { unsafe: true }
          }
        };

        console.log('[BooruSettingsPage] 文件名模板配置加载成功:', downloadConfig);
        filenameForm.setFieldsValue(downloadConfig);
        updateFilenamePreview(downloadConfig.filenameTemplate || '{site}_{id}_{md5}.{extension}');
      } else {
        console.error('[BooruSettingsPage] 加载文件名模板配置失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 加载文件名模板配置失败:', error);
    }
  };

  // 更新文件名预览（使用与后端相同的解析逻辑）
  const updateFilenamePreview = (template: string) => {
    // 模拟完整的元数据
    const metadata: any = {
      id: '123456',
      md5: 'abc123def4567890123456789012345',
      extension: 'jpg',
      width: 1920,
      height: 1080,
      rating: 'safe',
      score: 85,
      site: 'yande.re',
      artist: 'artist_name another_artist',
      character: 'character_name another_character',
      copyright: 'original',
      date: '2025-11-20',
      tags: 'tag1 tag2 tag3 tag4 tag5 tag6 tag7 tag8 tag9 tag10',
      source: 'https://example.com/source.jpg'
    };

    // 使用正则表达式查找所有token（包括带选项的）
    const regex = /\{[^}]+\}/g;
    let preview = template;
    let match;

    while ((match = regex.exec(template)) !== null) {
      const tokenStr = match[0];

      // 解析token（处理带选项的情况）
      const matchResult = tokenStr.match(/^\{([^:]+)(?::([^}]+))?\}$/);
      if (!matchResult) {
        // 无法解析，直接替换为空
        preview = preview.replace(tokenStr, '');
        continue;
      }

      const tokenName = matchResult[1];
      const optionStr = matchResult[2];

      // 解析选项
      const options: any = {};
      if (optionStr) {
        const pairs = optionStr.split(',');
        for (const pair of pairs) {
          const [key, value] = pair.split('=');
          if (key && value !== undefined) {
            const cleanValue = value.trim();

            if (key.trim() === 'limit' || key.trim() === 'maxlength' || key.trim() === 'pad_left') {
              options[key.trim()] = parseInt(cleanValue, 10);
            } else if (key.trim() === 'single_letter' || key.trim() === 'unsafe') {
              options[key.trim()] = cleanValue === 'true';
            } else {
              options[key.trim()] = cleanValue;
            }
          }
        }
      }

      // 获取值
      const value = metadata[tokenName];
      if (value === undefined || value === null || value === '') {
        preview = preview.replace(tokenStr, '');
        continue;
      }

      // 处理值（应用选项）
      let processedValue = String(value);

      // 1. 应用大小写转换
      if (options.case) {
        switch (options.case) {
          case 'lower':
            processedValue = processedValue.toLowerCase();
            break;
          case 'upper':
            processedValue = processedValue.toUpperCase();
            break;
        }
      }

      // 2. 处理标签列表（tags, artist, character, copyright）
      let items: string[] = [processedValue];
      if (['tags', 'artist', 'character', 'copyright'].includes(tokenName)) {
        items = processedValue.split(/\s+/).filter(item => item.trim() !== '');

        // 限制数量
        if (options.limit && options.limit > 0) {
          items = items.slice(0, options.limit);
        }
      }

      // 重新组合
      if (items.length > 1) {
        const delimiter = options.delimiter || '_';
        processedValue = items.join(delimiter);
      } else {
        processedValue = items[0] || '';
      }

      // 3. 限制最大长度
      if (options.maxlength && processedValue.length > options.maxlength) {
        processedValue = processedValue.substring(0, options.maxlength);
      }

      // 4. MD5最大长度限制
      if (options.maxlength && tokenName === 'md5' && processedValue.length > 32) {
        processedValue = processedValue.substring(0, 32);
      }

      // 5. 评分单个字母（s/q/e）
      if (options.single_letter && tokenName === 'rating') {
        processedValue = processedValue.charAt(0).toLowerCase();
      }

      // 6. ID左侧填充0
      if (options.pad_left && tokenName === 'id' && !isNaN(Number(processedValue))) {
        processedValue = processedValue.padStart(options.pad_left, '0');
      }

      // 7. 日期格式化
      if (options.format && tokenName === 'date' && processedValue) {
        try {
          const date = new Date(processedValue);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            processedValue = options.format
              .replace(/yyyy/g, String(year))
              .replace(/MM/g, month)
              .replace(/dd/g, day);
          }
        } catch (e) {
          // 保持原样
        }
      }

      preview = preview.replace(tokenStr, processedValue);
    }

    // 清理未替换的token（不应该有）
    preview = preview.replace(/\{[^}]+\}/g, '');

    // 清理文件名中的非法字符
    preview = preview.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();

    setFilenamePreview(preview);
  };

  // 打开添加站点模态框
  const handleAddSite = () => {
    console.log('[BooruSettingsPage] 打开添加站点对话框');
    setEditingSite(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'moebooru',
      favoriteSupport: true,
      active: true
    });
    setModalVisible(true);
  };

  // 打开编辑站点模态框
  const handleEditSite = (site: BooruSite) => {
    console.log('[BooruSettingsPage] 打开编辑站点对话框:', site.name);
    setEditingSite(site);
    form.setFieldsValue({
      ...site,
      salt: undefined,
      apiKey: undefined,
    });
    setModalVisible(true);
  };

  // 删除站点
  const handleDeleteSite = async (site: BooruSite) => {
    console.log('[BooruSettingsPage] 删除站点:', site.name);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.deleteSite(site.id);
      if (result.success) {
        console.log('[BooruSettingsPage] 删除站点成功:', site.name);
        message.success('删除站点成功');
        loadSites();
      } else {
        console.error('[BooruSettingsPage] 删除站点失败:', result.error);
        message.error('删除站点失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 删除站点失败:', error);
      message.error('删除站点失败');
    }
  };

  // 设置激活站点
  const handleSetActive = async (site: BooruSite) => {
    console.log('[BooruSettingsPage] 设置激活站点:', site.name);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.updateSite(site.id, { active: true });
      if (result.success) {
        // 将所有其他站点设置为非激活
        for (const s of sites) {
          if (s.id !== site.id && s.active) {
            await window.electronAPI!.booru.updateSite(s.id, { active: false });
          }
        }
        console.log('[BooruSettingsPage] 设置激活站点成功:', site.name);
        message.success(`已设置 ${site.name} 为默认站点`);
        loadSites();
      } else {
        console.error('[BooruSettingsPage] 设置激活站点失败:', result.error);
        message.error('设置激活站点失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 设置激活站点失败:', error);
      message.error('设置激活站点失败');
    }
  };

  // 提交站点表单
  const handleSubmit = async (values: any) => {
    const payload = { ...values };
    // 确保URL有协议（自动添加 https://）
    if (payload.url && !payload.url.startsWith('http://') && !payload.url.startsWith('https://')) {
      payload.url = 'https://' + payload.url;
      console.log('[BooruSettingsPage] 自动添加协议到URL:', payload.url);
    }

    if (editingSite) {
      if (!payload.salt) {
        delete payload.salt;
      }
      if (!payload.apiKey) {
        delete payload.apiKey;
      }
    }

    try {
      if (!window.electronAPI) return;

      if (editingSite) {
        // 编辑
        const result = await window.electronAPI.booru.updateSite(editingSite.id, payload);
        if (result.success) {
          console.log('[BooruSettingsPage] 更新站点成功:', editingSite.name);
          message.success('更新站点成功');
          setModalVisible(false);
          loadSites();
        } else {
          console.error('[BooruSettingsPage] 更新站点失败:', result.error);
          message.error('更新站点失败: ' + result.error);
        }
      } else {
        // 新增
        const result = await window.electronAPI.booru.addSite(payload);
        if (result.success) {
          console.log('[BooruSettingsPage] 添加站点成功:', values.name);
          message.success('添加站点成功');
          setModalVisible(false);
          loadSites();
        } else {
          console.error('[BooruSettingsPage] 添加站点失败:', result.error);
          message.error('添加站点失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 提交表单失败:', error);
      message.error('操作失败');
    }
  };

  // 保存外观配置
  const handleSaveAppearance = async (values: any) => {
    const sanitizedAppearance = sanitizeAppearanceConfig(values);
    console.log('[BooruSettingsPage] 保存外观配置:', sanitizedAppearance);
    setSavingAppearance(true);
    try {
      if (!window.electronAPI) {
        console.error('[BooruSettingsPage] electronAPI is not available');
        message.error('系统功能不可用');
        return;
      }

      // 加载当前配置
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) {
        console.error('[BooruSettingsPage] 获取配置失败:', configResult.error);
        message.error('获取配置失败');
        return;
      }

      // 更新配置
      const updatedConfig = {
        ...configResult.data,
        booru: {
          ...(configResult.data.booru || {}),
          appearance: sanitizedAppearance
        }
      };

      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) {
        console.log('[BooruSettingsPage] 外观配置保存成功');
        message.success('外观配置已保存，将在2秒内自动应用');
        // 触发配置重新加载（通过重新读取配置）
        setTimeout(() => {
          loadAppearanceConfig();
        }, 500);
      } else {
        console.error('[BooruSettingsPage] 外观配置保存失败:', result.error);
        message.error(result.error || '保存失败');
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 保存外观配置失败:', error);
      message.error('保存失败');
    } finally {
      setSavingAppearance(false);
    }
  };

  // 保存文件名模板配置
  const handleSaveFilename = async (values: any) => {
    console.log('[BooruSettingsPage] 保存文件名模板配置:', values);
    setSavingFilename(true);
    try {
      if (!window.electronAPI) {
        console.error('[BooruSettingsPage] electronAPI is not available');
        message.error('系统功能不可用');
        return;
      }

      // 加载当前配置
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) {
        console.error('[BooruSettingsPage] 获取配置失败:', configResult.error);
        message.error('获取配置失败');
        return;
      }

      // 更新配置
      const updatedConfig = {
        ...configResult.data,
        booru: {
          ...(configResult.data.booru || {}),
          download: values
        }
      };

      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) {
        console.log('[BooruSettingsPage] 文件名模板配置保存成功');
        message.success('文件名模板配置已保存');
        // 保存后更新预览
        updateFilenamePreview(values.filenameTemplate);
      } else {
        console.error('[BooruSettingsPage] 文件名模板配置保存失败:', result.error);
        message.error(result.error || '保存失败');
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 保存文件名模板配置失败:', error);
      message.error('保存失败');
    } finally {
      setSavingFilename(false);
    }
  };

  // 测试连接
  const handleTestConnection = async (site: BooruSite) => {
    console.log('[BooruSettingsPage] 测试站点连接:', site.name);
    message.info('正在测试连接...');

    try {
      if (!window.electronAPI) return;

      // 简单测试：尝试获取第一页图片
      const result = await window.electronAPI.booru.getPosts(site.id, 1);
      if (result.success) {
        console.log('[BooruSettingsPage] 连接测试成功:', site.name);
        message.success('连接成功！');
      } else {
        console.error('[BooruSettingsPage] 连接测试失败:', result.error);
        message.error('连接失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 连接测试失败:', error);
      message.error('连接失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // ===== 登录功能 =====
  const [loginModalVisible, setLoginModalVisible] = useState(false);
  const [loginSite, setLoginSite] = useState<BooruSite | null>(null);
  const [loginForm] = Form.useForm();
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // 打开登录弹窗
  const handleOpenLogin = (site: BooruSite) => {
    setLoginSite(site);
    setLoginError(null);
    loginForm.resetFields();
    setLoginModalVisible(true);
  };

  // 执行登录
  const handleLogin = async (values: { username: string; password: string }) => {
    if (!loginSite) return;

    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await window.electronAPI.booru.login(loginSite.id, values.username, values.password);
      if (result.success) {
        message.success(`登录成功: ${values.username}`);
        setLoginModalVisible(false);
        setLoginError(null);
        loadSites();
      } else {
        const errorMsg = result.error || '登录失败，请检查用户名和密码';
        setLoginError(errorMsg);
        console.error('[BooruSettingsPage] 登录失败:', errorMsg);
      }
    } catch (error) {
      const errorMsg = '登录失败: ' + (error instanceof Error ? error.message : String(error));
      setLoginError(errorMsg);
      console.error('[BooruSettingsPage] 登录失败:', error);
    } finally {
      setLoginLoading(false);
    }
  };

  // 登出
  const handleLogout = async (site: BooruSite) => {
    try {
      const result = await window.electronAPI.booru.logout(site.id);
      if (result.success) {
        message.success('已登出');
        loadSites();
      } else {
        message.error('登出失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 登出失败:', error);
      message.error('登出失败');
    }
  };

  // 站点表格列
  const columns = [
    {
      title: '站点名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: BooruSite) => (
        <Space>
          <span>{text}</span>
          {record.active && <Tag color="green">默认</Tag>}
        </Space>
      )
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag>{type}</Tag>
      )
    },
    {
      title: '认证',
      key: 'auth',
      width: 120,
      render: (_: any, record: BooruSite) => (
        record.authenticated && record.username ? (
          <Tag icon={<CheckCircleOutlined />} color="success">{record.username}</Tag>
        ) : (
          <Tag color="default">未登录</Tag>
        )
      )
    },
    {
      title: '收藏',
      dataIndex: 'favoriteSupport',
      key: 'favoriteSupport',
      render: (support: boolean) => (
        <span>{support ? '✅' : '❌'}</span>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: BooruSite) => (
        <Space size="small">
          {!record.active && (
            <Button
              size="small"
              type="link"
              onClick={() => handleSetActive(record)}
            >
              设为默认
            </Button>
          )}
          {record.authenticated ? (
            <Button
              size="small"
              icon={<LogoutOutlined />}
              onClick={() => handleLogout(record)}
            >
              登出
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<LoginOutlined />}
              onClick={() => handleOpenLogin(record)}
            >
              登录
            </Button>
          )}
          <Button
            size="small"
            icon={<ApiOutlined />}
            onClick={() => handleTestConnection(record)}
          >
            测试
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditSite(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个站点吗？"
            onConfirm={() => handleDeleteSite(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  // 初始化
  useEffect(() => {
    console.log('[BooruSettingsPage] 初始化页面');
    loadSites();
    loadAppearanceConfig();
    loadFilenameConfig();
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'sites',
            label: (
              <span>
                <CloudOutlined />
                站点配置
              </span>
            ),
            children: (
              <Card
                title={
                  <Space>
                    <CloudOutlined />
                    Booru站点配置
                  </Space>
                }
                extra={
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleAddSite}
                  >
                    添加站点
                  </Button>
                }
              >
                <Table
                  columns={columns}
                  dataSource={sites}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              </Card>
            )
          },
          {
            key: 'appearance',
            label: (
              <span>
                <BgColorsOutlined />
                外观配置
              </span>
            ),
            children: (
              <Card
                title={
                  <Space>
                    <BgColorsOutlined />
                    外观配置
                  </Space>
                }
              >
                <Form
                  form={appearanceForm}
                  layout="vertical"
                  onFinish={handleSaveAppearance}
                  initialValues={{
                    gridSize: 220,
                    previewQuality: 'auto',
                    itemsPerPage: 20,
                    paginationPosition: 'bottom',
                    spacing: 16,
                    borderRadius: 8,
                    margin: 24,
                    maxCacheSizeMB: 500
                  }}
                >
                  <Form.Item
                    label="图片网格大小"
                    name="gridSize"
                    tooltip="图片卡片的宽度（像素），建议 180-300"
                  >
                    <Slider
                      min={150}
                      max={400}
                      step={10}
                      marks={{
                        150: '150px',
                        220: '220px',
                        300: '300px',
                        400: '400px'
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    label="预览图质量"
                    name="previewQuality"
                    tooltip="加载的预览图质量，自动模式会根据网络情况自动选择"
                  >
                    <Select>
                      <Option value="auto">自动</Option>
                      <Option value="low">低</Option>
                      <Option value="medium">中</Option>
                      <Option value="high">高</Option>
                      <Option value="original">最高</Option>
                    </Select>
                  </Form.Item>

                  <Form.Item
                    label="每页数量"
                    name="itemsPerPage"
                    tooltip="每页显示的图片数量"
                  >
                    <InputNumber
                      min={10}
                      max={100}
                      step={5}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>

                  <Form.Item
                    label="页码位置"
                    name="paginationPosition"
                    tooltip="分页控件显示的位置"
                  >
                    <Select>
                      <Option value="top">顶部</Option>
                      <Option value="bottom">底部</Option>
                      <Option value="both">两者</Option>
                    </Select>
                  </Form.Item>

                  <Divider orientation="left">样式设置</Divider>

                  <Form.Item
                    label="间距"
                    name="spacing"
                    tooltip="图片卡片之间的间距（像素）"
                  >
                    <Slider
                      min={0}
                      max={40}
                      step={2}
                      marks={{
                        0: '0px',
                        16: '16px',
                        24: '24px',
                        40: '40px'
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    label="圆角"
                    name="borderRadius"
                    tooltip="图片卡片的圆角大小（像素）"
                  >
                    <Slider
                      min={0}
                      max={20}
                      step={2}
                      marks={{
                        0: '0px',
                        8: '8px',
                        12: '12px',
                        20: '20px'
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    label="边距"
                    name="margin"
                    tooltip="页面内容区域的边距（像素）"
                  >
                    <Slider
                      min={0}
                      max={60}
                      step={4}
                      marks={{
                        0: '0px',
                        24: '24px',
                        40: '40px',
                        60: '60px'
                      }}
                    />
                  </Form.Item>

                  <Divider orientation="left">缓存设置</Divider>

                  <Form.Item
                    label="缓存目录最大大小"
                    tooltip="原图缓存目录的最大大小（MB），超过此大小会自动清理最旧的一半缓存文件"
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item
                        name="maxCacheSizeMB"
                        noStyle
                        rules={[
                          { type: 'integer', min: 100, message: '缓存上限不能小于 100 MB' },
                        ]}
                      >
                        <InputNumber
                          min={100}
                          step={100}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Button disabled style={{ cursor: 'default' }}>MB</Button>
                    </Space.Compact>
                  </Form.Item>

                  <CacheStatsDisplay />

                  <Form.Item>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={savingAppearance}>
                        保存外观配置
                      </Button>
                      <Button onClick={() => {
                        appearanceForm.resetFields();
                        loadAppearanceConfig();
                      }}>
                        重置
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              </Card>
            )
          },
          {
            key: 'filename',
            label: (
              <span>
                <FileTextOutlined />
                文件配置
              </span>
            ),
            children: (
              <Card
                title={
                  <Space>
                    <FileTextOutlined />
                    下载文件名模板配置
                  </Space>
                }
              >
                <Alert
                  message="提示"
                  description="配置下载文件时的文件名格式，支持丰富的模板变量"
                  type="info"
                  showIcon
                  style={{ marginBottom: 24 }}
                />

                <Form
                  form={filenameForm}
                  layout="vertical"
                  onFinish={handleSaveFilename}
                  initialValues={{
                    filenameTemplate: '{site}_{id}_{md5}.{extension}'
                  }}
                >
                  <Form.Item
                    label="文件名模板"
                    name="filenameTemplate"
                    rules={[{ required: true, message: '请输入文件名模板' }]}
                    tooltip="使用 {token} 格式插入变量，支持 token选项 如 {tags:limit=10}"
                  >
                    <Input
                      placeholder="{site}_{id}_{md5}.{extension}"
                      onChange={(e) => updateFilenamePreview(e.target.value)}
                    />
                  </Form.Item>

                  <Form.Item label="实时预览" style={{ marginBottom: 8 }}>
                    <Alert
                      message={<Text code>{filenamePreview || '请输入模板查看预览'}</Text>}
                      type="success"
                      style={{ marginTop: 8 }}
                    />
                  </Form.Item>

                  <Divider orientation="left" style={{ marginTop: 32 }}>支持的模板变量</Divider>

                  <Paragraph type="secondary">
                    点击变量可以快速插入到模板中：
                  </Paragraph>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '8px', marginTop: 16 }}>
                    {SUPPORTED_TOKENS.map(({ token, desc }) => (
                      <Button
                        key={token}
                        size="small"
                        style={{ textAlign: 'left', height: 'auto', padding: '8px' }}
                        onClick={() => {
                          const currentTemplate = filenameForm.getFieldValue('filenameTemplate') || '';
                          const newTemplate = currentTemplate + token;
                          filenameForm.setFieldsValue({ filenameTemplate: newTemplate });
                          updateFilenamePreview(newTemplate);
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <Text strong style={{ fontFamily: 'monospace' }}>{token}</Text>
                          <Text type="secondary" style={{ fontSize: '12px' }}>{desc}</Text>
                        </div>
                      </Button>
                    ))}
                  </div>

                  <Divider orientation="left" style={{ marginTop: 32 }}>使用示例</Divider>

                  <div style={{ background: 'var(--ant-color-bg-layout, #F2F2F7)', padding: 16, borderRadius: 14, fontFamily: 'monospace', fontSize: '13px' }}>
                    <Paragraph>
                      <Text strong>简单：</Text> <Text code>{`{id}_{md5}.{extension}`}</Text> → 123456_abc123.jpg
                    </Paragraph>
                    <Paragraph>
                      <Text strong>带标签：</Text> <Text code>{`{site}_{id}_{tags:limit=5}.{extension}`}</Text> → yande.re_123456_tag1_tag2_tag3_tag4_tag5.jpg
                    </Paragraph>
                    <Paragraph>
                      <Text strong>带艺术家：</Text> <Text code>{`{artist}_{id}.{extension}`}</Text> → artist_name_123456.jpg
                    </Paragraph>
                    <Paragraph>
                      <Text strong>带日期：</Text> <Text code>{`{date}_{id}.{extension}`}</Text> → 2025-11-20_123456.jpg
                    </Paragraph>
                  </div>

                  <Divider orientation="left" style={{ marginTop: 32 }}>Token选项</Divider>

                  <Alert
                    message="高级用法"
                    description={
                      <div>
                        <Paragraph style={{ marginBottom: 8 }}>支持的选项（在token后使用冒号分隔）：</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>limit</Text> - 限制标签数量 {'(如: {tags:limit=10})'}</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>maxlength</Text> - 限制最大长度</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>case</Text> - 大小写转换 (lower/upper/none)</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>delimiter</Text> - 分隔符 (默认: _)</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>single_letter</Text> - 评分单个字母 (true/false)</Paragraph>
                        <Paragraph style={{ marginLeft: 16, marginBottom: 4 }}><Text code>format</Text> - 日期格式 (如: yyyy-MM-dd)</Paragraph>
                      </div>
                    }
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                  />

                  <Form.Item style={{ marginTop: 24 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={savingFilename}>
                        保存文件配置
                      </Button>
                      <Button onClick={() => {
                        filenameForm.resetFields();
                        loadFilenameConfig();
                      }}>
                        重置
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              </Card>
            )
          }
        ]}
      />

      {/* 登录弹窗 */}
      <Modal
        title={`登录 ${loginSite?.name || ''}`}
        open={loginModalVisible}
        onCancel={() => setLoginModalVisible(false)}
        footer={null}
        width={400}
        forceRender
      >
        <Alert
          message="登录后可以使用喜欢、投票和评论功能"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        {loginError && (
          <Alert
            message="登录失败"
            description={loginError}
            type="error"
            showIcon
            closable
            onClose={() => setLoginError(null)}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={loginForm}
          layout="vertical"
          onFinish={handleLogin}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="你的 Yande.re 用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loginLoading} icon={<LoginOutlined />}>
                登录
              </Button>
              <Button onClick={() => setLoginModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加/编辑站点模态框 */}
      <Modal
        title={editingSite ? '编辑站点' : '添加站点'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            type: 'moebooru',
            favoriteSupport: true,
            active: false
          }}
        >
          <Form.Item
            name="name"
            label="站点名称"
            rules={[{ required: true, message: '请输入站点名称' }]}
          >
            <Input placeholder="例如: Yande.re" />
          </Form.Item>

          <Form.Item
            name="url"
            label="站点URL"
            rules={[
              { required: true, message: '请输入站点URL' },
              { type: 'url', message: '请输入有效的URL' }
            ]}
          >
            <Input placeholder="例如: https://yande.re" />
          </Form.Item>

          <Form.Item
            name="type"
            label="站点类型"
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="moebooru">Moebooru</Option>
              <Option value="danbooru">Danbooru</Option>
              <Option value="gelbooru">Gelbooru</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="salt"
            label="密码盐值"
            help="读取接口不回显现有值；留空表示保留当前盐值，用于密码哈希，如：choujin-steiner--{0}--"
          >
            <Input placeholder="留空保留当前值；仅在需要覆盖时填写" />
          </Form.Item>

          <Divider orientation="left">认证配置</Divider>

          <Form.Item name="username" label="用户名">
            <Input placeholder="可选" />
          </Form.Item>

          <Form.Item name="apiKey" label="API Key" extra="读取接口不回显现有值；留空表示保留当前 API Key，仅在需要覆盖时填写。">
            <Input placeholder="留空保留当前值；仅在需要覆盖时填写" />
          </Form.Item>

          <Divider orientation="left">其他选项</Divider>

          <Form.Item name="favoriteSupport" valuePropName="checked">
            <Switch checkedChildren="支持" unCheckedChildren="不支持" />
            <span style={{ marginLeft: 8 }}>支持收藏功能</span>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingSite ? '保存' : '添加'}
              </Button>
              <Button onClick={() => setModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default BooruSettingsPage;
