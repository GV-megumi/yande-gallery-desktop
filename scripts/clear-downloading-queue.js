/**
 * 清空下载管理中"进行中"状态的记录（包括 pending 和 downloading）
 * 
 * 使用方法:
 *   方法1: node scripts/clear-downloading-queue.js
 *   方法2: 使用 SQLite 命令行工具直接执行 SQL
 *          sqlite3 data/gallery.db "DELETE FROM booru_download_queue WHERE status IN ('pending', 'downloading');"
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据库文件路径
const DB_PATH = path.join(__dirname, '../data/gallery.db');

console.log('[脚本] 开始清空"进行中"状态的记录（pending + downloading）...');
console.log('[脚本] 数据库路径:', DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[脚本] 数据库连接失败:', err);
    process.exit(1);
  }
  
  console.log('[脚本] 数据库连接成功');
  
  // 先查询有多少条记录
  db.get(`
    SELECT COUNT(*) as count 
    FROM booru_download_queue 
    WHERE status IN ('pending', 'downloading')
  `, [], (err, row) => {
    if (err) {
      console.error('[脚本] 查询失败:', err);
      db.close();
      process.exit(1);
    }
    
    const count = row.count;
    console.log(`[脚本] 找到 ${count} 条"进行中"状态的记录`);
    
    // 分别查询 pending 和 downloading 的数量
    db.get(`
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading_count
      FROM booru_download_queue
      WHERE status IN ('pending', 'downloading')
    `, [], (err, detailRow) => {
      if (err) {
        console.error('[脚本] 查询详情失败:', err);
      } else {
        console.log(`  - pending (等待中): ${detailRow.pending_count || 0} 条`);
        console.log(`  - downloading (下载中): ${detailRow.downloading_count || 0} 条`);
      }
      
      if (count === 0) {
        console.log('[脚本] 没有需要清空的记录');
        db.close();
        process.exit(0);
      }
      
      // 删除记录
      db.run(`
        DELETE FROM booru_download_queue 
        WHERE status IN ('pending', 'downloading')
      `, [], function(err) {
        if (err) {
          console.error('[脚本] 删除失败:', err);
          db.close();
          process.exit(1);
        }
        
        console.log(`\n[脚本] 成功删除 ${this.changes} 条记录`);
        console.log('[脚本] 操作完成');
        
        db.close((err) => {
          if (err) {
            console.error('[脚本] 关闭数据库失败:', err);
          }
          process.exit(0);
        });
      });
    });
  });
});

