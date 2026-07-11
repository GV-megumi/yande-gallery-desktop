package com.bluskysoftware.yandegallery.data.api

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class WriteApiTest {
    private fun api(server: MockWebServer): DesktopApi =
        ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ "k" }))

    @Test fun `deleteImage DELETE 路径 + Bearer + removed`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"removed":true}}"""))
            s.start()
            val r = api(s).deleteImage(5).unwrap()
            assertTrue(r.removed)
            val req = s.takeRequest()
            assertEquals("DELETE", req.method); assertEquals("/api/app/v1/images/5", req.path)
            assertEquals("Bearer k", req.getHeader("Authorization"))
        }
    }

    @Test fun `addImageTags POST body names`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"updated":true}}"""))
            s.start()
            api(s).addImageTags(9, TagNamesDto(listOf("cat", "dog"))).unwrap()
            val req = s.takeRequest()
            assertEquals("POST", req.method); assertEquals("/api/app/v1/images/9/tags", req.path)
            assertTrue(req.body.readUtf8().contains("\"names\":[\"cat\",\"dog\"]"))
        }
    }

    @Test fun `createGallery 返回 id`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"id":42}}"""))
            s.start()
            assertEquals(42L, api(s).createGallery(GalleryNameDto("新相册")).unwrap().id)
        }
    }

    @Test fun `addGalleryImages 返回 added+missing`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"added":2,"missingImageIds":[9]}}"""))
            s.start()
            val r = api(s).addGalleryImages(3, ImageIdsBody(listOf(1, 2, 9))).unwrap()
            assertEquals(2, r.added); assertEquals(listOf(9L), r.missingImageIds)
        }
    }

    @Test fun `403 映射为 ApiException PERMISSION_DENIED`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setResponseCode(403).setBody(
                """{"success":false,"error":{"code":"PERMISSION_DENIED","message":"x"}}"""))
            s.start()
            val e = runCatching { api(s).deleteImage(1) }.exceptionOrNull()
            assertTrue(e is ApiException); assertEquals("PERMISSION_DENIED", (e as ApiException).code)
            assertEquals(403, e.httpStatus)
        }
    }

    @Test fun `setGalleryCover 发 PATCH 且 body 为 coverImageId`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"updated":true}}"""))
            s.start()
            api(s).setGalleryCover(7, GalleryCoverDto(10)).unwrap()
            val recorded = s.takeRequest()
            assertEquals("PATCH", recorded.method)
            assertEquals("/api/app/v1/galleries/7", recorded.path)
            assertEquals("""{"coverImageId":10}""", recorded.body.readUtf8())
        }
    }

    @Test fun `removeGalleryImages DELETE 带 body`() = runTest {
        MockWebServer().use { s ->
            s.enqueue(MockResponse().setBody("""{"success":true,"data":{"removed":2}}"""))
            s.start()
            assertEquals(2, api(s).removeGalleryImages(3, ImageIdsBody(listOf(1, 2))).unwrap().removed)
            val req = s.takeRequest()
            assertEquals("DELETE", req.method); assertEquals("/api/app/v1/galleries/3/images", req.path)
            assertTrue(req.body.readUtf8().contains("imageIds"))
        }
    }
}
