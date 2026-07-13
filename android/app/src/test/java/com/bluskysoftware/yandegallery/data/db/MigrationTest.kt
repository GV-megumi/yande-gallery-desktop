package com.bluskysoftware.yandegallery.data.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 迁移测试（路线：Robolectric 直建真实 v1 库文件后用 Room 打开触发迁移）。
 * 不用 MigrationTestHelper——本工程未把导出 schema 接入 test assets、也未引 room-testing。
 * 校验点：用 Room `.addMigrations(MIGRATION_1_2)` 打开一个真实 v1 文件库时，
 * Room 会先跑迁移、再按 v2 期望 schema 逐表 TableInfo 校验，任何不一致即抛异常——
 * 因此“能成功打开并查询”本身即验证了 CREATE TABLE 与 Room 期望的 v2 schema 一致。
 */
@RunWith(RobolectricTestRunner::class)
class MigrationTest {
    private val dbName = "migration-test.db"
    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(dbName)
    }

    @After
    fun teardown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun `v2 迁移到 v3 downloads 换 serverId 复合主键 旧行丢弃 images 保留`() = runTest {
        // 1) 手工建真实 v2 库文件，种 1 行 images + 1 行旧版（无 serverId）downloads
        createRealV2Database()

        // 2) 用 Room 打开并注册迁移链（库现为 v5，2→3→4→5 触发）与最终 schema 校验
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4, AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6)
            .allowMainThreadQueries()
            .build()
        try {
            assertEquals(1L, db.imageDao().countAll())                        // 镜像数据保留
            assertNull(db.downloadDao().byImageId(1L, 1L))                    // 旧 downloads 行已丢弃
            db.downloadDao().upsert(DownloadEntity(1L, 1L, "content://x", "2026-07-05T00:00:00.000Z"))
            db.downloadDao().upsert(DownloadEntity(2L, 1L, "content://y", "2026-07-05T00:00:00.000Z"))
            assertEquals("content://x", db.downloadDao().byImageId(1L, 1L)?.mediaStoreUri)  // 复合主键：同 imageId 双服务器共存
            assertEquals("content://y", db.downloadDao().byImageId(2L, 1L)?.mediaStoreUri)
        } finally {
            db.close()
        }
    }

    @Test
    fun `v1 迁移到 v2 建 search_history 且保留 images`() = runTest {
        // 1) 手工建真实 v1 库文件（非 Room createAll 全新库），并种一行 images
        createRealV1Database()

        // 2) 用 Room 打开同一文件并注册迁移链（库现为 v6，1→2→3→4→5→6 全链）——触发迁移与最终 schema 校验
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4, AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6)
            .allowMainThreadQueries()
            .build()
        try {
            // 迁移后 images 旧数据保留
            assertEquals(1L, db.imageDao().countAll())
            assertEquals("a.jpg", db.imageDao().byId(1)?.filename)

            // search_history 表存在
            db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='search_history'", null)
                .use { assertTrue(it.moveToFirst()) }

            // 且可用：写入并读回一条搜索历史（v4 起 at 为 epochMillis，BUG-17）
            db.searchHistoryDao().upsert(SearchHistoryEntity("neko", 1751673600000L))
            db.query("SELECT COUNT(*) FROM search_history", null)
                .use { assertTrue(it.moveToFirst()); assertEquals(1, it.getInt(0)) }
        } finally {
            db.close()
        }
    }

    @Test
    fun `v3 迁移到 v4 search_history at 转 epochMillis 且倒序修正`() = runTest {
        // 1) 真实 v3 库：老格式 at 为 Instant.toString() 文本。种下 BUG-17 的错位场景——
        //    同一秒内先写 A（整秒，无小数位）后写 B（.500）：TEXT 字典序 'Z'>'.' 使 A 误排在 B 前。
        createRealV3Database()

        // 2) Room 打开触发 3→4→5→6：Kotlin 侧逐行解析换算搬入 INTEGER 新表
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4, AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6)
            .allowMainThreadQueries()
            .build()
        try {
            // 数值换算正确（期望值用 Instant.parse 现算，与迁移实现同源同义）
            db.query("SELECT at FROM search_history WHERE `query`='A'", null)
                .use { it.moveToFirst(); assertEquals(java.time.Instant.parse("2026-07-05T00:00:01Z").toEpochMilli(), it.getLong(0)) }
            db.query("SELECT at FROM search_history WHERE `query`='B'", null)
                .use { it.moveToFirst(); assertEquals(java.time.Instant.parse("2026-07-05T00:00:01.500Z").toEpochMilli(), it.getLong(0)) }
            // 倒序修正：B（后写）应排在 A 前；解析失败的 garbage 行兜底 0 排最末且不丢词
            assertEquals(listOf("B", "A", "garbage"), db.searchHistoryDao().observeRecent(10).first())
        } finally {
            db.close()
        }
    }

    @Test
    fun `v4到v5_galleries补createdAt_album_prefs表可用`() = runTest {
        // 1) 手工建真实 v4 库文件，种 1 行 galleries（尚无 createdAt 列、无 album_prefs 表）
        createRealV4Database()

        // 2) Room 打开触发 4→5→6 迁移与最终 v6 schema 校验
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4, AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6)
            .allowMainThreadQueries()
            .build()
        try {
            // 旧行 createdAt 为 NULL（spec §2.2）
            db.query("SELECT createdAt FROM galleries WHERE id = 1", null).use { c ->
                assertTrue(c.moveToFirst())
                assertTrue(c.isNull(0))
            }
            // 新表可写可读
            db.openHelper.writableDatabase.execSQL(
                "INSERT INTO album_prefs (galleryId, pinned, pinnedAt, inOther, manualOrder) VALUES (1, 1, 123, 0, NULL)"
            )
            db.query("SELECT pinned FROM album_prefs WHERE galleryId = 1", null).use { c ->
                assertTrue(c.moveToFirst())
                assertEquals(1, c.getInt(0))
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun `v5 迁移到 v6 建 image_files 且 downloads 保留`() = runTest {
        createRealV1Database()   // 借 v1 起点走全链 1→6

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(
                AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4,
                AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6,
            )
            .allowMainThreadQueries()
            .build()
        try {
            db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "HQ", "s1/i1/a.jpg", 10L, 0L))
            assertEquals("HQ", db.imageFileDao().byImageId(1L, 1L)?.tier)
            // downloads 表 v6 仍在（v7 收尾任务才删）
            db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'", null)
                .use { assertTrue(it.moveToFirst()) }
        } finally {
            db.close()
        }
    }

    /** 用框架层 SQLiteDatabase 复刻 v1 schema（照 1.json）并写盘，PRAGMA user_version=1。 */
    private fun createRealV1Database() {
        val dbFile = context.getDatabasePath(dbName)
        dbFile.parentFile?.mkdirs()
        val v1 = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        try {
            V1_STATEMENTS.forEach(v1::execSQL)
            v1.execSQL(
                "INSERT INTO images (id,filename,width,height,fileSize,format,createdAt,updatedAt) " +
                    "VALUES (1,'a.jpg',1,1,1,'jpg','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
            )
            v1.version = 1 // PRAGMA user_version = 1，使 Room 判定需 1→2 迁移
        } finally {
            v1.close()
        }
    }

    /** 复刻 v3 schema（照 3.json：v2 各表但 downloads 为复合主键新版），种 BUG-17 错位场景的 search_history。 */
    private fun createRealV3Database() {
        val dbFile = context.getDatabasePath(dbName)
        dbFile.parentFile?.mkdirs()
        val v3 = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        try {
            V3_STATEMENTS.forEach(v3::execSQL)
            // A 先写（整秒——Instant.toString() 省略 .000）；B 后写（同秒 .500）；
            // TEXT 字典序下 'Z' > '.' 使 A 误排 B 前（BUG-17 复现态）；garbage 为不可解析兜底行
            v3.execSQL("INSERT INTO search_history (`query`, at) VALUES ('A', '2026-07-05T00:00:01Z')")
            v3.execSQL("INSERT INTO search_history (`query`, at) VALUES ('B', '2026-07-05T00:00:01.500Z')")
            v3.execSQL("INSERT INTO search_history (`query`, at) VALUES ('garbage', 'not-a-timestamp')")
            v3.version = 3 // PRAGMA user_version = 3，使 Room 判定需 3→4 迁移
        } finally {
            v3.close()
        }
    }

    /** 复刻 v2 schema（照 2.json：v1 各表 + search_history + v2 identity_hash），种 images 与旧版 downloads 各一行。 */
    private fun createRealV2Database() {
        val dbFile = context.getDatabasePath(dbName)
        dbFile.parentFile?.mkdirs()
        val v2 = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        try {
            V2_STATEMENTS.forEach(v2::execSQL)
            v2.execSQL(
                "INSERT INTO images (id,filename,width,height,fileSize,format,createdAt,updatedAt) " +
                    "VALUES (1,'a.jpg',1,1,1,'jpg','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
            )
            v2.execSQL(
                "INSERT INTO downloads (imageId, mediaStoreUri, downloadedAt) " +
                    "VALUES (1, 'content://old', '2026-01-01T00:00:00.000Z')",
            )
            v2.version = 2 // PRAGMA user_version = 2，使 Room 判定需 2→3 迁移
        } finally {
            v2.close()
        }
    }

    /** 复刻 v4 schema（照 4.json：v3 各表但 search_history.at 为 INTEGER），种 galleries 一行（无 createdAt 列）。 */
    private fun createRealV4Database() {
        val dbFile = context.getDatabasePath(dbName)
        dbFile.parentFile?.mkdirs()
        val v4 = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        try {
            V4_STATEMENTS.forEach(v4::execSQL)
            v4.execSQL("INSERT INTO galleries (id, name, coverImageId, imageCount) VALUES (1, 'g', NULL, 0)")
            v4.version = 4 // PRAGMA user_version = 4，使 Room 判定需 4→5 迁移
        } finally {
            v4.close()
        }
    }

    private companion object {
        /** v1 建表语句——逐字取自 schemas/.../1.json 的 createSql（${TABLE_NAME} 已展开）。 */
        val V1_STATEMENTS = listOf(
            "CREATE TABLE IF NOT EXISTS `images` (`id` INTEGER NOT NULL, `filename` TEXT NOT NULL, `width` INTEGER NOT NULL, `height` INTEGER NOT NULL, `fileSize` INTEGER NOT NULL, `format` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
            "CREATE INDEX IF NOT EXISTS `index_images_createdAt` ON `images` (`createdAt`)",
            "CREATE TABLE IF NOT EXISTS `galleries` (`id` INTEGER NOT NULL, `name` TEXT NOT NULL, `coverImageId` INTEGER, `imageCount` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `gallery_images` (`galleryId` INTEGER NOT NULL, `imageId` INTEGER NOT NULL, PRIMARY KEY(`galleryId`, `imageId`), FOREIGN KEY(`imageId`) REFERENCES `images`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
            "CREATE INDEX IF NOT EXISTS `index_gallery_images_imageId` ON `gallery_images` (`imageId`)",
            "CREATE TABLE IF NOT EXISTS `tags` (`id` INTEGER NOT NULL, `name` TEXT NOT NULL, `category` TEXT, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `image_tags` (`imageId` INTEGER NOT NULL, `tagId` INTEGER NOT NULL, PRIMARY KEY(`imageId`, `tagId`), FOREIGN KEY(`imageId`) REFERENCES `images`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )",
            "CREATE INDEX IF NOT EXISTS `index_image_tags_tagId` ON `image_tags` (`tagId`)",
            "CREATE TABLE IF NOT EXISTS `servers` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `baseUrl` TEXT NOT NULL, `apiKey` TEXT NOT NULL, `isActive` INTEGER NOT NULL)",
            "CREATE TABLE IF NOT EXISTS `sync_state` (`id` INTEGER NOT NULL, `remoteServerId` TEXT NOT NULL, `cursor` TEXT, `dataVersion` INTEGER NOT NULL, `lastSyncAt` TEXT NOT NULL, PRIMARY KEY(`id`))",
            "CREATE TABLE IF NOT EXISTS `downloads` (`imageId` INTEGER NOT NULL, `mediaStoreUri` TEXT NOT NULL, `downloadedAt` TEXT NOT NULL, PRIMARY KEY(`imageId`))",
            "CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)",
            "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '9ac9c16ad105e1a52e68a57efd6715f4')",
        )

        /** v2 建表语句：v1 各表（downloads 仍是旧版 imageId 主键）+ search_history + v2 identity_hash（schemas/.../2.json）。 */
        val V2_STATEMENTS = V1_STATEMENTS.dropLast(1) + listOf(
            "CREATE TABLE IF NOT EXISTS `search_history` (`query` TEXT NOT NULL, `at` TEXT NOT NULL, PRIMARY KEY(`query`))",
            "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '9bad12e2c4ef32f36ccc17de8a121c62')",
        )

        /** v3 建表语句：v2 各表但 downloads 换 (serverId,imageId) 复合主键 + v3 identity_hash（schemas/.../3.json）。 */
        val V3_STATEMENTS = V1_STATEMENTS.dropLast(3) + listOf(
            "CREATE TABLE IF NOT EXISTS `downloads` (`serverId` INTEGER NOT NULL, `imageId` INTEGER NOT NULL, `mediaStoreUri` TEXT NOT NULL, `downloadedAt` TEXT NOT NULL, PRIMARY KEY(`serverId`, `imageId`))",
            "CREATE TABLE IF NOT EXISTS `search_history` (`query` TEXT NOT NULL, `at` TEXT NOT NULL, PRIMARY KEY(`query`))",
            "CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)",
            "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '18b3cdde619736728cc3bbe4c40ebb88')",
        )

        /** v4 建表语句：v3 各表但 search_history.at 改 INTEGER（epochMillis，BUG-17）+ v4 identity_hash（schemas/.../4.json）。 */
        val V4_STATEMENTS = V3_STATEMENTS.dropLast(3) + listOf(
            "CREATE TABLE IF NOT EXISTS `search_history` (`query` TEXT NOT NULL, `at` INTEGER NOT NULL, PRIMARY KEY(`query`))",
            "CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)",
            "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, 'afd39d6ad488151488467d6d1b95d215')",
        )
    }
}
