import packageJson from "../../package.json";

export const APP_VERSION: string = packageJson.version;

export async function getAppVersion(): Promise<string> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // Fallback to static package version
    }
  }
  return APP_VERSION;
}
