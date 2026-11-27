#!/usr/bin/env sh
# Compiles the Games SDK against API stand-ins and runs its checks (needs Mono's mcs and mono).
# Compiles the core, the Firebase/Crashlytics and AdMob modules and the KPI wrapper (../../unity) together,
# type-checks the editor code against UnityEditor stand-ins, and checks every package file has a .meta.
# This proves the SDK's own logic and consistency, not that it compiles against the real Unity/Google SDKs.
set -eu
cd "$(dirname "$0")"
out="${TMPDIR:-/tmp}/games-sdk-test.exe"
runtime="../Runtime/Core/*.cs ../Runtime/Firebase/*.cs ../Runtime/AdMob/*.cs ../../unity/Runtime/*.cs"
# shellcheck disable=SC2086
mcs -langversion:Latest -nologo -warnaserror+ -nowarn:1591 -define:GAMES_SDK_FIREBASE -define:GAMES_SDK_CRASHLYTICS -define:GAMES_SDK_ADMOB \
  -out:"$out" Stubs.cs SdkTest.cs ../Editor/ManifestText.cs $runtime
# shellcheck disable=SC2086
mcs -langversion:Latest -nologo -target:library -define:GAMES_SDK_FIREBASE -define:UNITY_ANDROID \
  -out:"$out.android.dll" Stubs.cs $runtime
# Core alone must compile without Firebase or Google Mobile Ads (the modules are optional).
mcs -langversion:Latest -nologo -target:library -out:"$out.core.dll" Stubs.cs ../Runtime/Core/*.cs
mcs -langversion:Latest -nologo -target:library -out:"$out.editor.dll" Stubs.cs EditorStubs.cs ../Runtime/Core/*.cs ../Editor/*.cs
sh ./check_meta.sh
mono "$out"
