//! Build script: compiles the Apple Intelligence Swift bridge
//! (swift/CRMIntelligence) for the architecture being built and links it in,
//! then runs Tauri's own build step.

use std::path::PathBuf;
use std::process::Command;

/// Lowest macOS the app supports. 13+ because the Command Line Tools no longer ship
/// the Intel copy of Swift's back-compatibility library needed below 12.3.
const MACOS_MIN: &str = "13.0";

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_swift_bridge();
    }
    tauri_build::build()
}

fn run(cmd: &mut Command) -> String {
    let out = cmd.output().unwrap_or_else(|e| panic!("failed to run {cmd:?}: {e}"));
    if !out.status.success() {
        panic!(
            "{cmd:?} failed:\n{}\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn build_swift_bridge() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let package = manifest.join("swift/CRMIntelligence");
    println!("cargo:rerun-if-changed={}", package.join("Sources").display());
    println!("cargo:rerun-if-changed={}", package.join("Package.swift").display());

    // Build for the Rust target's architecture (the universal build runs this twice).
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        other => other,
    }
    .to_string();
    let triple = format!("{arch}-apple-macosx{MACOS_MIN}");
    let config = if std::env::var("PROFILE").as_deref() == Ok("release") { "release" } else { "debug" };
    let scratch = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("swift-build");
    let sdk = run(Command::new("xcrun").args(["--sdk", "macosx", "--show-sdk-path"]));

    let swift_build = |extra: &[&str]| {
        let mut cmd = Command::new("swift");
        cmd.arg("build")
            .args(["--package-path", package.to_str().unwrap()])
            .args(["--scratch-path", scratch.to_str().unwrap()])
            .args(["-c", config])
            .args(["--triple", &triple])
            .args(["--sdk", &sdk])
            .args(extra);
        cmd
    };
    run(&mut swift_build(&[]));
    let bin_path = run(&mut swift_build(&["--show-bin-path"]));
    println!("cargo:rustc-link-search=native={bin_path}");
    println!("cargo:rustc-link-lib=static=CRMIntelligence");

    // Swift runtime libraries (part of macOS) and the compiler runtime used by `#available`.
    let info = run(Command::new("swift").args(["-print-target-info", "-target", &triple]));
    let info: serde_json::Value = serde_json::from_str(&info).expect("swift target info");
    for path in info["paths"]["runtimeLibraryPaths"].as_array().into_iter().flatten() {
        if let Some(p) = path.as_str() {
            println!("cargo:rustc-link-search=native={p}");
        }
    }
    let clang_dirs = run(Command::new("xcrun").args(["clang", "--print-search-dirs"]));
    if let Some(libs) = clang_dirs.lines().find_map(|l| l.strip_prefix("libraries: =")) {
        for dir in libs.split(':') {
            println!("cargo:rustc-link-search=native={dir}/lib/darwin");
        }
    }
    println!("cargo:rustc-link-lib=clang_rt.osx");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
