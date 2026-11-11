<#
Seeds the NSIS toolchain cache that tauri-bundler validates before building a
Windows installer, so bundling never depends on a single HTTP GET to github.com.

Why this exists: tauri-bundler 2.10.3 (shipped by @tauri-apps/cli 2.12.x)
downloads nsis-3.13.zip and nsis_tauri_utils.dll with one unretried request.
Release run 42564996572 compiled for 9.5 minutes, then died with
`failed to bundle project: 'http status: 504'` while fetching nsis-3.13.zip.
The cache path below is exactly what bundle_project() reads:
  local_tools_directory() (unset here) -> dirs::cache_dir()/tauri
  -> %LOCALAPPDATA%\tauri\NSIS
and it is considered valid when NSIS.exe and the plugin DLL match the SHA-1s
below, so seeding it removes the download from the release path entirely.

The URLs and hashes are the constants in tauri-bundler
src/bundle/windows/nsis/mod.rs (NSIS_URL, NSIS_SHA1, NSIS_EXE_SHA1,
NSIS_TAURI_UTILS_URL, NSIS_TAURI_UTILS_SHA1). Update them in the same change
as the @tauri-apps/cli bump. A stale seed is not fatal: the bundler detects the
mismatch, discards the directory and falls back to its own download.
#>
param(
    # Override only for testing the script outside a Windows runner.
    [string]$CacheRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NsisUrl = 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip'
$NsisSha1 = 'DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E'
$NsisExeSha1 = '6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2'
$UtilsUrl = 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll'
$UtilsSha1 = '75197FEE3C6A814FE035788D1C34EAD39349B860'
$MaxAttempts = 6

if (-not $CacheRoot) {
    if (-not $env:LOCALAPPDATA) {
        throw 'prefetch-tauri-nsis.ps1: LOCALAPPDATA is not set; tauri-bundler reads its NSIS cache from %LOCALAPPDATA%\tauri on Windows'
    }
    $CacheRoot = Join-Path $env:LOCALAPPDATA 'tauri'
}

$toolset = Join-Path $CacheRoot 'NSIS'
$nsisExe = Join-Path $toolset 'NSIS.exe'
$utilsDll = Join-Path $toolset 'Plugins\x86-unicode\additional\nsis_tauri_utils.dll'

function Test-Sha1 {
    param([string]$Path, [string]$Expected)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash
    return $actual -eq $Expected.ToUpperInvariant()
}

# The bundler's own validity check, so a valid cache costs zero requests.
if ((Test-Sha1 $nsisExe $NsisExeSha1) -and (Test-Sha1 $utilsDll $UtilsSha1)) {
    Write-Output "NSIS cache already valid at $toolset"
    exit 0
}

function Get-PinnedFile {
    param([string]$Url, [string]$Sha1, [string]$Destination)
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Destination -MaximumRedirection 10 -TimeoutSec 120
            if (-not (Test-Sha1 $Destination $Sha1)) {
                $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA1).Hash
                throw "SHA-1 mismatch (expected $Sha1, got $actual)"
            }
            return
        } catch {
            if ($attempt -eq $MaxAttempts) {
                throw "could not download $Url after $MaxAttempts attempts: $($_.Exception.Message)"
            }
            $delay = 5 * $attempt
            Write-Output "::warning::download attempt $attempt/$MaxAttempts failed for $Url ($($_.Exception.Message)); retrying in ${delay}s"
            Start-Sleep -Seconds $delay
        }
    }
}

$staging = Join-Path ([IO.Path]::GetTempPath()) ("tauri-nsis-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    $zip = Join-Path $staging 'nsis.zip'
    Get-PinnedFile -Url $NsisUrl -Sha1 $NsisSha1 -Destination $zip

    Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
    $extracted = Join-Path $staging 'nsis-3.13'
    if (-not (Test-Path -LiteralPath $extracted)) {
        throw "nsis-3.13.zip did not contain the expected nsis-3.13 directory"
    }
    if (-not (Test-Sha1 (Join-Path $extracted 'NSIS.exe') $NsisExeSha1)) {
        throw "extracted NSIS.exe does not match the SHA-1 tauri-bundler expects ($NsisExeSha1)"
    }

    Remove-Item -LiteralPath $toolset -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
    Move-Item -LiteralPath $extracted -Destination $toolset

    New-Item -ItemType Directory -Path (Split-Path -Parent $utilsDll) -Force | Out-Null
    Get-PinnedFile -Url $UtilsUrl -Sha1 $UtilsSha1 -Destination $utilsDll

    Write-Output "Seeded NSIS cache at $toolset"
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
