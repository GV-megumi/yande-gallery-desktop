package com.bluskysoftware.yandegallery.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        ImageEntity::class, GalleryEntity::class, GalleryImageEntity::class,
        TagEntity::class, ImageTagEntity::class,
        ServerEntity::class, SyncStateEntity::class, DownloadEntity::class,
        SearchHistoryEntity::class, AlbumPrefsEntity::class, ImageFileEntity::class,
    ],
    version = 6,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun imageDao(): ImageDao
    abstract fun galleryDao(): GalleryDao
    abstract fun tagDao(): TagDao
    abstract fun serverDao(): ServerDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun downloadDao(): DownloadDao
    abstract fun searchHistoryDao(): SearchHistoryDao
    abstract fun albumPrefsDao(): AlbumPrefsDao
    abstract fun imageFileDao(): ImageFileDao

    companion object {
        // v1→2：新增 search_history 表（其余表不变）。CREATE 语句须与 Room 对该实体的期望逐字一致。
        val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `search_history` (`query` TEXT NOT NULL, `at` TEXT NOT NULL, PRIMARY KEY(`query`))")
            }
        }

        // v2→3：downloads 换 (serverId, imageId) 复合主键。旧行直接丢弃——downloads 是易失
        // 映射（clearMirror 随时清），无迁移价值；丢行只导致「已下载」标记消失，文件仍在系统相册。
        val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS `downloads`")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `downloads` (`serverId` INTEGER NOT NULL, " +
                        "`imageId` INTEGER NOT NULL, `mediaStoreUri` TEXT NOT NULL, " +
                        "`downloadedAt` TEXT NOT NULL, PRIMARY KEY(`serverId`, `imageId`))"
                )
            }
        }

        // v3→4（BUG-17）：search_history.at 由 ISO 文本改 epochMillis 整数——Instant.toString()
        // 整秒会省略小数位（.000 消失），TEXT 字典序 ORDER BY at DESC 混排错位。老行在 Kotlin 侧
        // 解析换算后搬入新表（SQLite strftime 对尾缀 Z 的支持跨版本不稳，不用 SQL 转换）；
        // 解析失败的行按 0 兜底（排到最老，不丢词）。
        val MIGRATION_3_4 = object : androidx.room.migration.Migration(3, 4) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `search_history_new` " +
                        "(`query` TEXT NOT NULL, `at` INTEGER NOT NULL, PRIMARY KEY(`query`))"
                )
                db.query("SELECT `query`, `at` FROM `search_history`").use { c ->
                    while (c.moveToNext()) {
                        val q = c.getString(0)
                        val at = runCatching { java.time.Instant.parse(c.getString(1)).toEpochMilli() }
                            .getOrDefault(0L)
                        db.execSQL(
                            "INSERT OR REPLACE INTO `search_history_new` (`query`, `at`) VALUES (?, ?)",
                            arrayOf(q, at),
                        )
                    }
                }
                db.execSQL("DROP TABLE `search_history`")
                db.execSQL("ALTER TABLE `search_history_new` RENAME TO `search_history`")
            }
        }

        // v4→5（v0.6 功能补全）：galleries 补 createdAt（同步载荷新字段，旧行 NULL）；
        // 新建 album_prefs（置顶/其他相册/手动序本机态，spec §2.1）。
        val MIGRATION_4_5 = object : androidx.room.migration.Migration(4, 5) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `galleries` ADD COLUMN `createdAt` TEXT")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `album_prefs` (`galleryId` INTEGER NOT NULL, " +
                        "`pinned` INTEGER NOT NULL, `pinnedAt` INTEGER, " +
                        "`inOther` INTEGER NOT NULL, `manualOrder` INTEGER, " +
                        "PRIMARY KEY(`galleryId`))"
                )
            }
        }

        // v5→6（镜像层 spec §3.2）：新建 image_files 登记表。downloads 表暂保留——计划期两步走，
        // 下载/分享链路逐任务切换期间新旧表并存可编译可测；v7（收尾任务）再 DROP。
        val MIGRATION_5_6 = object : androidx.room.migration.Migration(5, 6) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `image_files` (`serverId` INTEGER NOT NULL, " +
                        "`imageId` INTEGER NOT NULL, `tier` TEXT NOT NULL, `relPath` TEXT NOT NULL, " +
                        "`bytes` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`serverId`, `imageId`))"
                )
            }
        }

        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "yande-gallery.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
                .build()

        // inMemory 每次全新建库，无历史版本，无需注册迁移。
        fun inMemory(context: Context): AppDatabase =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
