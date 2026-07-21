package com.bluskysoftware.yandegallery.data.device

import android.app.PendingIntent
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import androidx.paging.PagingSource
import androidx.paging.PagingState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.OutputStream

/** queryAlbums 聚合中间行（spec §4.3）：DeviceMedia 不带 bucket 信息，聚合前显式携带，供 [aggregateAlbums] 消费。 */
internal data class AlbumRow(val media: DeviceMedia, val bucketId: Long, val bucketName: String)

/** 按 BUCKET_ID 分组聚合真实相册：计数、封面取组内 takenAtMs 最大行、名称/相对路径取首行；不含待落地、不排序（排序统一交给 [sortDeviceAlbums]）。 */
internal fun aggregateAlbums(rows: List<AlbumRow>): List<DeviceAlbum> =
    rows.groupBy { it.bucketId }.map { (bucketId, group) ->
        val cover = group.maxByOrNull { it.media.takenAtMs }!!  // group 来自 groupBy 的分组，非空保证成立
        DeviceAlbum(
            key = BucketKey.Bucket(bucketId),
            name = group.first().bucketName,
            relativePath = group.first().media.relativePath,
            count = group.size,
            coverUri = cover.media.uri,
            isPending = false,
        )
    }

/** 统一 Files 查询投影（spec §4）：26–28 无 RELATIVE_PATH 列（29+ 才有），不进投影，改由 DATA 全路径回退推导。 */
private fun buildProjection(): Array<String> {
    val columns = mutableListOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.BUCKET_ID,
        MediaStore.Files.FileColumns.BUCKET_DISPLAY_NAME,
        MediaStore.Files.FileColumns.DISPLAY_NAME,
        MediaStore.Files.FileColumns.MIME_TYPE,
        MediaStore.Files.FileColumns.MEDIA_TYPE,
        MediaStore.Files.FileColumns.WIDTH,
        MediaStore.Files.FileColumns.HEIGHT,
        MediaStore.Files.FileColumns.SIZE,
        MediaStore.Files.FileColumns.DATE_TAKEN,
        MediaStore.Files.FileColumns.DATE_MODIFIED,
        MediaStore.Files.FileColumns.DURATION,
        MediaStore.Files.FileColumns.DATA,
    )
    if (Build.VERSION.SDK_INT >= 29) columns += MediaStore.Files.FileColumns.RELATIVE_PATH
    return columns.toTypedArray()
}

/** 游标列索引一次性解析（避免逐行重复做字符串列名查找）；RELATIVE_PATH 未投影时为 -1。 */
private class MediaColumnIndices(cursor: Cursor) {
    val id = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
    val bucketId = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.BUCKET_ID)
    val bucketName = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.BUCKET_DISPLAY_NAME)
    val displayName = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
    val mediaType = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
    val width = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.WIDTH)
    val height = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.HEIGHT)
    val size = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
    val dateTaken = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_TAKEN)
    val dateModified = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
    val duration = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DURATION)
    val data = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATA)
    val relativePath = cursor.getColumnIndex(MediaStore.Files.FileColumns.RELATIVE_PATH)
}

/** 26–28 用 DATA 全路径回退推导 relativePath：截取 `/storage/emulated/0/` 之后的目录段（含末尾 `/`）。 */
private fun relativePathFromData(data: String): String {
    val afterRoot = data.substringAfter("/storage/emulated/0/", data)
    val lastSlash = afterRoot.lastIndexOf('/')
    return if (lastSlash >= 0) afterRoot.substring(0, lastSlash + 1) else ""
}

/** 游标当前行 → DeviceMedia：uri 按 MEDIA_TYPE 换算成具体类型 uri（Files 联合 uri 不能直接用于删除/写请求）。 */
private fun Cursor.readMedia(idx: MediaColumnIndices): DeviceMedia {
    val id = getLong(idx.id)
    val isVideo = getInt(idx.mediaType) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
    val contentUri = if (isVideo) {
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    }
    val rawRelativePath = if (idx.relativePath >= 0) getString(idx.relativePath) else null
    val relativePath = rawRelativePath ?: relativePathFromData(getString(idx.data) ?: "")
    // getLong 对 NULL 值返回 0；DATE_TAKEN=0（1970 纪元）从不是真实拍摄时间，按"无效"处理回退
    val dateTaken = getLong(idx.dateTaken)
    val takenAtMs = if (dateTaken > 0L) dateTaken else getLong(idx.dateModified) * 1000
    return DeviceMedia(
        mediaId = id,
        uri = ContentUris.withAppendedId(contentUri, id),
        isVideo = isVideo,
        displayName = getString(idx.displayName) ?: "",
        relativePath = relativePath,
        width = getInt(idx.width),
        height = getInt(idx.height),
        sizeBytes = getLong(idx.size),
        takenAtMs = takenAtMs,
        durationMs = if (isVideo) getLong(idx.duration) else null,
    )
}

/**
 * 手机域 MediaStore 网关实现（spec §4/§5/§6）。查询统一走 `MediaStore.Files` 联合 uri；
 * 行内单条 uri 按媒体类型换算到 Images/Video EXTERNAL_CONTENT_URI（删除/写请求要求具体类型 uri，
 * Files uri 不行）。版本差异仅体现在 RELATIVE_PATH 投影与调用方的 [DeviceCapabilities] 门控判断，
 * 本类内部不重复判断 29/30 分支。
 */
class MediaStoreDeviceGateway(private val context: Context) : DeviceMediaGateway {

    private val resolver get() = context.contentResolver

    private val filesUri: Uri = MediaStore.Files.getContentUri("external")

    override suspend fun queryAlbums(): List<DeviceAlbum> = withContext(Dispatchers.IO) {
        val rows = mutableListOf<AlbumRow>()
        resolver.query(filesUri, buildProjection(), MEDIA_TYPE_SELECTION, MEDIA_TYPE_ARGS, null)?.use { cursor ->
            val idx = MediaColumnIndices(cursor)
            while (cursor.moveToNext()) {
                rows += AlbumRow(
                    media = cursor.readMedia(idx),
                    bucketId = cursor.getLong(idx.bucketId),
                    bucketName = cursor.getString(idx.bucketName) ?: "",
                )
            }
        }
        aggregateAlbums(rows)
    }

    override fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia> = DeviceMediaPagingSource(key)

    /**
     * 分页取一页（时间倒序，DATE_TAKEN DESC, _ID DESC）。
     * Android 11+（API 30+）MediaProvider 会拒绝 sortOrder 里的 `LIMIT` token
     * （`IllegalArgumentException: Invalid token LIMIT`，真机联调确证），必须改走 Bundle 的
     * `QUERY_ARG_LIMIT`/`QUERY_ARG_OFFSET`；API 26–29 仍把 `LIMIT/OFFSET` 拼进排序串（旧路可用）。
     * 排序不能用 `QUERY_ARG_SORT_COLUMNS`+`QUERY_ARG_SORT_DIRECTION`：AOSP `createSqlSortClause`
     * 先 join 列名再整体追加一次 ` DESC`，产出 `datetaken, _id DESC`——DESC 只绑末列，DATE_TAKEN
     * 实际按 ASC 排，真机 API30+ 网格最旧优先（adb 推的测试图 datetaken 为空、靠 _id 兜底才没暴露）。
     * 改用 `QUERY_ARG_SQL_SORT_ORDER` 显式逐列 DESC：SORT_COLUMNS 缺席时 MediaProvider 直接采纳
     * 该串，且逐列 DESC 能过 R+ 严格语法校验（守卫只拒 LIMIT token），与低版本字符串序字节一致。
     */
    private fun queryPage(selection: String, args: Array<String>, limit: Int, offset: Int): Cursor? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val queryArgs = Bundle().apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args)
                putString(
                    ContentResolver.QUERY_ARG_SQL_SORT_ORDER,
                    "${MediaStore.Files.FileColumns.DATE_TAKEN} DESC, ${MediaStore.Files.FileColumns._ID} DESC",
                )
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
                putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
            }
            resolver.query(filesUri, buildProjection(), queryArgs, null)
        } else {
            val sortOrder = "${MediaStore.Files.FileColumns.DATE_TAKEN} DESC, " +
                "${MediaStore.Files.FileColumns._ID} DESC LIMIT $limit OFFSET $offset"
            resolver.query(filesUri, buildProjection(), selection, args, sortOrder)
        }

    override suspend fun mediaByIds(ids: List<Long>): List<DeviceMedia> = withContext(Dispatchers.IO) {
        if (ids.isEmpty()) return@withContext emptyList()
        val placeholders = ids.joinToString(",") { "?" }
        val selection = "$MEDIA_TYPE_SELECTION AND ${MediaStore.Files.FileColumns._ID} IN ($placeholders)"
        val args = MEDIA_TYPE_ARGS + Array(ids.size) { ids[it].toString() }
        val result = mutableListOf<DeviceMedia>()
        resolver.query(filesUri, buildProjection(), selection, args, null)?.use { cursor ->
            val idx = MediaColumnIndices(cursor)
            while (cursor.moveToNext()) result += cursor.readMedia(idx)
        }
        result
    }

    override fun observeChanges(): Flow<Unit> = callbackFlow {
        val handler = Handler(Looper.getMainLooper())
        val imagesObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) { trySend(Unit) }
        }
        val videoObserver = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) { trySend(Unit) }
        }
        resolver.registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, imagesObserver)
        resolver.registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, videoObserver)
        awaitClose {
            resolver.unregisterContentObserver(imagesObserver)
            resolver.unregisterContentObserver(videoObserver)
        }
    }

    override suspend fun insertCopy(source: DeviceSource, targetRelativePath: String): Result<Uri> =
        withContext(Dispatchers.IO) {
            val displayName = when (source) {
                is DeviceSource.Media -> source.media.displayName
                is DeviceSource.LocalFile -> source.displayName
            }
            val mime = resolveMime(source)
            val collectionUri = if (mime.startsWith("video/")) {
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            } else {
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, targetRelativePath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            // 同名冲突 MediaStore 自动改名（同目录下重名 DISPLAY_NAME 自动追加后缀），无需本层处理
            var uri: Uri? = null
            try {
                uri = resolver.insert(collectionUri, values)
                    ?: return@withContext Result.failure<Uri>(IOException("MediaStore insert 失败：$collectionUri"))

                val out = resolver.openOutputStream(uri) ?: throw IOException("无法打开输出流：$uri")
                out.use { copyBytes(source, it) }
                val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                resolver.update(uri, done, null, null)
                Result.success(uri)
            } catch (e: CancellationException) {
                uri?.let { resolver.delete(it, null, null) }   // 半成品行清理后不吞取消，重抛
                throw e
            } catch (e: Exception) {
                uri?.let { resolver.delete(it, null, null) }   // 失败清理半成品行（brief 约定）
                Result.failure(e)
            }
        }

    override suspend fun findCopy(targetRelativePath: String, displayName: String): Uri? =
        withContext(Dispatchers.IO) {
            // 26–28 无 RELATIVE_PATH 列，查询会抛列不存在；导出/复制本就被 canCopy 挡在 29+，恒判无副本
            if (Build.VERSION.SDK_INT < 29) return@withContext null
            // MediaStore 落库时把 RELATIVE_PATH 规范成带尾斜杠形态，查询入参对齐同口径
            val normalizedPath = if (targetRelativePath.endsWith("/")) targetRelativePath else "$targetRelativePath/"
            val projection = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE)
            val selection = "$MEDIA_TYPE_SELECTION AND ${MediaStore.Files.FileColumns.RELATIVE_PATH} = ? " +
                "AND ${MediaStore.Files.FileColumns.DISPLAY_NAME} = ?"
            val args = MEDIA_TYPE_ARGS + arrayOf(normalizedPath, displayName)
            // IS_PENDING=1 半成品行对默认查询不可见（29+ MediaStore 语义）——写到一半即中断的行不会误判命中
            resolver.query(filesUri, projection, selection, args, null)?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val id = cursor.getLong(0)
                val isVideo = cursor.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val contentUri = if (isVideo) {
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                } else {
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                }
                ContentUris.withAppendedId(contentUri, id)
            }
        }

    override suspend fun moveTo(uris: List<Uri>, targetRelativePath: String): Result<Int> =
        withContext(Dispatchers.IO) {
            if (uris.isEmpty()) return@withContext Result.success(0)
            val values = ContentValues().apply { put(MediaStore.MediaColumns.RELATIVE_PATH, targetRelativePath) }
            var successCount = 0
            var lastError: Exception? = null
            for (uri in uris) {
                try {
                    successCount += resolver.update(uri, values, null, null)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    lastError = e   // 单条失败跳过、继续后续（授权已由调用方先走 writeRequest 取得）
                }
            }
            if (successCount == 0 && lastError != null) Result.failure(lastError) else Result.success(successCount)
        }

    @RequiresApi(30)
    override fun deleteRequest(uris: List<Uri>): PendingIntent = MediaStore.createDeleteRequest(resolver, uris)

    @RequiresApi(30)
    override fun writeRequest(uris: List<Uri>): PendingIntent = MediaStore.createWriteRequest(resolver, uris)

    /** DeviceMedia 不带 mime 字段（Task 2 模型未设该列）：复制时经 ContentResolver 反查，查不到按 isVideo 兜底。 */
    private fun resolveMime(source: DeviceSource): String = when (source) {
        is DeviceSource.LocalFile -> source.mime
        is DeviceSource.Media -> resolver.getType(source.media.uri)
            ?: if (source.media.isVideo) "video/*" else "image/*"
    }

    /** 字节拷贝（约定同 ImageMirrorStore：64KB 缓冲手动读写循环）；输入源按 [DeviceSource] 二态切换。 */
    private fun copyBytes(source: DeviceSource, out: OutputStream) {
        val input = when (source) {
            is DeviceSource.Media -> resolver.openInputStream(source.media.uri)
                ?: throw IOException("无法打开输入流：${source.media.uri}")
            is DeviceSource.LocalFile -> source.file.inputStream()
        }
        input.use { inp ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = inp.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
            }
        }
    }

    /** 相册网格分页（spec §4.3）：时间倒序，经 [queryPage] 分页（30+ Bundle 参数 / ≤29 LIMIT 拼串）；Bucket 加 BUCKET_ID 过滤，Pending 恒空页。 */
    private inner class DeviceMediaPagingSource(private val key: BucketKey) : PagingSource<Int, DeviceMedia>() {
        override fun getRefreshKey(state: PagingState<Int, DeviceMedia>): Int? {
            val anchor = state.anchorPosition ?: return null
            val page = state.closestPageToPosition(anchor) ?: return null
            return page.prevKey?.plus(state.config.pageSize) ?: page.nextKey?.minus(state.config.pageSize)
        }

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, DeviceMedia> =
            withContext(Dispatchers.IO) {
                if (key is BucketKey.Pending) return@withContext LoadResult.Page(emptyList(), null, null)
                val offset = params.key ?: 0
                val limit = params.loadSize
                try {
                    val bucket = key as? BucketKey.Bucket
                    val selection = if (bucket != null) {
                        "$MEDIA_TYPE_SELECTION AND ${MediaStore.Files.FileColumns.BUCKET_ID} = ?"
                    } else {
                        MEDIA_TYPE_SELECTION
                    }
                    val args = if (bucket != null) MEDIA_TYPE_ARGS + bucket.bucketId.toString() else MEDIA_TYPE_ARGS
                    val items = mutableListOf<DeviceMedia>()
                    queryPage(selection, args, limit, offset)?.use { cursor ->
                        val idx = MediaColumnIndices(cursor)
                        while (cursor.moveToNext()) items += cursor.readMedia(idx)
                    }
                    val prevKey = if (offset == 0) null else maxOf(0, offset - limit)
                    val nextKey = if (items.size < limit) null else offset + limit
                    LoadResult.Page(items, prevKey, nextKey)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    LoadResult.Error(e)
                }
            }
    }

    companion object {
        private val MEDIA_TYPE_SELECTION = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (?, ?)"
        private val MEDIA_TYPE_ARGS = arrayOf(
            MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
            MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
        )
    }
}
