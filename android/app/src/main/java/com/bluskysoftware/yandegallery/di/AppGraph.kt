package com.bluskysoftware.yandegallery.di

import android.content.Context

/** 手写组合根：单例依赖都挂在这里（v1 单模块，不引 Hilt）。 */
class AppGraph(val appContext: Context)
