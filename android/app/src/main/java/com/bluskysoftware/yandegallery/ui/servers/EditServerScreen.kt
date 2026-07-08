package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.common.MiuiPrimaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField

/**
 * 编辑服务器（spec §7.6/§8.2）：结构镜像 AddServerScreen——首屏用 serverById 预填三字段，保存调 vm.update
 * （归一化落库 + SSE 重连 + 同步 nudge）。保存前经 normalizeBaseUrl 校验/归一化，非法则字段标红不落库（M4-T14）。
 */
@Composable
fun EditServerScreen(
    vm: ServersViewModel,
    serverId: Long,
    onSaved: () -> Unit,
    onBack: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var baseUrl by rememberSaveable { mutableStateOf("") }
    var apiKey by rememberSaveable { mutableStateOf("") }
    // 仅首屏预填一次；进程重建后 rememberSaveable 已恢复用户编辑值，不再用 DB 旧值覆盖。
    var prefilled by rememberSaveable { mutableStateOf(false) }
    // 保存进行中防抖（BUG-09）：落库+onSaved(popBackStack) 是异步，快速双击会双 pop 过弹到上级页
    var saving by remember { mutableStateOf(false) }
    // baseUrl 格式错误提示（M4-T14）：保存时校验，非法则字段标红不落库
    var baseUrlError by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(serverId) {
        if (!prefilled) {
            vm.serverById(serverId)?.let { s ->
                name = s.name
                baseUrl = s.baseUrl
                apiKey = s.apiKey
            }
            prefilled = true
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("编辑服务器", onBack) },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            MiuiTextField(
                value = name,
                onValueChange = { name = it },
                label = "名称（可选）",
                modifier = Modifier.testTag("field_name"),
            )
            MiuiTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it; baseUrlError = null },
                label = "服务器地址",
                placeholder = "http://主机:端口",
                isError = baseUrlError != null,
                supportingText = baseUrlError,
                modifier = Modifier.testTag("field_baseUrl"),
            )
            MiuiTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = "API Key",
                modifier = Modifier.testTag("field_apiKey"),
            )
            MiuiPrimaryButton(
                "保存",
                onClick = {
                    val normalized = normalizeBaseUrl(baseUrl)
                    if (normalized == null) {
                        baseUrlError = "地址格式不正确，应为 http://主机:端口"
                    } else {
                        baseUrlError = null
                        saving = true
                        vm.update(serverId, name, normalized, apiKey) { onSaved() }
                    }
                },
                enabled = !saving && baseUrl.isNotBlank() && apiKey.isNotBlank(),
                // 既有 testTag 契约保留：不随计划示例改名 btn_save（本屏无测试连接按钮，单按钮全宽）
                modifier = Modifier.fillMaxWidth().testTag("edit_server_save"),
            )
        }
    }
}
