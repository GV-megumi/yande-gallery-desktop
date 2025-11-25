/**
 * 检查下载队列状态分布
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, '../data/gallery.db');

console.log('[脚本] 检查下载队列状态分布...');
console.log('[脚本] 数据库路径:', DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[脚本] 数据库连接失败:', err);
    process.exit(1);
  }
  
  console.log('[脚本] 数据库连接成功\n');
  
  // 查询所有状态分布
  db.all(`
    SELECT 
      status,
      COUNT(*) as count
    FROM booru_download_queue
    GROUP BY status
    ORDER BY count DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('[脚本] 查询失败:', err);
      db.close();
      process.exit(1);
    }
    
    console.log('状态分布:');
    console.log('----------------------------------------');
    let total = 0;
    rows.forEach(row => {
      console.log(`  ${row.status || '(NULL)'}: ${row.count} 条`);
      total += row.count;
    });
    console.log('----------------------------------------');
    console.log(`  总计: ${total} 条\n`);
    
    // 查询"进行中"的记录（pending + downloading）
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
      
      console.log(`"进行中"状态 (pending + downloading): ${row.count} 条\n`);
      
      db.close((err) => {
        if (err) {
          console.error('[脚本] 关闭数据库失败:', err);
        }
        process.exit(0);
      });
    });
  });
});

