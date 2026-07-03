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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** 图集卡片：cover 优先取 gallery.coverImageId，为空时兜底取图集内最新一张（spec §7.2）。 */
data class AlbumCard(val gallery: GalleryEntity, val coverImageId: Long?)

class AlbumsViewModel(private val graph: AppGraph) : ViewModel() {

    /** 缩略图专用 loader（Task 9），卡片封面直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：非 null 时提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * 图集卡片流：单查询 observeAlbumCards 一次带回图集 + 相关子查询算出的兜底封面 id，
     * 无 N+1（不再对每个 coverImageId==null 的图集逐个回查 coverFallback）。
     * cover 优先 gallery.coverImageId，为空时用兜底（图集内最新一张，spec §7.2）。
     */
    val albums: Flow<List<AlbumCard>> =
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
        }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumsViewModel(graph) }
        }
    }
}
