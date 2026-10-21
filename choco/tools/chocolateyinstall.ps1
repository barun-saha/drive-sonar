$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName   = 'drivesonar'
  fileType      = 'exe'
  url64Bit      = 'https://github.com/barun-saha/drive-sonar/releases/download/v0.9.0/Drive.Sonar_0.9.0_x64-setup.exe'
  checksum64    = '6b7c4e50c050ba94199fe94fd1b072de3cbb9246a4e8ae1c247158cffe2e8ef2'
  checksumType64= 'sha256'
  silentArgs    = '/S'
  validExitCodes= @(0)
}

Install-ChocolateyPackage @packageArgs
