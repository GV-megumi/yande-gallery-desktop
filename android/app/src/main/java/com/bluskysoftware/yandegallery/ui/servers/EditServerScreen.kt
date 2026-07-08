package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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

/**
 * 编辑服务器（spec §7.6）：结构镜像 AddServerScreen——首屏用 serverById 预填三字段，保存调 vm.update
 * （归一化落库 + SSE 重连 + 同步 nudge）。保存前经 normalizeBaseUrl 校验/归一化，非法则字段标红不落库（M4-T14）。
 */
@OptIn(ExperimentalMaterial3Api::class)
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
        topBar = {
            TopAppBar(
                title = { Text("编辑服务器") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("名称（可选）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("field_name"),
            )
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it; baseUrlError = null },
                label = { Text("服务器地址（http://…）") },
                singleLine = true,
                isError = baseUrlError != null,
                supportingText = baseUrlError?.let { msg -> { Text(msg) } },
                modifier = Modifier.fillMaxWidth().testTag("field_baseUrl"),
            )
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API Key") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("field_apiKey"),
            )
            Button(
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
                modifier = Modifier.fillMaxWidth().testTag("edit_server_save"),
            ) {
                Text("保存")
            }
        }
    }
}
