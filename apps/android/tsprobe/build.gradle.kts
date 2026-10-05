// Spike only: a throwaway app that proves an embedded Tailscale node works on Android. Never merged.
plugins { alias(libs.plugins.android.application) }
android {
    namespace = "com.millzach.sotto.tsprobe"
    compileSdk = libs.versions.compileSdk.get().toInt()
    defaultConfig { applicationId = "com.millzach.sotto.tsprobe"; minSdk = 26; targetSdk = 36; versionCode = 1; versionName = "spike"; ndk { abiFilters += "arm64-v8a" } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation(files("libs/tsprobe.aar"))
    implementation(libs.okhttp)
}
