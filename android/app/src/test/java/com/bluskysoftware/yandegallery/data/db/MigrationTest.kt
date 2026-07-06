package com.bluskysoftware.yandegallery.data.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
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

        // 2) 用 Room 打开并注册迁移链——触发 2→3 迁移与 v3 schema 校验
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
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

        // 2) 用 Room 打开同一文件并注册迁移链（库现为 v3，1→2→3 全链）——触发迁移与最终 schema 校验
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
            .allowMainThreadQueries()
            .build()
        try {
            // 迁移后 images 旧数据保留
            assertEquals(1L, db.imageDao().countAll())
            assertEquals("a.jpg", db.imageDao().byId(1)?.filename)

            // search_history 表存在
            db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='search_history'", null)
                .use { assertTrue(it.moveToFirst()) }

            // 且可用：写入并读回一条搜索历史
            db.searchHistoryDao().upsert(SearchHistoryEntity("neko", "2026-07-05T00:00:00.000Z"))
            db.query("SELECT COUNT(*) FROM search_history", null)
                .use { assertTrue(it.moveToFirst()); assertEquals(1, it.getInt(0)) }
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
    }
}
