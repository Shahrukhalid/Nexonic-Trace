import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// UiAutomator runs in this separate test process so the optimized release
// can keep shrinking its own dependencies. These APKs are never distributed.
android {
    namespace = "com.nexonic.trace.acceptance"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.nexonic.trace.acceptance"
        minSdk = 24
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    sourceSets.getByName("androidTest").java.srcDir("../app/src/androidTest/java")
}

kotlin.compilerOptions.jvmTarget = JvmTarget.JVM_11

dependencies {
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
