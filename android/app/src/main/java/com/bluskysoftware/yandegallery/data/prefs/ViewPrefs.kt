package com.bluskysoftware.yandegallery.data.prefs

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * 视图偏好共享态（spec §2.3/§3.4）：排序/列数的内存真源，DataStore 只是持久化介质
 * （PhotosViewModel 密度档 BUG-18 同款「内存态为准」模式）。挂 AppGraph 单例：照片/相册/
 * 详情三个 VM 与 ViewerViewModel 共读同一实例——Viewer 开页同步读 `.value` 取当前排序，
 * 网格与大图翻页顺序不错位（spec §3.4）。
 */
class ViewPrefs(private val prefs: PrefsStore, private val scope: CoroutineScope) {

    private val _photoSort = MutableStateFlow(PhotoSort.DEFAULT)
    val photoSort: StateFlow<PhotoSort> = _photoSort.asStateFlow()

    private val _albumsSort = MutableStateFlow(AlbumSort.DEFAULT)
    val albumsSort: StateFlow<AlbumSort> = _albumsSort.asStateFlow()

    private val _detailSort = MutableStateFlow(PhotoSort.DEFAULT)
    val detailSort: StateFlow<PhotoSort> = _detailSort.asStateFlow()

    private val _detailColumns = MutableStateFlow(DEFAULT_DETAIL_COLUMNS)
    val detailColumns: StateFlow<Int> = _detailColumns.asStateFlow()

    // 落盘串行化（审查 minor）：scope 是多线程 IO，若每个 setter 各自 launch，快速连写同一键
    // （捏合逐档换列/排序二连击）可被不同 worker 乱序执行——内存真源正确但磁盘留下较旧的值，
    // 重启回退一步。单消费者 Channel 按 setter 调用顺序串行执行 DataStore 写。
    private val persistQueue = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (op in persistQueue) {
                try {
                    op()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w("ViewPrefs", "视图偏好落盘失败（内存态不受影响）", e)
                }
            }
        }
        // 冷启动回填一次；compareAndSet 防手快用户被回冲（密度档同款）
        scope.launch {
            _photoSort.compareAndSet(PhotoSort.DEFAULT, PhotoSort.fromName(prefs.photosSortName.first()))
            _albumsSort.compareAndSet(AlbumSort.DEFAULT, AlbumSort.fromName(prefs.albumsSortName.first()))
            _detailSort.compareAndSet(PhotoSort.DEFAULT, PhotoSort.fromName(prefs.albumDetailSortName.first()))
            prefs.albumDetailColumns.first()?.let { persisted ->
                _detailColumns.compareAndSet(DEFAULT_DETAIL_COLUMNS, persisted.coerceIn(MIN_DETAIL_COLUMNS, MAX_DETAIL_COLUMNS))
            }
        }
    }

    fun setPhotoSort(sort: PhotoSort) {
        _photoSort.value = sort
        persistQueue.trySend { prefs.setPhotosSortName(sort.name) }
    }

    fun setAlbumsSort(sort: AlbumSort) {
        _albumsSort.value = sort
        persistQueue.trySend { prefs.setAlbumsSortName(sort.name) }
    }

    fun setDetailSort(sort: PhotoSort) {
        _detailSort.value = sort
        persistQueue.trySend { prefs.setAlbumDetailSortName(sort.name) }
    }

    fun setDetailColumns(columns: Int) {
        val clamped = columns.coerceIn(MIN_DETAIL_COLUMNS, MAX_DETAIL_COLUMNS)
        _detailColumns.value = clamped
        persistQueue.trySend { prefs.setAlbumDetailColumns(clamped) }
    }

    companion object {
        const val DEFAULT_DETAIL_COLUMNS = 4
        const val MIN_DETAIL_COLUMNS = 3
        const val MAX_DETAIL_COLUMNS = 5
    }
}
