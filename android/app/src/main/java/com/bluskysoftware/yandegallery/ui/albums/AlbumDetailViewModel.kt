package com.bluskysoftware.yandegallery.ui.albums

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * 图集详情（M2 只读——新建/重命名/删除是 M3 写操作 UI）。
 */
class AlbumDetailViewModel(private val graph: AppGraph, private val galleryId: Long) : ViewModel() {

    /** 缩略图专用 loader（Task 9），图片格子直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：非 null 时提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 图集标题：随 galleries 表变化更新，不额外加 DAO 方法，复用 observeAll。 */
    val title: Flow<String> =
        graph.db.galleryDao().observeAll().map { galleries ->
            galleries.firstOrNull { it.id == galleryId }?.name.orEmpty()
        }

    /** 图集内图片分页：galleryImagesPagingSource 已按 createdAt DESC 排序，此处无日期分组。 */
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            graph.db.galleryDao().galleryImagesPagingSource(galleryId)
        }.flow.cachedIn(viewModelScope)

    companion object {
        fun factory(graph: AppGraph, galleryId: Long): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumDetailViewModel(graph, galleryId) }
        }
    }
}
