package com.bluskysoftware.yandegallery.data.prefs

/**
 * 照片排序（spec §2.4）：照片时间轴与图集详情共用；字段 × 方向平铺成枚举，DataStore 存 name。
 * [orderBy] 由白名单枚举拼 SQL（无用户输入，无注入面）；二级键恒为 id、方向随主键（分页稳定序）。
 */
enum class PhotoSort(val column: String, val ascending: Boolean, val isTime: Boolean) {
    TIME_DESC("createdAt", false, true),
    TIME_ASC("createdAt", true, true),
    SIZE_DESC("fileSize", false, false),
    SIZE_ASC("fileSize", true, false),
    NAME_ASC("filename", true, false),
    NAME_DESC("filename", false, false);

    /** ORDER BY 片段；[prefix] 供 JOIN 场景加表别名（如 "i."）。 */
    fun orderBy(prefix: String = ""): String {
        val dir = if (ascending) "ASC" else "DESC"
        // 文件名大小写不敏感（终审 Minor#5）：SQLite 默认 BINARY collation 会把 Z.jpg 排到 a.jpg 前，
        // 违背一般图库直觉；时间/大小为数值序不受影响
        val col = if (this == NAME_ASC || this == NAME_DESC) "$prefix$column COLLATE NOCASE" else "$prefix$column"
        return "$col $dir, ${prefix}id $dir"
    }

    companion object {
        val DEFAULT = TIME_DESC
        fun fromName(name: String?): PhotoSort = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/** 排序面板字段行（spec §3.1 交互）：点未选字段 → 该字段默认方向；点已选 → 翻方向。 */
enum class PhotoSortField(val label: String, val defaultSort: PhotoSort, val flipped: PhotoSort) {
    TIME("时间", PhotoSort.TIME_DESC, PhotoSort.TIME_ASC),
    SIZE("文件大小", PhotoSort.SIZE_DESC, PhotoSort.SIZE_ASC),
    NAME("文件名", PhotoSort.NAME_ASC, PhotoSort.NAME_DESC);

    fun contains(sort: PhotoSort): Boolean = sort == defaultSort || sort == flipped

    fun next(current: PhotoSort): PhotoSort = when (current) {
        defaultSort -> flipped
        flipped -> defaultSort
        else -> defaultSort
    }
}

/** 相册排序（spec §2.4）：MANUAL 无方向；CREATED 依赖同步载荷 createdAt（旧桌面为 NULL 排尾）。 */
enum class AlbumSort {
    MANUAL, NAME_ASC, NAME_DESC, COUNT_DESC, COUNT_ASC, CREATED_DESC, CREATED_ASC;

    /** 面板方向箭头用；MANUAL 无方向（恒 false，调用方不读）。 */
    val ascending: Boolean
        get() = this == NAME_ASC || this == COUNT_ASC || this == CREATED_ASC

    companion object {
        val DEFAULT = NAME_ASC
        fun fromName(name: String?): AlbumSort = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/** 相册排序面板字段行（手动档走单选行，不在此列）。 */
enum class AlbumSortField(val label: String, val defaultSort: AlbumSort, val flipped: AlbumSort) {
    NAME("名称", AlbumSort.NAME_ASC, AlbumSort.NAME_DESC),
    COUNT("张数", AlbumSort.COUNT_DESC, AlbumSort.COUNT_ASC),
    CREATED("创建时间", AlbumSort.CREATED_DESC, AlbumSort.CREATED_ASC);

    fun contains(sort: AlbumSort): Boolean = sort == defaultSort || sort == flipped

    fun next(current: AlbumSort): AlbumSort = when (current) {
        defaultSort -> flipped
        flipped -> defaultSort
        else -> defaultSort
    }
}
