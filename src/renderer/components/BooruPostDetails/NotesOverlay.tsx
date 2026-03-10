import React, { useState, useEffect } from 'react';
import { Tooltip } from 'antd';
import { BooruPost, BooruSite } from '../../../shared/types';

interface NoteData {
  id: number;
  post_id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  body: string;
  creator: string;
  is_active?: boolean;
}

interface NotesOverlayProps {
  post: BooruPost;
  site: BooruSite | null;
  /** 容器宽度（像素），用于将绝对坐标转为百分比 */
  containerWidth?: number;
  /** 容器高度（像素） */
  containerHeight?: number;
}

/**
 * 帖子注释叠加层
 * 在图片上方渲染注释框，鼠标悬停时显示注释内容
 */
export const NotesOverlay: React.FC<NotesOverlayProps> = ({
  post,
  site,
  containerWidth,
  containerHeight,
}) => {
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [showNotes, setShowNotes] = useState(true);

  useEffect(() => {
    if (!site || !post.postId) return;
    setNotes([]);

    const loadNotes = async () => {
      try {
        const result = await window.electronAPI.booru.getNotes(site.id, post.postId);
        if (result.success && result.data && result.data.length > 0) {
          console.log('[NotesOverlay] 加载注释:', result.data.length, '个');
          setNotes(result.data);
        }
      } catch (error) {
        console.error('[NotesOverlay] 加载注释失败:', error);
      }
    };

    loadNotes();
  }, [post.postId, site?.id]);

  if (!showNotes || notes.length === 0) return null;

  // 原图尺寸（用于坐标换算）
  const imgWidth = post.width || 1;
  const imgHeight = post.height || 1;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {/* 切换按钮 */}
      <button
        onClick={() => setShowNotes(false)}
        style={{
          position: 'absolute',
          top: 8,
          right: 48,
          pointerEvents: 'auto',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
          zIndex: 10,
        }}
        title="隐藏注释"
      >
        注释 ✕
      </button>

      {notes.map((note) => {
        // 坐标转换：Moebooru/Danbooru 返回的是相对于原图的绝对像素坐标
        // 需要转换为相对于容器的百分比
        const left = `${(note.x / imgWidth) * 100}%`;
        const top = `${(note.y / imgHeight) * 100}%`;
        const width = `${(note.width / imgWidth) * 100}%`;
        const height = `${(note.height / imgHeight) * 100}%`;

        // 解析 HTML 格式的注释内容（Moebooru/Danbooru 支持简单 HTML）
        const bodyText = note.body
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();

        return (
          <Tooltip
            key={note.id}
            title={
              <div style={{ maxWidth: 260, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {bodyText}
                {note.creator && (
                  <div style={{ marginTop: 4, opacity: 0.6, fontSize: 11 }}>
                    — {note.creator}
                  </div>
                )}
              </div>
            }
            placement="topLeft"
            overlayStyle={{ maxWidth: 280 }}
          >
            <div
              style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                border: '2px solid rgba(255, 220, 50, 0.8)',
                borderRadius: 2,
                background: 'rgba(255, 220, 50, 0.08)',
                cursor: 'pointer',
                pointerEvents: 'auto',
                boxSizing: 'border-box',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 220, 50, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 220, 50, 0.08)';
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
};
