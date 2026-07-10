/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ApiPairingQrModal } from '../../../src/renderer/components/ApiPairingQrModal';

const getPairingInfo = vi.fn();

const basePairing = {
  name: 'test-host',
  port: 38947,
  running: true,
  appEnabled: true,
  apiKey: 'secret-key',
  lanAddresses: ['192.168.1.10'],
};

beforeEach(() => {
  getPairingInfo.mockReset();
  getPairingInfo.mockResolvedValue({ success: true, data: basePairing });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // antd QRCode 默认 canvas 渲染；jsdom 无 canvas 实现，提供 2d 上下文桩避免抛错
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  }));

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    apiService: { getPairingInfo },
  };
});

afterEach(() => {
  cleanup();
});

describe('ApiPairingQrModal', () => {
  it('open=true 时拉取配对信息并渲染明文 baseUrl', async () => {
    render(<ApiPairingQrModal open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(getPairingInfo).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/http:\/\/192\.168\.1\.10:38947/)).toBeTruthy();
    // apiKey 明文展示，供手机端手输
    expect(screen.getByText('secret-key')).toBeTruthy();
  });

  it('open=false 时不拉取配对信息', () => {
    render(<ApiPairingQrModal open={false} onClose={vi.fn()} />);
    expect(getPairingInfo).not.toHaveBeenCalled();
  });

  it('appEnabled=false 时提示未开启「允许手机端连接」', async () => {
    getPairingInfo.mockResolvedValue({
      success: true,
      data: { ...basePairing, appEnabled: false },
    });

    render(<ApiPairingQrModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/未开启「允许手机端连接」/)).toBeTruthy();
  });

  it('appEnabled=true 但服务未运行时提示启动失败警告', async () => {
    getPairingInfo.mockResolvedValue({
      success: true,
      data: { ...basePairing, appEnabled: true, running: false },
    });

    render(<ApiPairingQrModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/API 服务未运行（启动失败）/)).toBeTruthy();
  });

  it('lanAddresses 多个时渲染 IP 选择器', async () => {
    getPairingInfo.mockResolvedValue({
      success: true,
      data: { ...basePairing, lanAddresses: ['192.168.1.10', '10.0.0.5'] },
    });

    render(<ApiPairingQrModal open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(getPairingInfo).toHaveBeenCalledTimes(1);
    });
    // antd Modal 内容 portal 到 document.body，需在整个文档范围内查询
    await waitFor(() => {
      expect(document.body.querySelector('.ant-select')).not.toBeNull();
    });
  });
});
