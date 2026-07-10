package com.bluskysoftware.yandegallery

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * 轮询等值（flake 根治 2026-07-10，spec 见 doc/superpowers/specs/ 同日文档）：
 *
 * runTest 内对「真实 IO 回环」（DataStore 落盘 / Room 执行器发射）的等值断言，不能用单收集者的
 * `flow.first { 谓词 }`——androidx DataStore 的 data flow 存在 **lost-wakeup 竞态**：收集者初读到
 * 旧值后挂起等更新通知，若写完成的通知发生在其注册监听之前，该收集者永远等不到（实测：谓词
 * first 死等 60s 超时，紧随其后的裸 `first()` 却能读到目标值——值早已落盘）。这就是 v0.5/v0.6
 * 期间 DataStore 类轮转 `UncompletedCoroutinesError` 的真身：机器时序决定初读快慢，慢即踩中。
 * 生产代码无碍——UI 侧是长活 stateIn 收集，后续任意写都会再通知，丢一拍即自愈。
 *
 * 解法与 M4DensityPrefsE2ETest.awaitHeaderDisplays 先例同构：**每轮全新收集读当前值**（新收集者
 * 的首发射不依赖更新通知），25ms 真实间隔轮询至断言成立；整体跑在 Dispatchers.Default，跳出
 * runTest 虚拟时间。超时（15s）返回末次读值，交由调用方断言给出明确红灯。
 */
suspend fun <T> awaitValue(read: suspend () -> T, until: (T) -> Boolean): T =
    withContext(Dispatchers.Default) {
        var last = read()
        repeat(600) {
            if (until(last)) return@withContext last
            delay(25)
            last = read()
        }
        last
    }
