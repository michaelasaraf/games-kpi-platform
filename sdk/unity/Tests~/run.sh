#!/usr/bin/env sh
# Compiles the Unity wrapper against API stubs and runs its checks (needs Mono's mcs and mono).
# A second compile with UNITY_ANDROID defined type-checks the Android-only code.
set -eu
cd "$(dirname "$0")"
out="${TMPDIR:-/tmp}/games-kpi-unity-test.exe"
mcs -langversion:Latest -nologo -out:"$out" Stubs.cs WrapperTest.cs ../Runtime/*.cs
mcs -langversion:Latest -nologo -define:UNITY_ANDROID -out:"$out.android.exe" Stubs.cs WrapperTest.cs ../Runtime/*.cs
sh ./check_meta.sh
mono "$out"
