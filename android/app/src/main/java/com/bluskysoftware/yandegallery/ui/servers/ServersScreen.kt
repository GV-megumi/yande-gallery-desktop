package com.bluskysoftware.yandegallery.ui.servers

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiPrimaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSecondaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ServersScreen(
    vm: ServersViewModel,
    onAddManual: () -> Unit,
    onScan: () -> Unit,
    onEdit: (Long) -> Unit,
    onBack: () -> Unit,
) {
    val servers by vm.servers.collectAsStateWithLifecycle(initialValue = emptyList())
    val active by vm.active.collectAsStateWithLifecycle(initialValue = null)
    var deleteTarget by remember { mutableStateOf<ServerEntity?>(null) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("服务器", onBack) },
        bottomBar = {
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                MiuiSecondaryButton("扫码添加", onClick = onScan, modifier = Modifier.weight(1f).testTag("btn_scan_add"))
                MiuiPrimaryButton("手动添加", onClick = onAddManual, modifier = Modifier.weight(1f).testTag("btn_manual_add"))
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
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(servers, key = { it.id }) { server ->
                    val isActive = server.id == active?.id
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceContainer,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).combinedClickable(
                            onClick = { vm.activate(server.id) },
                            onLongClick = { deleteTarget = server },
                        ),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
                        ) {
                            if (isActive) {
                                Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                                Spacer(Modifier.size(8.dp))
                            }
                            Column(Modifier.weight(1f)) {
                                Text(server.name, style = MaterialTheme.typography.bodyLarge)
                                Text(server.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (isActive) Text("当前", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                            IconButton(onClick = { onEdit(server.id) }, modifier = Modifier.testTag("server_edit_${server.id}")) {
                                Icon(Icons.Filled.Edit, contentDescription = "编辑")
                            }
                        }
                    }
                }
            }
        }
    }

    deleteTarget?.let { target ->
        MiuiDialog(
            title = "删除服务器",
            text = "确定删除「${target.name}」？此操作不影响已下载到本机的图片。",
            onDismiss = { deleteTarget = null },
            confirmText = "删除",
            destructive = true,
            confirmTag = "server_delete_confirm",
            onConfirm = {
                vm.delete(target.id)
                deleteTarget = null
            },
        )
    }
}
