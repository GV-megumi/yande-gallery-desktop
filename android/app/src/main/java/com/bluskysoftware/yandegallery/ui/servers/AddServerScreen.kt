package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import kotlinx.coroutines.launch

/**
 * 手动添加/预填添加服务器。
 * 扫码命中后，MainActivity 会在导航到本屏前把三字段写入本条目 savedStateHandle 的
 * `prefill_*` 键；此处一次性消费（remove）以预填表单，重进本屏时不会残留旧值。
 */
@OptIn(ExperimentalMaterial3Api::class)
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

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("添加服务器") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
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
                onValueChange = { baseUrl = it },
                label = { Text("服务器地址（http://…）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("field_baseUrl"),
            )
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API Key") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("field_apiKey"),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(
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
                    enabled = !testing && baseUrl.isNotBlank(),
                    modifier = Modifier.weight(1f).testTag("btn_test"),
                ) {
                    if (testing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp).padding(end = 4.dp),
                        )
                    }
                    Text("测试连接")
                }
                Button(
                    onClick = { vm.add(name, baseUrl, apiKey) { onSaved() } },
                    enabled = baseUrl.isNotBlank() && apiKey.isNotBlank(),
                    modifier = Modifier.weight(1f).testTag("btn_save"),
                ) {
                    Text("保存并激活")
                }
            }
        }
    }
}
