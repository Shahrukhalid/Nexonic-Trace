param(
  [Parameter(Mandatory=$true)][ValidateSet('Import','Sign','Verify','Cleanup')][string]$Action,
  [string]$Path
)
$ErrorActionPreference = 'Stop'
function Require-Value([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Required signing setting missing: $name" }
  return $value
}
function Verify-File([string]$file) {
  $expected = Require-Value 'WINDOWS_EXPECTED_PUBLISHER'
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
    throw 'A trusted, timestamped Authenticode signature is required.'
  }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if (-not [string]::Equals($publisher, $expected, [StringComparison]::Ordinal)) {
    throw 'The signing publisher does not match the protected publisher setting.'
  }
  if (-not ($signature.SignerCertificate.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) {
    throw 'The signer is not a code-signing certificate.'
  }
}
switch ($Action) {
  'Import' {
    $thumbprint = (Require-Value 'WINDOWS_CERTIFICATE_THUMBPRINT').Replace(' ', '').ToUpperInvariant()
    if ($thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Invalid certificate thumbprint setting.' }
    if (Test-Path "Cert:\CurrentUser\My\$thumbprint") { throw 'Refusing to replace an existing signing identity.' }
    $password = ConvertTo-SecureString (Require-Value 'WINDOWS_CERTIFICATE_PASSWORD') -AsPlainText -Force
    $metadata = Get-PfxData -FilePath (Require-Value 'NEXONIC_WINDOWS_PFX') -Password $password
    if ($metadata.EndEntityCertificates.Count -ne 1 -or $metadata.EndEntityCertificates[0].Thumbprint -ne $thumbprint) {
      throw 'PFX certificate does not match the protected signing identity.'
    }
    $cert = Import-PfxCertificate -FilePath (Require-Value 'NEXONIC_WINDOWS_PFX') -CertStoreLocation 'Cert:\CurrentUser\My' -Password $password
    "NEXONIC_IMPORTED_CERT_THUMBPRINT=$thumbprint" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
    if ($cert.Thumbprint -ne $thumbprint -or -not $cert.HasPrivateKey -or -not $cert.Verify()) {
      throw 'Imported certificate is not the expected trusted signing identity.'
    }
  }
  'Sign' {
    $thumbprint = Require-Value 'WINDOWS_CERTIFICATE_THUMBPRINT'
    $tool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
    if ($null -eq $tool) { throw 'Windows SDK SignTool is unavailable.' }
    & $tool.FullName sign /sha1 $thumbprint /s My /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $Path
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
    Verify-File $Path
  }
  'Verify' { Verify-File $Path }
  'Cleanup' {
    $thumbprint = $env:NEXONIC_IMPORTED_CERT_THUMBPRINT
    if ($thumbprint -match '^[A-Fa-f0-9]{40}$' -and (Test-Path "Cert:\CurrentUser\My\$thumbprint")) {
      Remove-Item "Cert:\CurrentUser\My\$thumbprint" -DeleteKey
    }
  }
}
