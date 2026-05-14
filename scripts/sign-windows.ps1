param(
  [string]$BundleDir = "src-tauri\target\release\bundle",
  [string]$TimestampUrl = $env:SIGN_TIMESTAMP_URL,
  [string]$CertificateThumbprint = $env:SIGN_CERT_THUMBPRINT,
  [string]$SignToolPath = $env:SIGNTOOL_PATH
)

$ErrorActionPreference = "Stop"

if (-not $TimestampUrl) {
  $TimestampUrl = "http://timestamp.digicert.com"
}

if (-not $CertificateThumbprint) {
  throw "SIGN_CERT_THUMBPRINT is required for Windows code signing."
}

if (-not $SignToolPath) {
  $SignToolPath = "signtool.exe"
}

$targets = Get-ChildItem -Path $BundleDir -Recurse -Include *.exe,*.msi -File

if (-not $targets) {
  throw "No .exe or .msi artifacts found under $BundleDir."
}

foreach ($target in $targets) {
  & $SignToolPath sign /fd SHA256 /tr $TimestampUrl /td SHA256 /sha1 $CertificateThumbprint $target.FullName

  if ($LASTEXITCODE -ne 0) {
    throw "Signing failed for $($target.FullName)."
  }
}

Write-Host "Signed $($targets.Count) artifact(s)."
