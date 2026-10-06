use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!("cargo:rerun-if-changed=src");
    for reference in ["HEAD", "packed-refs"] {
        if let Some(path) = git(&["rev-parse", "--git-path", reference]) {
            if std::path::Path::new(&path).exists() {
                println!("cargo:rerun-if-changed={path}");
            }
        }
    }
    if let Some(reference) = git(&["symbolic-ref", "--quiet", "HEAD"]) {
        if let Some(path) = git(&["rev-parse", "--git-path", &reference]) {
            if std::path::Path::new(&path).exists() {
                println!("cargo:rerun-if-changed={path}");
            }
        }
    }
    let commit = std::env::var("GITHUB_SHA")
        .ok()
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .filter(|sha| sha.len() >= 12 && sha.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|sha| sha[..12].to_string())
        .unwrap_or_else(|| "unknown".into());
    let dirty = Command::new("git")
        .args(["diff", "--quiet", "HEAD"])
        .status()
        .ok()
        .is_some_and(|status| status.code() == Some(1));
    println!(
        "cargo:rustc-env=LUNA_BUILD_COMMIT={commit}{}",
        if dirty { "-dirty" } else { "" }
    );
    println!(
        "cargo:rustc-env=LUNA_BUILD_PROFILE={}",
        std::env::var("PROFILE").unwrap_or_else(|_| "unknown".into())
    );
    tauri_build::build()
}
