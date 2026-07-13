package com.bluskysoftware.yandegallery.domain.download

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import java.io.File

/**
 * 分享协调器（镜像版，spec §4.4/需求 4）：不再强制先下原图。
 * 四级规则：本地原图 > 本地 HQ（localFile 已按行档位返回，天然覆盖前两级）>
 * 在线按当前保存方式临时拉一张入镜像（顺带补齐该图同步，D10）> 离线且无文件 → failedIds。
 * 纯逻辑注入（生产挂 ImageMirrorStore/ConnectionMonitor），无 WorkManager/Android 依赖。
 */
class ShareCoordinator(
    private val localFile: suspend (imageId: Long) -> File?,
    private val ensure: suspend (imageId: Long, tier: MirrorTier) -> Result<File>,
    private val saveMode: suspend () -> MirrorTier,
    private val online: () -> Boolean,
) {
    data class ShareOutcome(val files: List<File>, val failedIds: List<Long>)

    suspend fun shareFiles(images: List<ImageEntity>): ShareOutcome {
        val ready = mutableMapOf<Long, File>()
        val failed = mutableListOf<Long>()
        val tier = saveMode()
        for (image in images) {
            val local = localFile(image.id)
            when {
                local != null -> ready[image.id] = local
                online() -> ensure(image.id, tier)
                    .onSuccess { ready[image.id] = it }
                    .onFailure { failed += image.id }
                else -> failed += image.id
            }
        }
        return ShareOutcome(files = images.mapNotNull { ready[it.id] }, failedIds = failed)
    }
}
