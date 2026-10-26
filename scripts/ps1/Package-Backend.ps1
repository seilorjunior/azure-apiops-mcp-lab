#Requires -Version 7.2
. (Join-Path $PSScriptRoot 'Common.ps1')
$stage = Join-Path $script:Root '.local\backend'
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $stage -Force
foreach ($name in @('package.json', 'package-lock.json', 'src')) {
    Copy-Item -LiteralPath (Join-Path $script:Root $name) -Destination $stage -Recurse
}
Write-Host 'Staged backend application only; no Azure state, APIops artifacts or credentials included.'
