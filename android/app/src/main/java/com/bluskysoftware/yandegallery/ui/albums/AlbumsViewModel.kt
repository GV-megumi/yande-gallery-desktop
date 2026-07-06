package com.bluskysoftware.yandegallery.ui.albums

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** 图集卡片：cover 优先取 gallery.coverImageId，为空时兜底取图集内最新一张（spec §7.2）。 */
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
     * 图集卡片流（M4-T15 三态 stateIn）：单查询 observeAlbumCards 一次带回图集 + 相关子查询算出的兜底
     * 封面 id，无 N+1（不再对每个 coverImageId==null 的图集逐个回查）。cover 优先 gallery.coverImageId，
     * 为空时用兜底（图集内最新一张，spec §7.2）。
     *
     * 一石二鸟（stateIn(WhileSubscribed, null)）：① 裸冷 Flow 每订阅重跑 Room 查询（A1）→ 共享一份；
     * ② 初始 null 作「加载中」哨兵，AlbumsScreen 据此在 DB 首发射前渲染空白而非 AlbumsEmpty，
     * 消除已有图集用户冷启动的空态闪帧（A7）。null=加载中 / 空列表=确无图集 / 非空=有图集。
     */
    val albums: StateFlow<List<AlbumCard>?> =
        graph.db.galleryDao().observeAlbumCards().map { rows ->
            rows.map { row ->
                AlbumCard(
                    gallery = GalleryEntity(
                        id = row.id,
                        name = row.name,
                        coverImageId = row.coverImageId,
                        imageCount = row.imageCount,
                    ),
                    coverImageId = row.coverImageId ?: row.fallbackCoverId,
                )
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 新建图集：委托 WriteRepository（乐观镜像 → 服务端 → 失败不新增行）；Screen 据结果提示。 */
    suspend fun createGallery(name: String): WriteResult = writeRepository.createGallery(name)

    /** 重命名图集：委托 WriteRepository（乐观改名 → 服务端 → 失败回滚旧名）。 */
    suspend fun renameGallery(galleryId: Long, name: String): WriteResult =
        writeRepository.renameGallery(galleryId, name)

    /** 删除图集：委托 WriteRepository（乐观删镜像行+成员链 → 服务端；不删图片本体，spec §8）。 */
    suspend fun deleteGallery(galleryId: Long): WriteResult = writeRepository.deleteGallery(galleryId)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumsViewModel(graph) }
        }
    }
}
