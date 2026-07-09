package com.bluskysoftware.yandegallery.data.db

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort

/** 时间轴分页查询（spec §3.3）：ORDER BY 由 PhotoSort 白名单枚举拼接（无用户输入，无注入面）。 */
fun buildTimelineQuery(sort: PhotoSort): SupportSQLiteQuery =
    SimpleSQLiteQuery("SELECT * FROM images ORDER BY ${sort.orderBy()}")

/** 图集成员分页查询（spec §5.1）：同款排序白名单；galleryId 走绑定参数。 */
fun buildGalleryImagesQuery(galleryId: Long, sort: PhotoSort): SupportSQLiteQuery =
    SimpleSQLiteQuery(
        """SELECT i.* FROM images i
           JOIN gallery_images gi ON gi.imageId = i.id
           WHERE gi.galleryId = ?
           ORDER BY ${sort.orderBy("i.")}""",
        arrayOf<Any>(galleryId),
    )
