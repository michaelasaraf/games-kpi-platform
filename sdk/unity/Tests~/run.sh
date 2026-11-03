#!/usr/bin/env sh
# Compiles the Unity wrapper against API stubs and runs its checks (needs Mono's mcs and mono).
set -eu
cd "$(dirname "$0")"
out="${TMPDIR:-/tmp}/games-kpi-unity-test.exe"
mcs -langversion:Latest -nologo -out:"$out" Stubs.cs WrapperTest.cs ../Runtime/Kpi.cs ../Runtime/KpiEvents.g.cs
mono "$out"
