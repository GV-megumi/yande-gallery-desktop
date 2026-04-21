import React, { useState } from 'react';
import { Modal, Form, Select, Input } from 'antd';

/**
 * BatchTagAddModal
 *
 * 可复用的批量添加标签弹窗。收藏标签（FavoriteTags）和黑名单标签
 * （BlacklistTags）都会用到：它们都需要一次输入多个标签、选择所属
 * 站点、并可选地填一个额外字段（例如收藏标签的 labels 分组、黑名单
 * 的 notes 备注），统一抽象成这个组件避免两边重复实现。
 *
 * 设计要点：
 *  - tagNames 使用多行 textarea，支持换行或英文逗号分隔
 *  - siteId 支持 null（全局），否则为具体的站点 id
 *  - extraField 可选，父组件决定字段名、label、placeholder
 *  - onSubmit 为 async，期间弹窗按钮显示 loading，禁用 maskClose/Esc
 *  - 校验失败由 antd Form 自行显示错误信息
 */

export interface BatchTagAddModalProps {
  open: boolean;
  title: string;
  sites: Array<{ id: number; name: string }>;
  extraField?: {
    name: string;
    label: string;
    placeholder?: string;
  };
  onCancel: () => void;
  onSubmit: (values: {
    tagNames: string;
    siteId: number | null;
    extra?: string;
  }) => Promise<void>;
}

const GLOBAL_SITE_SELECT_VALUE = '__global__';

export const BatchTagAddModal: React.FC<BatchTagAddModalProps> = ({
  open,
  title,
  sites,
  extraField,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = () => {
    if (submitting) return;
    form.resetFields();
    onCancel();
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      try {
        await onSubmit({
          tagNames: values.tagNames,
          siteId: values.siteId ?? null,
          extra: extraField ? values[extraField.name] : undefined,
        });
        form.resetFields();
      } finally {
        setSubmitting(false);
      }
    } catch {
      // validateFields 失败：antd 自动显示 form 错误，这里无需处理
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      width={480}
      closable={!submitting}
      onCancel={handleCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      maskClosable={!submitting}
      keyboard={!submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ siteId: null }}>
        <Form.Item
          name="siteId"
          label="所属站点"
          getValueProps={(value) => ({
            value: value === null ? GLOBAL_SITE_SELECT_VALUE : value,
          })}
          getValueFromEvent={(value) => (
            value === GLOBAL_SITE_SELECT_VALUE ? null : value
          )}
        >
          <Select
            options={[
              { label: '全局', value: GLOBAL_SITE_SELECT_VALUE },
              ...sites.map((s) => ({ label: s.name, value: s.id })),
            ]}
          />
        </Form.Item>
        <Form.Item
          name="tagNames"
          label="标签"
          rules={[
            {
              validator: async (_, value) => {
                const count = (value ?? '')
                  .split(/[\n,]/)
                  .map((s: string) => s.trim())
                  .filter(Boolean).length;
                if (count === 0) {
                  throw new Error('请至少输入一个标签');
                }
              },
            },
          ]}
        >
          <Input.TextArea
            rows={6}
            placeholder={'支持换行或英文逗号分隔\n例如：\nhatsune miku\nrem, ram'}
          />
        </Form.Item>
        {extraField && (
          <Form.Item name={extraField.name} label={extraField.label}>
            <Input placeholder={extraField.placeholder} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};
