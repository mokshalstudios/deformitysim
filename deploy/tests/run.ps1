[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$deployRoot = Split-Path -Parent $PSScriptRoot
$php = (Get-Command php -ErrorAction Stop).Source
$phpFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $deployRoot 'htdocs') -Recurse -File -Filter '*.php'
    Get-ChildItem -LiteralPath (Join-Path $deployRoot 'tools') -Recurse -File -Filter '*.php'
    Get-ChildItem -LiteralPath (Join-Path $deployRoot 'tests') -Recurse -File -Filter '*.php'
) | Sort-Object FullName -Unique

foreach ($file in $phpFiles) {
    & $php -l $file.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "PHP lint failed: $($file.FullName)"
    }
}

& $php (Join-Path $PSScriptRoot 'run.php')
if ($LASTEXITCODE -ne 0) {
    throw 'Deployment smoke tests failed.'
}
