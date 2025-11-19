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
  Slider
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CloudOutlined, ApiOutlined, BgColorsOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';

const { Option } = Select;

interface BooruSettingsPageProps {}

export const BooruSettingsPage: React.FC<BooruSettingsPageProps> = () => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSite, setEditingSite] = useState<BooruSite | null>(null);
  const [form] = Form.useForm();
  const [appearanceForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState('sites');
  const [savingAppearance, setSavingAppearance] = useState(false);

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
      if (!window.electronAPI) {
        console.error('[BooruSettingsPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        const booruConfig = config.booru || {
          appearance: {
            gridSize: 220,
            previewQuality: 'auto',
            itemsPerPage: 20,
            paginationPosition: 'bottom',
            pageMode: 'pagination',
            spacing: 16,
            borderRadius: 8,
            margin: 24
          }
        };

        console.log('[BooruSettingsPage] 外观配置加载成功:', booruConfig.appearance);
        appearanceForm.setFieldsValue(booruConfig.appearance);
      } else {
        console.error('[BooruSettingsPage] 加载外观配置失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruSettingsPage] 加载外观配置失败:', error);
    }
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
      ...site
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
    // 确保URL有协议（自动添加 https://）
    if (values.url && !values.url.startsWith('http://') && !values.url.startsWith('https://')) {
      values.url = 'https://' + values.url;
      console.log('[BooruSettingsPage] 自动添加协议到URL:', values.url);
    }

    console.log('[BooruSettingsPage] 提交站点表单:', values);
    try {
      if (!window.electronAPI) return;

      if (editingSite) {
        // 编辑
        const result = await window.electronAPI.booru.updateSite(editingSite.id, values);
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
        const result = await window.electronAPI.booru.addSite(values);
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
    console.log('[BooruSettingsPage] 保存外观配置:', values);
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
          appearance: values
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
                    pageMode: 'pagination',
                    spacing: 16,
                    borderRadius: 8,
                    margin: 24
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

                  <Form.Item
                    label="页面模式"
                    name="pageMode"
                    tooltip="选择翻页模式或无限滚动模式"
                  >
                    <Select>
                      <Option value="pagination">翻页</Option>
                      <Option value="infinite">无限滚动</Option>
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
          }
        ]}
      />

      {/* 添加/编辑站点模态框 */}
      <Modal
        title={editingSite ? '编辑站点' : '添加站点'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
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
            help="用于密码哈希，如：choujin-steiner--{0}--"
          >
            <Input placeholder="留空使用默认值" />
          </Form.Item>

          <Divider orientation="left">认证配置</Divider>

          <Form.Item name="username" label="用户名">
            <Input placeholder="可选" />
          </Form.Item>

          <Form.Item name="apiKey" label="API Key">
            <Input placeholder="可选" />
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
