package com.bluskysoftware.yandegallery.data.media

import android.net.Uri
import java.io.OutputStream

/**
 * 原图下载写入系统相册（MediaStore）的抽象接口。
 *
 * 真机语义（IS_PENDING 生命周期、RELATIVE_PATH 落盘、createDeleteRequest 确认弹窗）
 * Robolectric 模拟不可靠，故抽象出此接口：worker 逻辑（Task 8）对 fake 实现测试；
 * 唯一真实实现 [AndroidMediaStoreGateway] 仅做冒烟测试，真值验证留给实机。
 */
interface MediaStoreGateway {
    /** 在系统相册创建一条待写入条目（29+ 带 IS_PENDING，26-28 直接可见），返回其 content Uri。 */
    fun createPending(displayName: String, mime: String): Uri?

    /** 打开 [createPending] 返回的 Uri 对应的输出流，用于写入原图字节。 */
    fun openOutput(uri: Uri): OutputStream?

    /** 写入完成：29+ 清除 IS_PENDING 使其在相册可见；26-28 触发媒体库扫描。 */
    fun finalize(uri: Uri)

    /**
     * 下载失败时清理半成品条目（runCatching 吞异常是良性——worker 清理路径不需要结果；
     * debt-cluster (7) 警示：签名不可改，需要结构化结果的删除走 [deleteOwned]）。
     */
    fun discard(uri: Uri)

    /** 大图页判断「已下载条目是否仍在系统相册」（用户可能已在系统相册里手动删除）。 */
    fun exists(uri: Uri): Boolean

    /** 30+ 构造系统删除确认请求（需 Activity 经 StartIntentSenderForResult 启动，本接口只构造不启动）；30 以下返回 null，调用方直接删除。 */
    fun buildDeleteRequest(uris: List<Uri>): android.app.PendingIntent?

    /**
     * <30 直删本 app 所有的系统相册副本，返回结构化结果（M4-T9）：API 29 上 app 重装等所有权
     * 丢失场景系统抛 RecoverableSecurityException——转成 [DeleteOwnedResult.NeedsConsent] 携带
     * IntentSender，UI 层经 StartIntentSenderForResult 拉系统确认（spec §8 明确报错不静默）。
     */
    fun deleteOwned(uri: Uri): DeleteOwnedResult
}

/** [MediaStoreGateway.deleteOwned] 的结构化结果（M4-T9，spec §8）。 */
sealed interface DeleteOwnedResult {
    /** 已删除（resolver.delete 未抛异常；行不存在的 delete 返回 0 也算删除——目标态已达成）。 */
    data object Deleted : DeleteOwnedResult

    /** API 29 所有权丢失：需用户经系统确认授权删除（RecoverableSecurityException.userAction）。 */
    data class NeedsConsent(val intentSender: android.content.IntentSender) : DeleteOwnedResult

    /** 其它失败（权限/IO）：文件保留，调用方须提示（spec §8 不静默）。 */
    data class Failed(val message: String?) : DeleteOwnedResult
}
