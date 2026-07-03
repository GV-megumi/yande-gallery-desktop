package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluskysoftware.yandegallery.data.db.ServerEntity

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ServersScreen(
    vm: ServersViewModel,
    onAddManual: () -> Unit,
    onScan: () -> Unit,
    onBack: () -> Unit,
) {
    val servers by vm.servers.collectAsStateWithLifecycle(initialValue = emptyList())
    val active by vm.active.collectAsStateWithLifecycle(initialValue = null)
    var deleteTarget by remember { mutableStateOf<ServerEntity?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("服务器") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = onScan,
                    modifier = Modifier.weight(1f).testTag("btn_scan_add"),
                ) {
                    Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
                    Text("  扫码添加")
                }
                Button(
                    onClick = onAddManual,
                    modifier = Modifier.weight(1f).testTag("btn_manual_add"),
                ) {
                    Text("手动添加")
                }
            }
        },
    ) { padding ->
        if (servers.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "还没有服务器，点击下方「扫码添加」或「手动添加」配对桌面端",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(servers, key = { it.id }) { server ->
                    val isActive = server.id == active?.id
                    ListItem(
                        headlineContent = { Text(server.name) },
                        supportingContent = { Text(server.baseUrl) },
                        trailingContent = {
                            if (isActive) {
                                Icon(
                                    Icons.Filled.CheckCircle,
                                    contentDescription = "已激活",
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        },
                        modifier = Modifier.combinedClickable(
                            onClick = { vm.activate(server.id) },
                            onLongClick = { deleteTarget = server },
                        ),
                    )
                }
            }
        }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除服务器") },
            text = { Text("确定删除「${target.name}」？此操作不影响已下载到本机的图片。") },
            confirmButton = {
                TextButton(onClick = {
                    vm.delete(target.id)
                    deleteTarget = null
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text("取消") }
            },
        )
    }
}
