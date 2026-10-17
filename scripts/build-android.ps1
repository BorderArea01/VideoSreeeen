param([string]$SdkRoot=$env:ANDROID_SDK_ROOT,[string]$Gradle='gradle.bat',[switch]$RerunChecks,[switch]$Release)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $SdkRoot -or -not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms/android-35/android.jar'))){throw '请通过 -SdkRoot 或 ANDROID_SDK_ROOT 指定包含 Android 35 的 SDK'}
$env:ANDROID_HOME=$SdkRoot
$env:ANDROID_SDK_ROOT=$SdkRoot
[IO.File]::WriteAllText((Join-Path $workspace 'android/local.properties'),'sdk.dir='+$SdkRoot.Replace('\','/').Replace(':','\:'))
$variant=if($Release){'release'}else{'debug'}
if($Release -and -not $env:VS_ANDROID_KEYSTORE){
  $signingRoot='D:/CodexData/local-secrets/VideoSreeeen'
  $env:VS_ANDROID_KEYSTORE=Join-Path $signingRoot 'android-release.jks'
  if(-not (Test-Path -LiteralPath $env:VS_ANDROID_KEYSTORE)){throw '缺少固定发布签名，禁止生成无法延续更新的临时签名。请配置 VS_ANDROID_KEYSTORE 和 VS_ANDROID_STORE_PASSWORD。'}
  $secure=(Get-Content -LiteralPath (Join-Path $signingRoot 'android-password.dpapi') -Raw).Trim() | ConvertTo-SecureString
  $env:VS_ANDROID_STORE_PASSWORD=[Net.NetworkCredential]::new('', $secure).Password
}
$capital=if($Release){'Release'}else{'Debug'}
$gradleArguments=@('-p','android',":app:assemble$capital",":app:lint$capital",'--no-daemon','--max-workers=1','--console=plain')
if($RerunChecks){$gradleArguments+='--rerun-tasks'}
try{& (Join-Path $PSScriptRoot 'controlled.ps1') -File $Gradle -Arguments $gradleArguments -PrioritizeBuildWhenNoGame}finally{if($Release){Remove-Item Env:VS_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue}}
$output=Join-Path $workspace 'artifacts/android'
New-Item -ItemType Directory -Path $output -Force|Out-Null
$package=Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
$name=if($Release){'VideoSreeeen-Android.apk'}else{"VideoSreeeen-$($package.version)-debug.apk"}
Copy-Item -LiteralPath (Join-Path $workspace "android/app/build/outputs/apk/$variant/app-$variant.apk") -Destination (Join-Path $output $name)
Get-FileHash -LiteralPath (Join-Path $output $name) -Algorithm SHA256
