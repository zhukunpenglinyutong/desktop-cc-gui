<#
Authenticode-signs one file for `tauri build`. release.yml merges this in as
bundle.windows.signCommand only when a signing provider is configured; Tauri
then calls it for the app exe, every extra binary, and the NSIS installer and
uninstaller. An unsigned exe is the main reason endpoint security scores the
installer as untrusted, so a release configured to sign fails instead of
shipping anything unsigned.

Providers, picked from the environment (first match wins):

1. Azure Trusted Signing (via trusted-signing-cli, installed by release.yml)
     vars:    AZURE_SIGNING_ENDPOINT  e.g. https://eus.codesigning.azure.net
              AZURE_SIGNING_ACCOUNT   AZURE_SIGNING_PROFILE
     secrets: AZURE_TENANT_ID  AZURE_CLIENT_ID  AZURE_CLIENT_SECRET

2. Certificate via signtool
     secrets: WINDOWS_CERTIFICATE_PFX_B64 (release.yml decodes it into
              WINDOWS_CERTIFICATE_PFX) + WINDOWS_CERTIFICATE_PASSWORD
     or var:  WINDOWS_CERTIFICATE_THUMBPRINT for a certificate already in the
              runner's store (hardware token on a self-hosted runner)
     optional var: WINDOWS_TIMESTAMP_URL (default DigiCert's RFC 3161 server)
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$File
)

$ErrorActionPreference = 'Stop'
$Description = 'CC GUI'

function Find-SignTool {
    $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $found = Get-ChildItem -Path $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq 'x64' } |
        Sort-Object { $_.Directory.Parent.Name } -Descending |
        Select-Object -First 1
    if (-not $found) { throw 'windows-sign.ps1: signtool.exe not found (install the Windows SDK)' }
    return $found.FullName
}

if (-not (Test-Path -LiteralPath $File)) {
    throw "windows-sign.ps1: no such file: $File"
}

if ($env:AZURE_SIGNING_ENDPOINT) {
    foreach ($name in 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET') {
        if (-not [Environment]::GetEnvironmentVariable($name)) {
            throw "windows-sign.ps1: Azure Trusted Signing needs $name"
        }
    }
    & trusted-signing-cli `
        -e $env:AZURE_SIGNING_ENDPOINT `
        -a $env:AZURE_SIGNING_ACCOUNT `
        -c $env:AZURE_SIGNING_PROFILE `
        -d $Description `
        $File
}
elseif ($env:WINDOWS_CERTIFICATE_PFX -or $env:WINDOWS_CERTIFICATE_THUMBPRINT) {
    $timestamp = if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }
    $signArgs = @('sign', '/fd', 'sha256', '/tr', $timestamp, '/td', 'sha256', '/d', $Description)
    if ($env:WINDOWS_CERTIFICATE_PFX) {
        $signArgs += @('/f', $env:WINDOWS_CERTIFICATE_PFX)
        if ($env:WINDOWS_CERTIFICATE_PASSWORD) { $signArgs += @('/p', $env:WINDOWS_CERTIFICATE_PASSWORD) }
    }
    else {
        $signArgs += @('/sha1', $env:WINDOWS_CERTIFICATE_THUMBPRINT)
    }
    $signtool = Find-SignTool
    & $signtool @signArgs $File
}
else {
    throw 'windows-sign.ps1: no signing provider configured (see the header of this script)'
}

if ($LASTEXITCODE -ne 0) {
    throw "windows-sign.ps1: signing failed with exit code ${LASTEXITCODE}: $File"
}
