#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to initialize Tokio runtime");
    let _guard = rt.enter();

    frostfire_os_lib::run();
}
