import { camel, orderedParams } from './catalog.js';

const DART_TYPES = { string: 'String', int: 'int', double: 'double', bool: 'bool' };
const DART_KEYWORDS = new Set(['value', 'default', 'in', 'is', 'new', 'class']);

function dartName(param) {
  const n = camel(param.name);
  return DART_KEYWORDS.has(n) ? `${n}_` : n;
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function signature(ev) {
  const params = orderedParams(ev);
  if (params.length === 0) return '';
  const parts = params.map((p) => {
    const t = DART_TYPES[p.type];
    return p.required ? `required ${t} ${dartName(p)}` : `${t}? ${dartName(p)}`;
  });
  return `{${parts.join(', ')}}`;
}

function entry(p) {
  const v = dartName(p);
  const key = `'${p.name}'`;
  const val = p.type === 'bool' ? `(${v} ? 1 : 0)` : p.type === 'string' ? `_clip(${v})` : v;
  return p.required ? `${key}: ${val},` : `if (${v} != null) ${key}: ${val},`;
}

export function generateDart(catalog) {
  const methods = catalog.events.map((ev) => {
    const params = orderedParams(ev);
    const docs = (ev.description ?? '').trim().split('\n').map((l) => `  /// ${l}`).join('\n');
    const entries = params.map((p) => `      ${entry(p)}`).join('\n');
    if (!entries) {
      return `${docs}
  static Future<void> ${lowerFirst(ev.method)}() => _log('${ev.name}', const <String, Object>{});`;
    }
    return `${docs}
  static Future<void> ${lowerFirst(ev.method)}(${signature(ev)}) {
    return _log('${ev.name}', <String, Object>{
${entries}
    });
  }`;
  });

  return `// GENERATED CODE - DO NOT MODIFY BY HAND.
// Generated from catalog/events.yaml (version ${catalog.version}) by tools/codegen.
// Change the catalog and run \`npm run codegen\`.

part of '../games_kpi.dart';

/// Typed helpers for every event in the shared KPI event catalog.
abstract final class KpiEvents {
  static const int catalogVersion = ${catalog.version};

${methods.join('\n\n')}
}
`;
}
