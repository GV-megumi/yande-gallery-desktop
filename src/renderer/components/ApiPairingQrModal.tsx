import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, QRCode, Select, Space, Typography } from 'antd';
import type { ApiPairingInfo } from '../../shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 移动端扫码配对弹窗（安卓相册 spec §4.1/§5.6） */
export const ApiPairingQrModal: React.FC<Props> = ({ open, onClose }) => {
  const [info, setInfo] = useState<ApiPairingInfo | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await window.electronAPI.apiService.getPairingInfo();
    if (result.success && result.data) {
      setInfo(result.data);
      setSelectedIp(result.data.lanAddresses[0] ?? null);
    } else {
      setLoadError(result.error || '获取配对信息失败');
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const baseUrl = info && selectedIp ? `http://${selectedIp}:${info.port}` : null;
  const payload = useMemo(() => {
    if (!info || !baseUrl || !info.apiKey) {
      return null;
    }
    return JSON.stringify({ v: 1, name: info.name, baseUrl, apiKey: info.apiKey });
  }, [info, baseUrl]);

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="扫码配对移动端" width={420}>
      {loadError && <Alert type="error" message={loadError} showIcon style={{ marginBottom: 12 }} />}
      {info && !info.running && (
        <Alert type="warning" message="API 服务未运行，请先在上方启用" showIcon style={{ marginBottom: 12 }} />
      )}
      {info && info.mode !== 'lan' && (
        <Alert type="warning" message="当前为仅本机模式，手机无法访问，请切换为局域网模式" showIcon style={{ marginBottom: 12 }} />
      )}
      {info && !info.apiKey && (
        <Alert type="warning" message="尚未生成 API Key，请先启用服务或生成 Key" showIcon style={{ marginBottom: 12 }} />
      )}
      {info && info.lanAddresses.length === 0 && (
        <Alert type="error" message="未发现局域网 IPv4 地址" showIcon style={{ marginBottom: 12 }} />
      )}
      {info && info.lanAddresses.length > 1 && (
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          value={selectedIp}
          onChange={setSelectedIp}
          options={info.lanAddresses.map((ip) => ({ value: ip, label: ip }))}
        />
      )}
      {payload && (
        <Space direction="vertical" align="center" style={{ width: '100%' }}>
          <QRCode value={payload} size={280} errorLevel="M" />
          {/* 明文 baseUrl 与 key，供手机端手动输入（spec §5.6） */}
          <Typography.Text type="secondary" copyable={{ text: baseUrl!, tooltips: '复制地址' }}>
            {baseUrl}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ wordBreak: 'break-all', textAlign: 'center' }}
            copyable={{ text: info!.apiKey, tooltips: '复制 Key' }}
          >
            {info!.apiKey}
          </Typography.Text>
        </Space>
      )}
    </Modal>
  );
};
