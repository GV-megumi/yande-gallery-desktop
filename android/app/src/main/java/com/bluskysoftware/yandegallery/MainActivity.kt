package com.bluskysoftware.yandegallery

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.bluskysoftware.yandegallery.ui.AppNavForTest

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AppNavForTest()   // Task 10/11/8 逐步替换为真实屏幕装配
        }
    }
}
