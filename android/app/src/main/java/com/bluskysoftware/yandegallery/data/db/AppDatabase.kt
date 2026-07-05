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
        SearchHistoryEntity::class,
    ],
    version = 3,
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

        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "yande-gallery.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()

        // inMemory 每次全新建库，无历史版本，无需注册迁移。
        fun inMemory(context: Context): AppDatabase =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
