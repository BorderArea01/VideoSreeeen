param([string]$SdkRoot=$env:ANDROID_SDK_ROOT,[string]$Gradle='gradle.bat',[switch]$RerunChecks)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $SdkRoot -or -not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms/android-35/android.jar'))){throw '请通过 -SdkRoot 或 ANDROID_SDK_ROOT 指定包含 Android 35 的 SDK'}
$env:ANDROID_HOME=$SdkRoot
$env:ANDROID_SDK_ROOT=$SdkRoot
[IO.File]::WriteAllText((Join-Path $workspace 'android/local.properties'),'sdk.dir='+$SdkRoot.Replace('\','/').Replace(':','\:'))
$gradleArguments=@('-p','android',':app:assembleDebug',':app:lintDebug','--no-daemon','--max-workers=1','--console=plain')
if($RerunChecks){$gradleArguments+='--rerun-tasks'}
& (Join-Path $PSScriptRoot 'controlled.ps1') -File $Gradle -Arguments $gradleArguments -PrioritizeBuildWhenNoGame
$output=Join-Path $workspace 'artifacts/android'
New-Item -ItemType Directory -Path $output -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $output 'VideoSreeeen-0.2.0-debug.apk')
Get-FileHash -LiteralPath (Join-Path $output 'VideoSreeeen-0.2.0-debug.apk') -Algorithm SHA256
