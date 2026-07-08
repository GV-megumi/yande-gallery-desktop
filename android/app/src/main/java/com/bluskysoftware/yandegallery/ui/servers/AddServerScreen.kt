package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.MiuiPrimaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSecondaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField
import kotlinx.coroutines.launch

/**
 * 手动添加/预填添加服务器（spec §8.2：灰底圆角输入框 + 胶囊按钮）。
 * 扫码命中后，MainActivity 会在导航到本屏前把三字段写入本条目 savedStateHandle 的
 * `prefill_*` 键；此处一次性消费（remove）以预填表单，重进本屏时不会残留旧值。
 */
@Composable
fun AddServerScreen(
    vm: ServersViewModel,
    navController: NavHostController,
    onSaved: () -> Unit,
    onBack: () -> Unit,
) {
    val prefill = remember {
        val handle = navController.getBackStackEntry(Routes.AddServer).savedStateHandle
        Triple(
            handle.remove<String>("prefill_name") ?: "",
            handle.remove<String>("prefill_baseUrl") ?: "",
            handle.remove<String>("prefill_apiKey") ?: "",
        )
    }
    var name by rememberSaveable { mutableStateOf(prefill.first) }
    var baseUrl by rememberSaveable { mutableStateOf(prefill.second) }
    var apiKey by rememberSaveable { mutableStateOf(prefill.third) }
    var testing by remember { mutableStateOf(false) }
    // 保存进行中防抖（BUG-09）：入库+导航是异步，快速双击会插两条同名激活行
    var saving by remember { mutableStateOf(false) }
    // baseUrl 格式错误提示（M4-T14）：保存时校验，非法则字段标红不落库
    var baseUrlError by rememberSaveable { mutableStateOf<String?>(null) }

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("添加服务器", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
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
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MiuiSecondaryButton(
                    "测试连接",
                    onClick = {
                        testing = true
                        scope.launch {
                            val result = vm.testConnection(baseUrl, apiKey)
                            testing = false
                            snackbar.showSnackbar(
                                result.getOrElse { "连接失败：${it.message ?: "未知错误"}" },
                            )
                        }
                    },
                    enabled = baseUrl.isNotBlank(),
                    loading = testing,
                    modifier = Modifier.weight(1f).testTag("btn_test"),
                )
                MiuiPrimaryButton(
                    "保存并激活",
                    onClick = {
                        val normalized = normalizeBaseUrl(baseUrl)
                        if (normalized == null) {
                            baseUrlError = "地址格式不正确，应为 http://主机:端口"
                        } else {
                            baseUrlError = null
                            saving = true
                            vm.add(name, normalized, apiKey) { onSaved() }
                        }
                    },
                    enabled = !saving && baseUrl.isNotBlank() && apiKey.isNotBlank(),
                    modifier = Modifier.weight(1f).testTag("btn_save"),
                )
            }
        }
    }
}
