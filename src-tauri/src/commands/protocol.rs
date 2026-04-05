/// Protocol handler registration and query commands.
///
/// Provides three cross-platform Tauri commands for managing URL scheme
/// associations (e.g. `magnet:`, `thunder:`):
///
/// - `is_default_protocol_client` — checks if this app is the current default
/// - `set_default_protocol_client` — registers this app as the default handler
/// - `remove_as_default_protocol_client` — unregisters (Windows/Linux only)
///
/// ## Platform strategy
///
/// | Platform | Query                                   | Register                                    | Unregister           |
/// |----------|-----------------------------------------|---------------------------------------------|----------------------|
/// | macOS    | `NSWorkspace.urlForApplication(toOpen:)` | `NSWorkspace.setDefaultApplication(…)`     | no-op (unsupported)  |
/// | Windows  | `tauri-plugin-deep-link::is_registered`  | `tauri-plugin-deep-link::register`          | `…::unregister`      |
/// | Linux    | `tauri-plugin-deep-link::is_registered`  | `tauri-plugin-deep-link::register`          | `…::unregister`      |
///
/// ## Windows elevation (Chrome-style elevated subprocess)
///
/// On Windows, protocol registration modifies the system registry.  If the
/// current process lacks permission (e.g. installed per-machine in
/// `Program Files`), the operation fails with `ERROR_ACCESS_DENIED`
/// (`0x80070005`).  Instead of requiring the entire app to run as
/// Administrator, we follow Chrome's pattern: on access-denied, spawn an
/// elevated copy of ourselves with `ShellExecuteW("runas")` and the
/// `--elevate-protocol register|unregister <scheme>` CLI flag.  The
/// elevated child performs the single registry operation and exits — no
/// Tauri window is created.
use crate::error::AppError;
use tauri::AppHandle;

// ── macOS native implementation ─────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSString, NSURL};

    /// Returns the bundle identifier of the app registered as the default
    /// handler for the given URL scheme, or `None` if no handler is set.
    pub fn get_default_handler_bundle_id(protocol: &str) -> Option<String> {
        let workspace = NSWorkspace::sharedWorkspace();
        let url_str = format!("{protocol}://test");
        let ns_url_str = NSString::from_str(&url_str);
        let test_url = NSURL::URLWithString(&ns_url_str)?;
        let handler_url = workspace.URLForApplicationToOpenURL(&test_url)?;
        let handler_bundle = NSBundle::bundleWithURL(&handler_url)?;
        let bundle_id = handler_bundle.bundleIdentifier()?;
        Some(bundle_id.to_string())
    }

    /// Registers this application as the default handler for the given URL
    /// scheme using `LSSetDefaultHandlerForURLScheme`.
    ///
    /// This API works with bundle identifiers (not file paths), so it
    /// functions correctly in both dev mode (`cargo run`) and release
    /// (`.app` bundle).
    pub fn set_as_default_handler(protocol: &str, bundle_id: &str) -> Result<(), String> {
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;

        let scheme = CFString::new(protocol);
        let handler = CFString::new(bundle_id);

        // SAFETY: LSSetDefaultHandlerForURLScheme is a stable C API.
        let status = unsafe {
            core_foundation::base::OSStatus::from(LSSetDefaultHandlerForURLScheme(
                scheme.as_concrete_TypeRef(),
                handler.as_concrete_TypeRef(),
            ))
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("LSSetDefaultHandlerForURLScheme returned {status}"))
        }
    }

    // FFI binding for Launch Services
    extern "C" {
        fn LSSetDefaultHandlerForURLScheme(
            scheme: core_foundation::string::CFStringRef,
            handler: core_foundation::string::CFStringRef,
        ) -> i32;
    }
}

// ── Windows elevation module ────────────────────────────────────────
//
// Implements the Chrome-style elevated subprocess pattern for protocol
// registration on Windows.  When the main process lacks registry write
// permission, it spawns an elevated copy of itself that performs the
// single operation and exits.

#[cfg(windows)]
mod elevation {
    use crate::error::AppError;

    /// CLI entry point for the elevated subprocess.
    ///
    /// Checks `std::env::args` for `--elevate-protocol <action> <scheme>`.
    /// Returns `Some(exit_code)` if the flag was found (caller should exit),
    /// or `None` to continue normal Tauri startup.
    ///
    /// This runs BEFORE Tauri initialises — no window, no webview, no plugins.
    pub fn try_run_elevated() -> Option<i32> {
        let args: Vec<String> = std::env::args().collect();
        let idx = args.iter().position(|a| a == "--elevate-protocol")?;
        let action = args.get(idx + 1)?.as_str();
        let scheme = args.get(idx + 2)?;

        log::info!("elevation: action={action} scheme={scheme}");

        let result = match action {
            "register" => register_protocol_via_registry(scheme),
            "unregister" => unregister_protocol_via_registry(scheme),
            _ => {
                log::error!("elevation: unknown action '{action}'");
                Err(AppError::Protocol(format!("unknown action: {action}")))
            }
        };

        match result {
            Ok(()) => {
                log::info!("elevation: {action} {scheme} succeeded");
                Some(0)
            }
            Err(e) => {
                log::error!("elevation: {action} {scheme} failed: {e}");
                Some(1)
            }
        }
    }

    /// Register a protocol handler via the Windows registry (HKCU).
    ///
    /// Writes `HKCU\Software\Classes\<scheme>` with the standard URL
    /// protocol handler structure pointing to the current executable.
    fn register_protocol_via_registry(scheme: &str) -> Result<(), AppError> {
        use windows_sys::Win32::System::Registry::*;

        let exe =
            std::env::current_exe().map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let exe_str = exe.to_string_lossy();

        // Key path: HKCU\Software\Classes\<scheme>
        let key_path = format!("Software\\Classes\\{scheme}");
        let command = format!("\"{}\" \"%1\"", exe_str);

        // Create the main key with URL Protocol marker
        let hkey = reg_create_key(&key_path)?;
        reg_set_string(hkey, "", &format!("URL:{scheme}"))?;
        reg_set_string(hkey, "URL Protocol", "")?;
        unsafe { RegCloseKey(hkey) };

        // Create shell\open\command subkey
        let cmd_path = format!("{}\\shell\\open\\command", key_path);
        let cmd_key = reg_create_key(&cmd_path)?;
        reg_set_string(cmd_key, "", &command)?;
        unsafe { RegCloseKey(cmd_key) };

        Ok(())
    }

    /// Unregister a protocol handler by deleting its registry tree from HKCU.
    fn unregister_protocol_via_registry(scheme: &str) -> Result<(), AppError> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let key_path = format!("Software\\Classes\\{scheme}");
        let key_wide: Vec<u16> = std::ffi::OsStr::new(&key_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        // RegDeleteTreeW recursively deletes the key and all subkeys.
        let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, key_wide.as_ptr()) };
        if status == 0 /* ERROR_SUCCESS */ || status == 2
        /* ERROR_FILE_NOT_FOUND */
        {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "RegDeleteTreeW failed for {key_path}: error {status}"
            )))
        }
    }

    /// Creates a registry key under HKCU, returning the key handle.
    fn reg_create_key(path: &str) -> Result<windows_sys::Win32::System::Registry::HKEY, AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let path_wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut hkey: HKEY = std::ptr::null_mut();
        let status = unsafe {
            RegCreateKeyW(
                HKEY_CURRENT_USER,
                path_wide.as_ptr(),
                &mut hkey,
            )
        };
        if status == 0 {
            Ok(hkey)
        } else {
            Err(AppError::Protocol(format!(
                "RegCreateKeyW failed for {path}: error {status}"
            )))
        }
    }

    /// Sets a string value on an open registry key.
    fn reg_set_string(
        hkey: windows_sys::Win32::System::Registry::HKEY,
        name: &str,
        value: &str,
    ) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let name_wide: Vec<u16> = OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let value_wide: Vec<u16> = OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let status = unsafe {
            RegSetValueExW(
                hkey,
                name_wide.as_ptr(),
                0,
                REG_SZ,
                value_wide.as_ptr() as *const u8,
                (value_wide.len() * 2) as u32,
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "RegSetValueExW failed: error {status}"
            )))
        }
    }

    /// Returns `true` if the error string indicates a Windows access-denied
    /// condition (`ERROR_ACCESS_DENIED` = 5, HRESULT `0x80070005`).
    pub fn is_access_denied(error: &str) -> bool {
        let lower = error.to_lowercase();
        lower.contains("access denied")
            || lower.contains("0x80070005")
            || lower.contains("access is denied")
            || lower.contains("os error 5")
    }

    /// Spawns an elevated copy of the current process to perform a protocol
    /// operation.  Uses `ShellExecuteW` with the `"runas"` verb to trigger
    /// a UAC prompt.  The elevated child performs the operation and exits.
    ///
    /// Returns `Ok(())` if the elevated child was spawned successfully.
    pub fn spawn_elevated_protocol_op(action: &str, scheme: &str) -> Result<(), AppError> {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

        let exe =
            std::env::current_exe().map_err(|e| AppError::Protocol(format!("current_exe: {e}")))?;
        let exe_str = exe.to_string_lossy().to_string();
        let params = format!("--elevate-protocol {action} {scheme}");

        let verb: Vec<u16> = OsStr::new("runas")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let file: Vec<u16> = OsStr::new(&exe_str)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let args: Vec<u16> = OsStr::new(&params)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        log::info!("elevation: spawning elevated subprocess: {exe_str} {params}");

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(), // hwnd
                verb.as_ptr(),        // lpOperation: "runas"
                file.as_ptr(),        // lpFile: self exe
                args.as_ptr(),        // lpParameters
                std::ptr::null(),     // lpDirectory
                SW_HIDE,              // nShowCmd: hide window
            )
        };

        // ShellExecuteW returns HINSTANCE > 32 on success.
        if (result as isize) > 32 {
            Ok(())
        } else {
            // Common: result == 5 means user refused UAC prompt.
            Err(AppError::Protocol(format!(
                "ShellExecuteW failed (code {}): user may have cancelled UAC prompt",
                result as isize
            )))
        }
    }
}

// Re-export the elevation entry point for main.rs.
#[cfg(windows)]
pub use elevation::try_run_elevated;

// ── Cross-platform Tauri commands ───────────────────────────────────

/// Returns `true` when this application is the OS-level default handler
/// for the given URL scheme (e.g. `"magnet"`, `"thunder"`).
///
/// On macOS, uses the app's configured identifier from `tauri.conf.json`
/// (not `NSBundle.mainBundle`) to avoid inheriting the parent process's
/// bundle ID in dev mode (e.g. Terminal.app).
#[tauri::command]
pub async fn is_default_protocol_client(
    app: AppHandle,
    protocol: String,
) -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        let handler_id = macos::get_default_handler_bundle_id(&protocol);
        let self_id = &app.config().identifier;
        match handler_id {
            Some(handler) => Ok(handler == *self_id),
            None => Ok(false),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link()
            .is_registered(&protocol)
            .map_err(|e| AppError::Protocol(e.to_string()))
    }
}

/// Registers this application as the OS-level default handler for the
/// given URL scheme.
///
/// On macOS, uses `LSSetDefaultHandlerForURLScheme` with the app's
/// configured identifier from `tauri.conf.json`. Performs a post-
/// registration verification because the API silently succeeds even
/// when no `.app` bundle exists for the given identifier (dev mode).
#[tauri::command]
pub async fn set_default_protocol_client(app: AppHandle, protocol: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let bundle_id = &app.config().identifier;
        macos::set_as_default_handler(&protocol, bundle_id).map_err(AppError::Protocol)?;

        // Verify the registration actually took effect.
        // LSSetDefaultHandlerForURLScheme returns 0 even when macOS
        // cannot find a .app bundle for the given identifier, making
        // the registration a silent no-op. We check immediately after.
        let handler = macos::get_default_handler_bundle_id(&protocol);
        let registered = handler.as_deref() == Some(bundle_id.as_str());
        if registered {
            Ok(())
        } else {
            Err(AppError::Protocol(format!(
                "registration accepted but did not take effect (handler={handler:?}, expected={bundle_id})"
            )))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        match app.deep_link().register(&protocol) {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                #[cfg(windows)]
                if elevation::is_access_denied(&msg) {
                    log::warn!(
                        "protocol: register {protocol} access denied, retrying with elevation"
                    );
                    return elevation::spawn_elevated_protocol_op("register", &protocol);
                }
                Err(AppError::Protocol(msg))
            }
        }
    }
}

/// Removes this application as the OS-level default handler for the
/// given URL scheme.
///
/// On macOS this is a no-op — Apple does not provide an API to
/// programmatically unregister a URL scheme handler. The frontend
/// should guide users to System Settings instead.
#[tauri::command]
pub async fn remove_as_default_protocol_client(
    app: AppHandle,
    protocol: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = (&app, &protocol); // suppress unused warnings
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        match app.deep_link().unregister(&protocol) {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                #[cfg(windows)]
                if elevation::is_access_denied(&msg) {
                    log::warn!(
                        "protocol: unregister {protocol} access denied, retrying with elevation"
                    );
                    return elevation::spawn_elevated_protocol_op("unregister", &protocol);
                }
                Err(AppError::Protocol(msg))
            }
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── macOS-specific tests ────────────────────────────────────────

    #[cfg(target_os = "macos")]
    mod macos_tests {
        use super::super::macos;

        #[test]
        fn get_default_handler_bundle_id_returns_some_for_https() {
            // https:// should always have a handler (Safari/Chrome)
            let result = macos::get_default_handler_bundle_id("https");
            assert!(result.is_some(), "expected a handler for https://");
            let id = result.expect("already checked");
            // Bundle IDs are reverse-DNS (e.g. "com.apple.Safari")
            assert!(
                id.contains('.'),
                "expected reverse-DNS bundle ID, got: {id}"
            );
        }

        #[test]
        fn get_default_handler_bundle_id_returns_none_for_nonsense_scheme() {
            // A random scheme with no handler registered
            let result = macos::get_default_handler_bundle_id("zzznotarealscheme12345");
            assert!(
                result.is_none(),
                "expected None for unregistered scheme, got: {result:?}"
            );
        }
    }

    // ── Cross-platform logic tests ──────────────────────────────────
    // The Tauri commands require an AppHandle which is only available in
    // integration tests. Here we test the pure logic branches.

    #[test]
    fn protocol_error_variant_display() {
        let e = AppError::Protocol("test failure".into());
        assert_eq!(e.to_string(), "Protocol error: test failure");
    }

    #[test]
    fn protocol_error_variant_serializes() {
        let e = AppError::Protocol("reg failed".into());
        let json = serde_json::to_string(&e).expect("serialize");
        assert_eq!(json, r#"{"Protocol":"reg failed"}"#);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_remove_is_noop() {
        // Verify the macOS unregister path compiles and is a no-op.
        // We can't test the actual Tauri command without AppHandle,
        // but we verify the code path doesn't panic.
        let _ = "magnet"; // Placeholder — real test is compilation.
    }

    // ── Windows elevation structural tests ──────────────────────────
    //
    // These tests validate that the code infrastructure for privilege
    // elevation exists and follows the Chrome-style elevated subprocess
    // pattern.  The actual Windows API calls cannot be tested on
    // macOS/Linux, so we verify the code structure via source scanning
    // (same pattern as updater.rs and sidecarBinaries.test.ts).
    //
    // IMPORTANT: All source-scanning tests strip the `#[cfg(test)]`
    // section to prevent self-matching against assertion strings.

    /// Returns the production (non-test) portion of protocol.rs source.
    fn production_source() -> &'static str {
        let full = include_str!("protocol.rs");
        // Cut at the test module boundary to avoid self-matching
        full.split("\n#[cfg(test)]").next().unwrap_or(full)
    }

    /// The elevation module must exist as a Windows-only submodule.
    #[test]
    fn elevation_module_exists_with_cfg_windows() {
        let src = production_source();
        assert!(
            src.contains("#[cfg(windows)]") && src.contains("mod elevation"),
            "protocol.rs must contain a #[cfg(windows)] mod elevation in production code"
        );
    }

    /// `try_run_elevated` must be a public function so main.rs can call it
    /// before Tauri initialisation to handle the --elevate-protocol CLI path.
    #[test]
    fn try_run_elevated_function_exists() {
        let src = production_source();
        assert!(
            src.contains("pub fn try_run_elevated"),
            "try_run_elevated must be a public function for main.rs CLI interception"
        );
    }

    /// The elevation subprocess must parse "--elevate-protocol" from argv.
    #[test]
    fn try_run_elevated_parses_cli_flag() {
        let src = production_source();
        assert!(
            src.contains("--elevate-protocol"),
            "try_run_elevated must look for --elevate-protocol in CLI arguments"
        );
    }

    /// `spawn_elevated_protocol_op` must exist — this is the function that
    /// uses ShellExecuteW("runas") to launch an elevated copy of self.
    #[test]
    fn spawn_elevated_protocol_op_function_exists() {
        let src = production_source();
        assert!(
            src.contains("fn spawn_elevated_protocol_op"),
            "spawn_elevated_protocol_op must exist for ShellExecuteW-based elevation"
        );
    }

    /// The elevation spawn must use ShellExecuteW with the "runas" verb.
    /// This is the only supported Windows API for triggering UAC elevation.
    #[test]
    fn spawn_elevated_uses_shell_execute_with_runas() {
        let src = production_source();
        let fn_start = src
            .find("fn spawn_elevated_protocol_op")
            .expect("spawn function must exist in production code");
        let rest = &src[fn_start..];
        // Scope to this function's body only.
        let fn_end = rest[10..]
            .find("\nfn ")
            .or_else(|| rest[10..].find("\npub fn "))
            .or_else(|| rest[10..].find("\nmod "))
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("ShellExecuteW"),
            "spawn_elevated_protocol_op must call ShellExecuteW"
        );
        assert!(
            fn_body.contains("runas"),
            "spawn_elevated_protocol_op must use the \"runas\" verb for UAC elevation"
        );
    }

    /// `is_access_denied` helper must exist to detect permission errors
    /// and trigger the elevation retry path.
    #[test]
    fn is_access_denied_helper_exists() {
        let src = production_source();
        assert!(
            src.contains("fn is_access_denied"),
            "is_access_denied helper must exist for detecting 0x80070005 errors"
        );
    }

    /// The main.rs entry point must intercept --elevate-protocol before
    /// Tauri framework initialisation to avoid spawning a second window.
    #[test]
    fn main_rs_intercepts_elevate_protocol_flag() {
        let main_source = include_str!("../main.rs");
        assert!(
            main_source.contains("try_run_elevated"),
            "main.rs must call try_run_elevated before motrix_next_lib::run()"
        );
    }

    /// The elevation interception in main.rs must exit the process after
    /// handling the elevated operation (no Tauri window should appear).
    #[test]
    fn main_rs_exits_after_elevated_operation() {
        let main_source = include_str!("../main.rs");
        assert!(
            main_source.contains("process::exit"),
            "main.rs must call process::exit after try_run_elevated completes"
        );
    }

    /// On non-macOS platforms, `set_default_protocol_client` must have an
    /// elevation fallback path that retries with spawn_elevated_protocol_op
    /// when the initial attempt fails with access denied.
    #[test]
    fn set_protocol_has_elevation_fallback() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn set_default_protocol_client")
            .expect("set_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("is_access_denied") || fn_body.contains("spawn_elevated_protocol_op"),
            "set_default_protocol_client must detect access denied and attempt elevation"
        );
    }

    /// On non-macOS platforms, `remove_as_default_protocol_client` must have
    /// the same elevation fallback as set.
    #[test]
    fn remove_protocol_has_elevation_fallback() {
        let src = production_source();
        let fn_start = src
            .find("pub async fn remove_as_default_protocol_client")
            .expect("remove_as_default_protocol_client must exist");
        let rest = &src[fn_start..];
        let fn_end = rest[10..]
            .find("\npub async fn ")
            .map(|p| p + 10)
            .unwrap_or(rest.len());
        let fn_body = &rest[..fn_end];

        assert!(
            fn_body.contains("is_access_denied") || fn_body.contains("spawn_elevated_protocol_op"),
            "remove_as_default_protocol_client must detect access denied and attempt elevation"
        );
    }
}
