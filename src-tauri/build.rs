fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // Android devices may use 16 KiB pages. This final-link flag applies to
        // the shared Rust library regardless of CLI-provided target rustflags.
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
