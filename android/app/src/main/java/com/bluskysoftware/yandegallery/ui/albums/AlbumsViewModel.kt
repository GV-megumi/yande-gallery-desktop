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
     * 图集卡片流：observeAll 逐个补封面兜底——只有 coverImageId 为空的图集才额外查 coverFallback
     * （图集内最新一张），有封面的图集不多查。
     */
    val albums: Flow<List<AlbumCard>> =
        graph.db.galleryDao().observeAll().map { galleries ->
            galleries.map { gallery ->
                AlbumCard(
                    gallery = gallery,
                    coverImageId = gallery.coverImageId
                        ?: graph.db.galleryDao().coverFallback(gallery.id)?.id,
                )
            }
        }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumsViewModel(graph) }
        }
    }
}
