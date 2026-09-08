use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PathError {
    #[error("Failed to determine system home directory")]
    NoHomeDir,
    #[error("Failed to create application directories: {0}")]
    IoError(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub app_install_dir: PathBuf,
    pub app_data_dir: PathBuf,
    pub extensions_dir: PathBuf,
    pub blackboard_dir: PathBuf,
    pub custom_prompts_dir: PathBuf,
    pub agents_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve() -> Result<Self, PathError> {
        #[cfg(target_os = "windows")]
        {
            let local_data = dirs::data_local_dir().ok_or(PathError::NoHomeDir)?;
            let roaming_data = dirs::config_dir().ok_or(PathError::NoHomeDir)?;
            let home = dirs::home_dir().ok_or(PathError::NoHomeDir)?;

            let app_install_dir = local_data.join("Programs").join("frostfireOS");
            let app_data_dir = roaming_data.join("frostfireOS");
            let extensions_dir = home.join(".frostfireOS").join("extensions");
            let blackboard_dir = app_data_dir.join("blackboard");
            let custom_prompts_dir = app_data_dir.join("custom_prompts");
            let agents_dir = app_data_dir.join("agents");

            Ok(Self {
                app_install_dir,
                app_data_dir,
                extensions_dir,
                blackboard_dir,
                custom_prompts_dir,
                agents_dir,
            })
        }

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir().ok_or(PathError::NoHomeDir)?;
            let app_install_dir = PathBuf::from("/Applications/frostfireOS.app");
            let app_data_dir = home
                .join("Library")
                .join("Application Support")
                .join("frostfireOS");
            let extensions_dir = home.join(".frostfireOS").join("extensions");
            let blackboard_dir = app_data_dir.join("blackboard");
            let custom_prompts_dir = app_data_dir.join("custom_prompts");
            let agents_dir = app_data_dir.join("agents");

            Ok(Self {
                app_install_dir,
                app_data_dir,
                extensions_dir,
                blackboard_dir,
                custom_prompts_dir,
                agents_dir,
            })
        }

        #[cfg(all(
            not(any(target_os = "windows", target_os = "macos")),
            not(any(target_os = "android", target_os = "ios"))
        ))]
        {
            let home = dirs::home_dir().ok_or(PathError::NoHomeDir)?;
            let config = dirs::config_dir().unwrap_or_else(|| home.join(".config"));

            let app_install_dir = PathBuf::from("/opt/frostfireOS");
            let app_data_dir = config.join("frostfireOS");
            let extensions_dir = home.join(".frostfireOS").join("extensions");
            let blackboard_dir = app_data_dir.join("blackboard");
            let custom_prompts_dir = app_data_dir.join("custom_prompts");
            let agents_dir = app_data_dir.join("agents");

            Ok(Self {
                app_install_dir,
                app_data_dir,
                extensions_dir,
                blackboard_dir,
                custom_prompts_dir,
                agents_dir,
            })
        }

        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let base_dir = std::env::var("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/data/local/tmp"));

            let app_install_dir = base_dir.clone();
            let app_data_dir = base_dir.join("frostfireOS");
            let extensions_dir = app_data_dir.join("extensions");
            let blackboard_dir = app_data_dir.join("blackboard");
            let custom_prompts_dir = app_data_dir.join("custom_prompts");
            let agents_dir = app_data_dir.join("agents");

            Ok(Self {
                app_install_dir,
                app_data_dir,
                extensions_dir,
                blackboard_dir,
                custom_prompts_dir,
                agents_dir,
            })
        }
    }

    pub fn ensure_directories(&self) -> Result<(), PathError> {
        std::fs::create_dir_all(&self.app_data_dir)?;
        std::fs::create_dir_all(&self.extensions_dir)?;
        std::fs::create_dir_all(&self.blackboard_dir)?;
        std::fs::create_dir_all(&self.custom_prompts_dir)?;
        std::fs::create_dir_all(&self.agents_dir)?;
        Ok(())
    }
}
