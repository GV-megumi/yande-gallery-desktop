import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import { run, runWithChanges, get, all, runInTransaction } from '../../../src/main/services/database';

/**
 * 数据库工具函数测试
 * 使用内存 SQLite 数据库，不依赖文件系统
 */

let db: sqlite3.Database;

beforeAll(async () => {
  // 创建内存数据库
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => {
      if (err) reject(err);
      else resolve(database);
    });
  });

  // 创建测试表
  await run(db, `
    CREATE TABLE test_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `);
});

afterAll(async () => {
  if (db) {
    await new Promise<void>((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

describe('run', () => {
  it('应成功执行 INSERT 语句', async () => {
    await run(db, 'INSERT INTO test_items (name, value, createdAt) VALUES (?, ?, ?)', [
      'item1', 10, '2024-01-01',
    ]);
    // 不抛出错误即为成功
  });

  it('应成功执行 UPDATE 语句', async () => {
    await run(db, 'UPDATE test_items SET value = ? WHERE name = ?', [20, 'item1']);
  });

  it('SQL 语法错误应抛出异常', async () => {
    await expect(run(db, 'INVALID SQL')).rejects.toThrow();
  });

  it('空参数应默认为空数组', async () => {
    // 不带参数的 INSERT（测试 params 默认值）
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('item2', 5, '2024-01-02')");
  });
});

describe('runWithChanges', () => {
  it('应返回受影响的行数', async () => {
    // 先插入一些测试数据
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('change_test', 1, '2024-01-03')");

    const result = await runWithChanges(db, 'UPDATE test_items SET value = 99 WHERE name = ?', ['change_test']);
    expect(result.changes).toBe(1);
  });

  it('无匹配行时 changes 应为 0', async () => {
    const result = await runWithChanges(db, 'UPDATE test_items SET value = 99 WHERE name = ?', ['nonexistent']);
    expect(result.changes).toBe(0);
  });

  it('批量更新应返回正确的 changes 数', async () => {
    // 插入多条记录
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('batch1', 1, '2024-01-04')");
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('batch2', 1, '2024-01-04')");
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('batch3', 1, '2024-01-04')");

    const result = await runWithChanges(db, "UPDATE test_items SET value = 100 WHERE name LIKE 'batch%'");
    expect(result.changes).toBe(3);
  });

  it('DELETE 应返回删除的行数', async () => {
    const result = await runWithChanges(db, "DELETE FROM test_items WHERE name LIKE 'batch%'");
    expect(result.changes).toBe(3);
  });
});

describe('get', () => {
  it('应返回单行结果', async () => {
    const row = await get<{ name: string; value: number }>(db, 'SELECT name, value FROM test_items WHERE name = ?', ['item1']);
    expect(row).toBeDefined();
    expect(row!.name).toBe('item1');
    expect(row!.value).toBe(20); // 之前 UPDATE 过
  });

  it('无匹配结果时应返回 undefined', async () => {
    const row = await get(db, 'SELECT * FROM test_items WHERE name = ?', ['nonexistent']);
    expect(row).toBeUndefined();
  });

  it('应只返回第一行', async () => {
    const row = await get<{ name: string }>(db, 'SELECT name FROM test_items ORDER BY id ASC LIMIT 1');
    expect(row).toBeDefined();
    expect(row!.name).toBe('item1');
  });

  it('SQL 错误应抛出异常', async () => {
    await expect(get(db, 'SELECT * FROM nonexistent_table')).rejects.toThrow();
  });
});

describe('all', () => {
  it('应返回所有匹配的行', async () => {
    const rows = await all<{ name: string }>(db, 'SELECT name FROM test_items ORDER BY id ASC');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].name).toBe('item1');
  });

  it('无匹配时应返回空数组', async () => {
    const rows = await all(db, 'SELECT * FROM test_items WHERE value = ?', [-999]);
    expect(rows).toEqual([]);
  });

  it('应支持 LIMIT 和 OFFSET', async () => {
    const rows = await all(db, 'SELECT * FROM test_items ORDER BY id ASC LIMIT ? OFFSET ?', [1, 0]);
    expect(rows).toHaveLength(1);
  });

  it('SQL 错误应抛出异常', async () => {
    await expect(all(db, 'INVALID QUERY')).rejects.toThrow();
  });
});

describe('runInTransaction', () => {
  it('成功时应提交事务', async () => {
    await runInTransaction(db, async () => {
      await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('tx_item1', 1, '2024-02-01')");
      await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('tx_item2', 2, '2024-02-01')");
    });

    // 验证数据已持久化
    const rows = await all(db, "SELECT * FROM test_items WHERE name LIKE 'tx_item%'");
    expect(rows).toHaveLength(2);
  });

  it('失败时应回滚事务', async () => {
    try {
      await runInTransaction(db, async () => {
        await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('rollback_item', 1, '2024-02-02')");
        // 故意制造错误
        throw new Error('模拟事务中的错误');
      });
    } catch (e) {
      // 预期抛出错误
    }

    // 验证数据已回滚
    const row = await get(db, "SELECT * FROM test_items WHERE name = 'rollback_item'");
    expect(row).toBeUndefined();
  });

  it('应返回函数的返回值', async () => {
    const result = await runInTransaction(db, async () => {
      await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('return_test', 42, '2024-02-03')");
      return 'success';
    });
    expect(result).toBe('success');
  });

  it('错误时应向上传播异常', async () => {
    await expect(
      runInTransaction(db, async () => {
        throw new Error('test error');
      })
    ).rejects.toThrow('test error');
  });

  it('嵌套操作应在同一事务中', async () => {
    await runInTransaction(db, async () => {
      await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('nested1', 1, '2024-02-04')");
      await run(db, "UPDATE test_items SET value = 999 WHERE name = 'nested1'");
    });

    const row = await get<{ value: number }>(db, "SELECT value FROM test_items WHERE name = 'nested1'");
    expect(row!.value).toBe(999);
  });
});

describe('数据库 CRUD 集成测试', () => {
  it('完整的 CRUD 流程', async () => {
    // Create
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('crud_item', 10, '2024-03-01')");
    const created = await get<{ name: string; value: number }>(db, "SELECT * FROM test_items WHERE name = 'crud_item'");
    expect(created).toBeDefined();
    expect(created!.value).toBe(10);

    // Read
    const items = await all<{ name: string }>(db, "SELECT * FROM test_items WHERE name = 'crud_item'");
    expect(items).toHaveLength(1);

    // Update
    await run(db, "UPDATE test_items SET value = 20 WHERE name = 'crud_item'");
    const updated = await get<{ value: number }>(db, "SELECT value FROM test_items WHERE name = 'crud_item'");
    expect(updated!.value).toBe(20);

    // Delete
    const deleteResult = await runWithChanges(db, "DELETE FROM test_items WHERE name = 'crud_item'");
    expect(deleteResult.changes).toBe(1);
    const deleted = await get(db, "SELECT * FROM test_items WHERE name = 'crud_item'");
    expect(deleted).toBeUndefined();
  });

  it('COUNT 聚合查询', async () => {
    const result = await get<{ count: number }>(db, 'SELECT COUNT(*) as count FROM test_items');
    expect(result).toBeDefined();
    expect(typeof result!.count).toBe('number');
    expect(result!.count).toBeGreaterThan(0);
  });

  it('LIKE 模糊查询', async () => {
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('search_alpha', 1, '2024-03-02')");
    await run(db, "INSERT INTO test_items (name, value, createdAt) VALUES ('search_beta', 2, '2024-03-02')");

    const results = await all(db, "SELECT * FROM test_items WHERE name LIKE ?", ['search_%']);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('ORDER BY 排序查询', async () => {
    const rows = await all<{ name: string; value: number }>(
      db,
      "SELECT name, value FROM test_items WHERE name LIKE 'search_%' ORDER BY value DESC"
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // 验证降序
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value);
    }
  });
});
