package com.bluskysoftware.yandegallery.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.SearchHistoryEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.db.buildSearchQuery
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

// 多词切分（BUG-11）：Java \s 不含全角空格 U+3000（中文输入法空格键常见产物），须显式并入，
// 否则「词甲　词乙」整串当一个词、AND 交集失效
private val TERM_SPLIT_REGEX = Regex("[\\s　]+")

/**
 * 搜索页 ViewModel（Task 12）：即时输入 → debounce 重建搜索分页 + 搜索历史读写。
 *
 * pagingFlow 走 [buildSearchQuery]（多词 AND 交集：每词命中「某标签名前缀 OR 文件名包含」，
 * 空词退化全表倒序，与时间轴同序）。query 每次变化 200ms 内合并，flatMapLatest 取消上一个
 * Pager 流后重建，避免快速输入时残留分页源。thumbnailLoader/activeServer 供结果网格复用时间轴管线。
 */
/** 已终结的空分页状态：三向 NotLoading 且 endOfPaginationReached=true（空查询占位页用）。 */
private val SETTLED_EMPTY_LOAD_STATES = LoadStates(
    refresh = LoadState.NotLoading(endOfPaginationReached = true),
    prepend = LoadState.NotLoading(endOfPaginationReached = true),
    append = LoadState.NotLoading(endOfPaginationReached = true),
)

class SearchViewModel(private val graph: AppGraph) : ViewModel() {

    /** 缩略图 loader（复用时间轴管线，结果格子直接消费）。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：提供 baseUrl / id 拼缩略图缓存键。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** DB 首发射后翻 true（照片页 A7 同款三态门）：activeServer 初值 null 分不清「尚未答复」
     *  与「确认无服务器」——标签跳入搜索（initialQuery 预填）会闪现无服务器引导文案（审查 minor）。 */
    val activeServerResolved: StateFlow<Boolean> =
        graph.serverRepository.observeActive().map { true }
            .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val _query = MutableStateFlow("")

    /** 当前搜索词：onQueryChange 逐字即时更新（UI 输入框绑定），pagingFlow 另经 debounce。 */
    val query: StateFlow<String> = _query.asStateFlow()

    fun onQueryChange(s: String) {
        _query.value = s
    }

    /**
     * 搜索分页流：query.debounce(200) → flatMapLatest 重建 Pager（searchPagingSource + buildSearchQuery），
     * 配置镜像时间轴（pageSize=120, 无占位）。cachedIn 让配置变更与旋转屏共享一份分页。
     */
    @OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        _query.debounce(200)
            .flatMapLatest { q ->
                if (q.isBlank()) {
                    // 空查询不建 Pager：历史 chips 界面不再白做全表首页查询（M4-T14）。
                    // 空页显式标 endOfPaginationReached=true——否则消费方（LazyPagingItems/asSnapshot）
                    // 会误以为还有下一页可 append 而一直等待。
                    flowOf(PagingData.empty(SETTLED_EMPTY_LOAD_STATES))
                } else {
                    Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                        graph.db.imageDao().searchPagingSource(buildSearchQuery(q.split(TERM_SPLIT_REGEX)))
                    }.flow
                }
            }
            .cachedIn(viewModelScope)

    /** 搜索历史（最近 20 条，按写入时间倒序）；无输入时展示为可回填/可清空的 chips。 */
    val history: Flow<List<String>> = graph.db.searchHistoryDao().observeRecent(20)

    /** 提交当前搜索词写历史（IME 搜索键触发）：query 主键去重，at 存 epochMillis（BUG-17：
     *  Instant.toString() 整秒会省略小数位，TEXT 字典序 ORDER BY 错位，chips 偶发倒置）。 */
    fun commitSearch() {
        val q = _query.value.trim()
        if (q.isEmpty()) return
        viewModelScope.launch {
            graph.db.searchHistoryDao().upsert(SearchHistoryEntity(q, System.currentTimeMillis()))
        }
    }

    /** 清空搜索历史。 */
    fun clearHistory() {
        viewModelScope.launch { graph.db.searchHistoryDao().clear() }
    }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { SearchViewModel(graph) }
        }
    }
}
