package com.nexonic.trace

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
        val device = UiDevice.getInstance(instrumentation)
        assertTrue("Search screen must open without login", device.wait(Until.hasObject(By.text("Discover your digital footprint.")), 20000))
        device.findObject(By.text("Settings")).click()
        assertTrue("Native settings must render", device.wait(Until.hasObject(By.text("Save searches on this device")), 10000))
        // On compact screens this control is below the initial settings viewport.
        for (attempt in 0 until 5) {
            if (device.hasObject(By.text("Delete all data"))) break
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4,
                device.displayWidth / 2, device.displayHeight / 3, 30)
        }
        assertTrue("History deletion must be reachable by touch", device.wait(Until.hasObject(By.text("Delete all data")), 10000))
        device.findObject(By.text("Delete all data")).click()
        assertTrue("Native data deletion must complete", device.wait(Until.hasObject(By.textContains("have been cleared")), 15000))
        device.findObject(By.text("Security")).click()
        assertTrue("Explicit password check must be available", device.wait(Until.hasObject(By.text("Check password")), 10000))
    }
}
