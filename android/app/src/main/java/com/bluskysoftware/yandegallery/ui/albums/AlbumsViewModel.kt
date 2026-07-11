package com.bluskysoftware.yandegallery.ui.albums

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.room.withTransaction
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** 相册卡片：cover 优先取 gallery.coverImageId，为空时兜底取相册内最新一张（spec §7.2）。 */
data class AlbumCard(val gallery: GalleryEntity, val coverImageId: Long?)

class AlbumsViewModel(
    private val graph: AppGraph,
    private val writeRepository: WriteRepository = graph.writeRepository,  // 测试注入缝（镜像 AlbumDetailViewModel gateway 模式）
) : ViewModel() {

    /** 缩略图专用 loader（Task 9），卡片封面直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：非 null 时提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 连接状态：新建/长按写入口离线置灰（Screen collectAsState 驱动 FAB 与卡片菜单可用性）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /**
     * 三分区卡片流（v0.6 spec §4.2；沿用 M4-T15 三态哨兵：null=加载中/isEmpty=确无相册）。
     * 卡片 + 组织偏好 + 排序三源 combine，组装收敛在 assembleAlbumSections 纯函数。
     * 单查询 observeAlbumCards 一次带回相册 + 相关子查询算出的兜底封面 id，无 N+1；
     * cover 优先 gallery.coverImageId，为空时用兜底（相册内最新一张，spec §7.2）。
     *
     * 一石二鸟（stateIn(WhileSubscribed, null)）：① 裸冷 Flow 每订阅重跑 Room 查询（A1）→ 共享一份；
     * ② 初始 null 作「加载中」哨兵，AlbumsScreen 据此在 DB 首发射前渲染空白而非 AlbumsEmpty，
     * 消除已有相册用户冷启动的空态闪帧（A7）。
     */
    val sections: StateFlow<AlbumSections?> =
        combine(
            graph.db.galleryDao().observeAlbumCards(),
            graph.db.albumPrefsDao().observeAll(),
            graph.viewPrefs.albumsSort,
        ) { rows, prefs, sort ->
            val cards = rows.map { row ->
                AlbumCard(
                    gallery = GalleryEntity(row.id, row.name, row.coverImageId, row.imageCount, row.createdAt),
                    coverImageId = row.coverImageId ?: row.fallbackCoverId,
                )
            }
            assembleAlbumSections(cards, prefs.associateBy { it.galleryId }, sort)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 相册排序（v0.6 spec §4.4）。 */
    val albumsSort: StateFlow<AlbumSort> = graph.viewPrefs.albumsSort

    fun setAlbumsSort(sort: AlbumSort) = graph.viewPrefs.setAlbumsSort(sort)

    /** 置顶/取消置顶（纯本机，离线可用，spec §4.3）；互斥与清手动序在 DAO 事务内收敛。 */
    fun setPinned(galleryId: Long, pinned: Boolean) {
        viewModelScope.launch { graph.db.albumPrefsDao().setPinned(galleryId, pinned, System.currentTimeMillis()) }
    }

    /** 移入/移出「其他相册」（纯本机，离线可用）。 */
    fun setInOther(galleryId: Long, inOther: Boolean) {
        viewModelScope.launch { graph.db.albumPrefsDao().setInOther(galleryId, inOther) }
    }

    /**
     * 拖拽落盘（spec §4.5）：两分区分别重编号 0..n（manualOrder 只在区内比较）+ 排序自动切手动。
     * 两次 applyManualOrder 包同一 db.withTransaction（评审修复）：中途取消/崩溃不会出现
     * 「置顶区已重编号、普通区没写、排序未切」的半保存。挂 viewModelScope 返回 Job——「完成」
     * 是用户已确认的操作，VM 随 nav entry 存活，点完立刻切 tab/旋转也不丢；Screen 侧 join
     * 该 Job 保持「落盘完成才退重排」的时序。
     */
    fun commitManualOrder(pinned: List<Long>, normal: List<Long>): Job = viewModelScope.launch {
        graph.db.withTransaction {
            graph.db.albumPrefsDao().applyManualOrder(pinned)
            graph.db.albumPrefsDao().applyManualOrder(normal)
        }
        graph.viewPrefs.setAlbumsSort(AlbumSort.MANUAL)
    }

    /** 新建相册：委托 WriteRepository（乐观镜像 → 服务端 → 失败不新增行）；Screen 据结果提示。 */
    suspend fun createGallery(name: String): WriteResult = writeRepository.createGallery(name)

    /** 重命名相册：委托 WriteRepository（乐观改名 → 服务端 → 失败回滚旧名）。 */
    suspend fun renameGallery(galleryId: Long, name: String): WriteResult =
        writeRepository.renameGallery(galleryId, name)

    /** 删除相册：委托 WriteRepository（乐观删镜像行+成员链 → 服务端；不删图片本体，spec §8）。 */
    suspend fun deleteGallery(galleryId: Long): WriteResult = writeRepository.deleteGallery(galleryId)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumsViewModel(graph) }
        }
    }
}
