package com.bluskysoftware.yandegallery.data.mirror

import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.ImageDao
import com.bluskysoftware.yandegallery.data.db.ImageFileDao
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * 图片镜像层唯一写入口（spec §3.3；类名带 Image 前缀区分 domain.sync.MirrorStore 元数据镜像接口）。
 * - [ensure] 幂等：per-key Mutex 防同图并发双下；`*.part` 临时写 + Content-Length 校验 + 原子
 *   rename（镜像目录永无可见半截文件，spec §6）；落定后清同目录其余文件（HQ→原图替换由此实现）；
 *   落行前校验 serverId 仍为激活服务器（跨切服拦截，沿用旧 DownloadWorker 先例）。
 * - 已有 ORIGINAL 时请求 HQ 直接返回现有文件（D7 原图始终保留）。
 * - 404/断网等异常包进 Result.failure 原样保留（同步 worker 按 ApiException.httpStatus 分流）。
 */
class ImageMirrorStore(
    private val rootDir: File,
    private val imageFileDao: ImageFileDao,
    private val imageDao: ImageDao,
    private val apiProvider: suspend () -> DesktopApi?,
    private val activeServerId: suspend () -> Long?,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val freeBytes: () -> Long = { rootDir.usableSpace },
) {
    private val locks = ConcurrentHashMap<String, Mutex>()

    class DiskFullException : Exception("存储空间不足")

    /**
     * per-key 锁：[ensure]/[deleteDirs]/[sweepOrphans] 三处并发写入/清扫入口共用同一把锁，
     * key 格式集中于此以免各处拼接漂移。用 `computeIfAbsent`（而非 `kotlin.collections.getOrPut`，
     * 后者在此接收者类型下解析到非原子的 plain get→put，双线程各自首次拿图会拿到不同 Mutex）。
     */
    private fun lockFor(serverId: Long, imageId: Long): Mutex =
        locks.computeIfAbsent("s$serverId:i$imageId") { Mutex() }

    suspend fun ensure(serverId: Long, imageId: Long, tier: MirrorTier): Result<File> =
        lockFor(serverId, imageId).withLock {
            withContext(Dispatchers.IO) { ensureLocked(serverId, imageId, tier) }
        }

    private suspend fun ensureLocked(serverId: Long, imageId: Long, tier: MirrorTier): Result<File> {
        // 命中判定：ORIGINAL 行满足任何请求；HQ 行满足 HQ 请求；行在文件亡视为未命中（重下自愈）
        val row = imageFileDao.byImageId(serverId, imageId)
        if (row != null) {
            val existing = fileOf(row)
            if (existing.isFile && existing.length() > 0 &&
                (row.tier == MirrorTier.ORIGINAL.name || tier == MirrorTier.HQ)
            ) return Result.success(existing)
        }

        // 全新安装时 mirror/ 根目录从未被创建过：File.usableSpace 对不存在的路径返回 0
        // （不是"未知"而是"0 可用"，statvfs 语义），会被下面的阈值判断永久误判磁盘不足——
        // sync 恒报 DISK_FULL、DownloadWorker 无限重试且无自愈路径（目录不存在的状态不会自己变化）。
        // 此处前置建根目录，让 freeBytes() 查询落在真实存在的路径上；mkdirs 幂等、开销可忽略，
        // 顺带让下面 per-image 目录的 mkdirs 少建一层父目录。
        rootDir.mkdirs()
        if (freeBytes() < MIN_FREE_BYTES) return Result.failure(DiskFullException())
        val api = apiProvider() ?: return Result.failure(IllegalStateException("无激活服务器"))
        val entity = imageDao.byId(imageId)
            ?: return Result.failure(IllegalStateException("图片元数据不存在: $imageId"))

        // 错误映射拦截器对非 2xx 先抛 ApiException（404 永远拿不到 Response）——异常原样进 failure
        val response = try {
            if (tier == MirrorTier.ORIGINAL) api.downloadOriginal(imageId) else api.downloadHq(imageId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return Result.failure(e)
        }
        val body = response.body() ?: return Result.failure(IOException("空响应体"))

        return body.use {
            val contentType = body.contentType()?.toString()
            val filename = if (tier == MirrorTier.ORIGINAL) sanitizeFilename(entity.filename)
            else hqFilename(entity.filename, contentType)
            val dir = File(rootDir, "s$serverId/i$imageId").apply { mkdirs() }
            val target = File(dir, filename)
            val part = File(dir, "$filename.part")
            val expected = body.contentLength()
            var written = 0L
            try {
                part.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); written += n
                        }
                    }
                }
            } catch (e: CancellationException) {
                part.delete(); throw e   // 取消不吞：清半成品再重抛
            } catch (e: Exception) {
                part.delete(); return Result.failure(e)
            }
            if (expected >= 0 && written != expected) {
                part.delete(); return Result.failure(IOException("尺寸不符: 期望 $expected 实收 $written"))
            }
            if (written == 0L) {
                part.delete(); return Result.failure(IOException("空的图片响应"))
            }
            // 跨切服拦截（spec §6）：下载期间切服 → 本产物属旧服域，丢弃不落行
            if (activeServerId() != serverId) {
                part.delete(); return Result.failure(IllegalStateException("服务器已切换，丢弃产物"))
            }
            // crash-retry 场景：上次成功 renameTo 但未及 upsert 便崩溃，target 残留、行缺失；本次重下
            // 持有同一把 per-key 锁，语义上"这次下载胜出"，直接顶掉旧产物再 rename——POSIX renameTo
            // 本会原子替换，但本仓库开发/测试机是 Windows JVM，target 存在时 renameTo 直接返回 false，
            // 不预删会导致该次下载被永久判失败。删除失败时交给下面 renameTo 的 false 分支兜底报错。
            if (target.exists()) target.delete()
            if (!part.renameTo(target)) {
                part.delete(); return Result.failure(IOException("落盘改名失败"))
            }
            // 清同目录其余文件：HQ→原图替换（含 png 异名 foo.jpg→foo.png）、历史残骸
            dir.listFiles()?.forEach { if (it != target) it.delete() }
            try {
                imageFileDao.upsert(
                    ImageFileEntity(serverId, imageId, tier.name, "s$serverId/i$imageId/$filename", written, nowMs()),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // 文件已落盘但行未登记：row-less 文件下轮 sweepOrphans 视为孤儿清掉，再由同步补下，自愈
                return Result.failure(e)
            }
            Result.success(target)
        }
    }

    /** 本地现状（分享/大图/缩略图回退判断用）：行在文件亡返回 null（下轮同步自愈）。 */
    suspend fun localFile(serverId: Long, imageId: Long): LocalImage? {
        val row = imageFileDao.byImageId(serverId, imageId) ?: return null
        val file = fileOf(row)
        if (!file.isFile || file.length() == 0L) return null
        return LocalImage(mirrorTierOf(row.tier), file)
    }

    fun fileOf(row: ImageFileEntity): File = File(rootDir, row.relPath)

    /** 镜像根所在盘可用字节数（Task 9 设置页「切原图」预估对比展示用，公开转发 [freeBytes]）。 */
    fun rootFreeBytes(): Long = freeBytes()

    suspend fun stats(serverId: Long): MirrorStats {
        var s = MirrorStats()
        for (t in imageFileDao.statsFor(serverId)) {
            s = when (t.tier) {
                MirrorTier.HQ.name -> s.copy(hqCount = t.count, hqBytes = t.bytes)
                MirrorTier.ORIGINAL.name -> s.copy(originalCount = t.count, originalBytes = t.bytes)
                else -> s
            }
        }
        return s
    }

    /**
     * 对账删除级联（RoomMirrorStore.deleteImages 事务外调用）：目录名由 id 可导出，不查行。
     * 逐 id 持 [lockFor] 同一把锁再删，避免与该 id 正在进行的 [ensure] 竞态删掉其 in-flight `.part`
     * （ensure 会先 mkdirs 再落行，锁窗口外的 delete 可能抢在首次下载落行前把整个目录端了）。
     */
    suspend fun deleteDirs(serverId: Long, imageIds: List<Long>) = withContext(Dispatchers.IO) {
        for (id in imageIds) {
            lockFor(serverId, id).withLock {
                File(rootDir, "s$serverId/i$id").deleteRecursively()
            }
        }
    }

    /**
     * 镜像身份失效（clearMirror 事务外调用）：整棵 mirror/ 内容删除；行清理归 RoomMirrorStore。
     * 契约：调用方必须已先使该 serverId 的镜像身份失效 / 取消其镜像同步（spec §3.4 切服清理语义）——
     * 整树清空针对的是"域已切换、旧域不会再有写手"场景；不做 per-key 加锁，因为清空时点无法枚举
     * 当时可能仍在途的每一把 per-image 锁，per-key 粒度对整树操作不可行。
     */
    fun clearAllFiles() {
        rootDir.listFiles()?.forEach { it.deleteRecursively() }
    }

    /** 启动孤儿清扫（spec §3.4）：无行目录删除；有行无文件的行删除（下轮同步自动补）。 */
    suspend fun sweepOrphans(serverId: Long) = withContext(Dispatchers.IO) {
        val rows = imageFileDao.allFor(serverId).associateBy { it.imageId }
        for (dir in File(rootDir, "s$serverId").listFiles().orEmpty()) {
            val id = dir.name.removePrefix("i").toLongOrNull()
            if (id == null) {
                dir.deleteRecursively()   // 名称不可解析：非本层写入产物格式，不存在并发写手，无需持锁
            } else if (rows[id] == null) {
                // ensure() 建目录(mkdirs)先于落行，快照读到"无行"与这里执行 delete 之间存在窗口；
                // 持锁后向 DAO 复查一次，避免删掉恰好在这个窗口里刚完成首次下载落行的目录
                lockFor(serverId, id).withLock {
                    if (imageFileDao.byImageId(serverId, id) == null) dir.deleteRecursively()
                }
            }
        }
        for ((id, row) in rows) {
            if (!fileOf(row).isFile || fileOf(row).length() == 0L) imageFileDao.delete(serverId, id)
        }
    }

    companion object {
        /** 磁盘可用空间阈值（spec §3.4-5/§6）。 */
        const val MIN_FREE_BYTES = 500L * 1024 * 1024
    }
}
