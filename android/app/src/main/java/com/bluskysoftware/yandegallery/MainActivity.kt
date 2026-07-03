package com.bluskysoftware.yandegallery

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import com.bluskysoftware.yandegallery.ui.AppScaffold
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.servers.AddServerScreen
import com.bluskysoftware.yandegallery.ui.servers.ScanScreen
import com.bluskysoftware.yandegallery.ui.servers.ServersScreen
import com.bluskysoftware.yandegallery.ui.servers.ServersViewModel
import com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = (applicationContext as YandeGalleryApp).graph
        setContent {
            YandeGalleryTheme {
                val nav = rememberNavController()
                val serversVm: ServersViewModel = viewModel(factory = ServersViewModel.factory(graph))
                AppScaffold(
                    navController = nav,
                    // Task 10/11 逐步替换以下三个占位为真实照片/相册屏
                    photosContent = { Text("照片页占位") },
                    albumsContent = { Text("相册页占位") },
                    albumDetailContent = { Text("图集详情占位") },
                    serversContent = {
                        ServersScreen(
                            vm = serversVm,
                            onAddManual = { nav.navigate(Routes.AddServer) },
                            onScan = { nav.navigate(Routes.Scan) },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    addServerContent = {
                        AddServerScreen(
                            vm = serversVm,
                            navController = nav,
                            onSaved = { nav.popBackStack(Routes.Servers, inclusive = false) },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    scanContent = {
                        ScanScreen(
                            onPayload = { payload ->
                                // 弹出扫码页后进入添加页，并把三字段写入目标条目 savedStateHandle 预填
                                nav.navigate(Routes.AddServer) {
                                    popUpTo(Routes.Scan) { inclusive = true }
                                    launchSingleTop = true
                                }
                                nav.getBackStackEntry(Routes.AddServer).savedStateHandle.also { handle ->
                                    handle["prefill_name"] = payload.name
                                    handle["prefill_baseUrl"] = payload.baseUrl
                                    handle["prefill_apiKey"] = payload.apiKey
                                }
                            },
                            onBack = { nav.popBackStack() },
                        )
                    },
                )
            }
        }
    }
}
