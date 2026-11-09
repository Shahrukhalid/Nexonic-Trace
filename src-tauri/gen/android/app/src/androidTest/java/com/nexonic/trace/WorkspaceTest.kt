package com.nexonic.trace

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkspaceTest {
    @Test
    fun launchesWithoutLoginAndNavigatesToSettings() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage("com.nexonic.trace")!!
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
        val device = UiDevice.getInstance(instrumentation)
        fun navigate(label: String, destination: BySelector) {
            val button = By.clazz("android.widget.Button").text(label)
            repeat(3) {
                if (device.hasObject(destination)) return
                device.waitForIdle()
                val target = device.wait(Until.findObject(button), 5000)
                if (target != null && !target.visibleBounds.isEmpty) {
                    target.click()
                    if (device.wait(Until.hasObject(destination), 5000)) return
                }
            }
            assertTrue("The $label screen must open through its visible navigation button", device.hasObject(destination))
        }
        assertTrue("Search screen must open without login", device.wait(Until.hasObject(By.text("Discover your digital footprint.")), 20000))
        navigate("Settings", By.text("Save searches on this device"))
        val deletion = By.clazz("android.widget.Button").text("Delete all data")
        val success = By.textContains("have been cleared")
        fun deletionIsTouchable(): Boolean {
            val bounds = device.findObject(deletion)?.visibleBounds ?: return false
            val navigation = device.findObject(By.clazz("android.widget.Button").text("Security"))
            val navigationTop = navigation?.visibleBounds?.top ?: device.displayHeight
            return !bounds.isEmpty && bounds.bottom <= navigationTop
        }
        // A nonempty WebView node can still sit behind the fixed bottom navigation.
        repeat(6) {
            if (!deletionIsTouchable()) {
                device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4,
                    device.displayWidth / 2, device.displayHeight / 3, 30)
                device.waitForIdle()
            }
        }
        assertTrue("Deletion control must be above the bottom navigation", deletionIsTouchable())
        device.findObject(deletion).click()
        assertTrue("Native data deletion must complete", device.wait(Until.hasObject(success), 15000))
        navigate("Security", By.text("Check password"))
    }
}
