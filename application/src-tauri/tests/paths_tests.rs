use frostfire_os_lib::paths::AppPaths;

#[test]
fn test_app_paths_resolution() {
    let paths = AppPaths::resolve().expect("Paths should resolve");

    assert!(paths.app_data_dir.to_string_lossy().contains("frostfireOS"));
    assert!(paths.extensions_dir.to_string_lossy().contains(".frostfireOS"));

    // Verify ensure_directories() creates them without error
    let res = paths.ensure_directories();
    assert!(res.is_ok(), "Directory creation should succeed: {:?}", res);
    assert!(paths.app_data_dir.exists());
    assert!(paths.extensions_dir.exists());
}
