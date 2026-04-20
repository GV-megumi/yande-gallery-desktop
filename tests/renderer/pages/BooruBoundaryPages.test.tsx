/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { BooruWikiPage } from '../../../src/renderer/pages/BooruWikiPage';
import { BooruForumPage } from '../../../src/renderer/pages/BooruForumPage';
import { BooruUserPage } from '../../../src/renderer/pages/BooruUserPage';

const getSites = vi.fn();
const getWiki = vi.fn();
const getActiveSite = vi.fn();
const getForumTopics = vi.fn();
const getForumPosts = vi.fn();
const getProfile = vi.fn();
const getUserProfile = vi.fn();
const openExternal = vi.fn();

vi.mock('../../../src/renderer/components/DTextRenderer', () => ({
  DTextRenderer: ({ value }: { value: string }) => <div>{value}</div>,
}));

describe('Booru boundary pages consume camelCase DTOs', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

    (window as any).electronAPI = {
      booru: {
        getSites,
        getWiki,
        getActiveSite,
        getForumTopics,
        getForumPosts,
        getProfile,
        getUserProfile,
      },
      system: {
        openExternal,
      },
    };
  });

  it('Wiki 页面应直接消费 camelCase Wiki DTO', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [{ id: 7, name: 'Danbooru', type: 'danbooru', url: 'https://danbooru.donmai.us' }],
    });
    getWiki.mockResolvedValue({
      success: true,
      data: {
        id: 11,
        title: 'test_wiki',
        body: 'wiki body',
        otherNames: ['alias_a'],
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
        isLocked: true,
        isDeleted: false,
      },
    });

    render(
      <App>
        <BooruWikiPage wikiTitle="test_wiki" initialSiteId={7} />
      </App>
    );

    expect(await screen.findByText('test wiki')).toBeTruthy();
    expect(await screen.findByText('alias_a')).toBeTruthy();
    expect(await screen.findByText('已锁定')).toBeTruthy();
    expect(await screen.findByText('wiki body')).toBeTruthy();
  });

  it('Wiki 页面在非 Danbooru 站点下不应请求 Wiki API', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [{ id: 8, name: 'Yande', type: 'moebooru', url: 'https://yande.re' }],
    });

    render(
      <App>
        <BooruWikiPage wikiTitle="test_wiki" initialSiteId={8} />
      </App>
    );

    expect(await screen.findByText('当前仅 Danbooru 站点提供内置 Wiki 浏览支持')).toBeTruthy();

    await waitFor(() => {
      expect(getWiki).not.toHaveBeenCalled();
    });
  });

  it('Forum 页面应直接消费 camelCase topic/post DTO', async () => {
    const user = userEvent.setup();

    getActiveSite.mockResolvedValue({
      success: true,
      data: { id: 7, name: 'Danbooru', type: 'danbooru', url: 'https://danbooru.donmai.us' },
    });
    getForumTopics.mockResolvedValue({
      success: true,
      data: [
        {
          id: 21,
          title: 'topic title',
          responseCount: 5,
          isSticky: true,
          isLocked: false,
          isHidden: false,
          creatorId: 3,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      ],
    });
    getForumPosts.mockResolvedValue({
      success: true,
      data: [
        {
          id: 31,
          topicId: 21,
          body: 'post body',
          creatorId: 8,
          createdAt: '2026-03-03T00:00:00.000Z',
          updatedAt: '2026-03-04T00:00:00.000Z',
          isDeleted: false,
          isHidden: true,
        },
      ],
    });

    render(
      <App>
        <BooruForumPage />
      </App>
    );

    expect(await screen.findByText('topic title')).toBeTruthy();
    expect(await screen.findByText('回复数: 5')).toBeTruthy();

    const topicCardLink = await screen.findByRole('button', { name: '查看讨论' });
    await user.click(topicCardLink);

    expect(await screen.findByText('post body')).toBeTruthy();
    expect(await screen.findByText('已隐藏')).toBeTruthy();
  });

  it('User 页面应直接消费 camelCase profile DTO', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [{ id: 7, name: 'Danbooru', type: 'danbooru', url: 'https://danbooru.donmai.us' }],
    });
    getUserProfile.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        name: 'bob',
        levelString: 'Member',
        createdAt: '2026-04-05T00:00:00.000Z',
        avatarUrl: 'https://example.com/bob.png',
        postUploadCount: 20,
        postUpdateCount: 21,
        noteUpdateCount: 22,
        commentCount: 23,
        forumPostCount: 24,
        favoriteCount: 25,
        feedbackCount: 26,
      },
    });

    render(
      <App>
        <BooruUserPage username="bob" initialSiteId={7} />
      </App>
    );

    expect(await screen.findByText('bob')).toBeTruthy();
    expect(await screen.findByText('Member')).toBeTruthy();
    expect(await screen.findByText('收藏数')).toBeTruthy();
    expect(await screen.findByText('反馈数')).toBeTruthy();
    expect(await screen.findByText('上传帖子')).toBeTruthy();
    expect(await screen.findByText('论坛发帖')).toBeTruthy();
  });
});
