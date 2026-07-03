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
    ],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun imageDao(): ImageDao
    abstract fun galleryDao(): GalleryDao
    abstract fun tagDao(): TagDao
    abstract fun serverDao(): ServerDao
    abstract fun syncStateDao(): SyncStateDao
    abstract fun downloadDao(): DownloadDao

    companion object {
        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "yande-gallery.db").build()

        fun inMemory(context: Context): AppDatabase =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
