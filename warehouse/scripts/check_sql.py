"""Offline check of the dbt models, without a BigQuery connection.

Renders every model with the project's macros and vars (in both full-refresh and
incremental mode) and parses the result with sqlglot's BigQuery dialect, so syntax
errors and Jinja mistakes fail in CI before anything reaches BigQuery.

Usage: python scripts/check_sql.py   (from the warehouse folder; needs jinja2, pyyaml, sqlglot)
"""
import pathlib
import re
import sys

import jinja2
import sqlglot
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
project = yaml.safe_load((ROOT / "dbt_project.yml").read_text())
VARS = project["vars"]


class CompilerError(Exception):
    pass


class Exceptions:
    @staticmethod
    def raise_compiler_error(msg):
        raise CompilerError(msg)


class ReturnValue(Exception):
    def __init__(self, value):
        self.value = value


def render_model(path, incremental):
    env = jinja2.Environment(extensions=["jinja2.ext.do"], undefined=jinja2.StrictUndefined)
    macro_src = "\n".join(p.read_text() for p in sorted((ROOT / "macros").glob("*.sql")))

    def _return(value):
        raise ReturnValue(value)

    ctx = {
        "var": lambda name, default=None: VARS.get(name, default),
        "is_incremental": lambda: incremental,
        "ref": lambda name: f"`proj`.`games_kpi`.`{name}`",
        "config": lambda **kw: "",
        "exceptions": Exceptions,
        "modules": type("M", (), {"re": re}),
        "return": _return,
    }
    macros = env.from_string(macro_src).make_module(vars=ctx)

    def games():
        try:
            macros.games()
        except ReturnValue as r:
            return r.value
        raise CompilerError("games() did not return")

    for name in ("param_str", "param_int", "param_num", "start_suffix", "start_date_expr"):
        ctx[name] = getattr(macros, name)
    ctx["games"] = games
    return env.from_string(path.read_text()).render(**ctx)


def main():
    failures = 0
    models = sorted((ROOT / "models").rglob("*.sql"))
    for path in models:
        for incremental in (False, True):
            label = f"{path.relative_to(ROOT)} ({'incremental' if incremental else 'full'})"
            try:
                sql = render_model(path, incremental)
                sqlglot.parse_one(sql, read="bigquery")
            except Exception as e:  # noqa: BLE001 - report every failure
                failures += 1
                print(f"FAIL {label}: {type(e).__name__}: {e}")
    print(f"{len(models)} models checked, {failures} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
