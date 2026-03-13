/**
 * Google 账号管理页面
 * 统一管理 Google OAuth 登录状态，供 Drive / Photos 等功能使用
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Spin, Avatar, Descriptions, message } from 'antd';
import { GoogleOutlined, LoginOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { colors, spacing, fontSize, radius, shadows } from '../styles/tokens';

export const GoogleAccountPage: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const result = await window.electronAPI.google.getAuthStatus();
      if (result.success && result.data) {
        setIsLoggedIn(result.data.isLoggedIn);
        setEmail(result.data.email || '');
        setExpiresAt(result.data.expiresAt);
      }
    } catch (error) {
      console.error('[GoogleAccount] 检查认证状态失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogin = async () => {
    setActionLoading(true);
    try {
      const result = await window.electronAPI.google.login();
      if (result.success) {
        setIsLoggedIn(true);
        setEmail(result.email || '');
        message.success('Google 账号登录成功');
        checkAuth();
      } else {
        message.error('登录失败: ' + result.error);
      }
    } catch (error) {
      message.error('登录异常: ' + String(error));
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogout = async () => {
    setActionLoading(true);
    try {
      const result = await window.electronAPI.google.logout();
      if (result.success) {
        setIsLoggedIn(false);
        setEmail('');
        setExpiresAt(undefined);
        message.success('已退出 Google 账号');
      }
    } catch (error) {
      message.error('退出失败: ' + String(error));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        height: '60vh', gap: spacing.xl,
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'linear-gradient(135deg, #4285F4, #34A853)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, color: '#fff',
        }}>
          <GoogleOutlined />
        </div>
        <div>
          <div style={{ fontSize: fontSize.xl, fontWeight: 700, color: colors.textPrimary, textAlign: 'center' }}>
            连接 Google 账号
          </div>
          <div style={{ fontSize: fontSize.md, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm }}>
            登录后可使用 Google Drive 文件管理功能
          </div>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<LoginOutlined />}
          onClick={handleLogin}
          loading={actionLoading}
          style={{ minWidth: 180 }}
        >
          登录 Google 账号
        </Button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: spacing['3xl'] }}>
      {/* 账号卡片 */}
      <div style={{
        background: colors.bgElevated,
        borderRadius: radius.md,
        boxShadow: shadows.card,
        padding: spacing.xl,
        display: 'flex', flexDirection: 'column', gap: spacing.lg,
      }}>
        {/* 头像 + 邮箱 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          <Avatar size={56} icon={<UserOutlined />} style={{ background: '#4285F4', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: fontSize.base, fontWeight: 600, color: colors.textPrimary }}>{email}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginTop: 4, fontSize: fontSize.sm,
              color: colors.success,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: colors.success, display: 'inline-block',
              }} />
              已登录
            </div>
          </div>
        </div>

        {/* 授权信息 */}
        <Descriptions column={1} size="small" style={{ marginTop: spacing.xs }}>
          <Descriptions.Item label="授权范围">Google Drive · Google Photos</Descriptions.Item>
          {expiresAt && (
            <Descriptions.Item label="Token 过期">
              {new Date(expiresAt).toLocaleString()}
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* 退出按钮 */}
        <Button
          icon={<LogoutOutlined />}
          danger
          onClick={handleLogout}
          loading={actionLoading}
          style={{ alignSelf: 'flex-start' }}
        >
          退出登录
        </Button>
      </div>

      <div style={{ marginTop: spacing.md, fontSize: fontSize.sm, color: colors.textTertiary }}>
        退出后 Drive 和 Photos API 功能将不可用，但 Photos 页面的嵌入浏览器不受影响。
      </div>
    </div>
  );
};
