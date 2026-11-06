import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// Params every wrapper adds to every event (see sdk/*/ core files).
export const ENVELOPE_PARAMS = ['kpi_event_id', 'kpi_seq', 'kpi_sdk'];

// Firebase limits: https://support.google.com/firebase/answer/9237506
export const MAX_NAME_LENGTH = 40;
export const MAX_PARAMS = 25;

// Event names Firebase reserves for its own automatic events.
export const RESERVED_EVENT_NAMES = new Set([
  'ad_activeview', 'ad_click', 'ad_exposure', 'ad_query', 'ad_reward', 'adunit_exposure',
  'app_background', 'app_clear_data', 'app_exception', 'app_remove', 'app_store_refund',
  'app_store_subscription_cancel', 'app_store_subscription_convert', 'app_store_subscription_renew',
  'app_uninstall', 'app_update', 'app_upgrade', 'dynamic_link_app_open', 'dynamic_link_app_update',
  'dynamic_link_first_open', 'error', 'first_open', 'first_visit', 'in_app_purchase',
  'notification_dismiss', 'notification_foreground', 'notification_open', 'notification_receive',
  'os_update', 'session_start', 'session_start_with_rollout', 'user_engagement',
]);
export const RESERVED_PREFIXES = ['firebase_', 'google_', 'ga_'];
export const PARAM_TYPES = new Set(['string', 'int', 'double', 'bool']);

const NAME_RE = /^[a-z][a-z0-9_]*$/;
const METHOD_RE = /^[A-Z][A-Za-z0-9]*$/;

export function loadCatalog(path) {
  return parse(readFileSync(path, 'utf8'));
}

/** Returns a list of human-readable problems; empty means the catalog is valid. */
export function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || !Array.isArray(catalog.events)) {
    return ['catalog must have an `events` list'];
  }
  const names = new Set();
  const methods = new Set();
  for (const [i, ev] of catalog.events.entries()) {
    const where = `events[${i}] (${ev?.name ?? '?'})`;
    if (!ev?.name || !NAME_RE.test(ev.name)) errors.push(`${where}: name must be snake_case`);
    else {
      if (ev.name.length > MAX_NAME_LENGTH) errors.push(`${where}: name longer than ${MAX_NAME_LENGTH}`);
      if (RESERVED_EVENT_NAMES.has(ev.name)) errors.push(`${where}: name is reserved by Firebase`);
      if (RESERVED_PREFIXES.some((p) => ev.name.startsWith(p))) errors.push(`${where}: reserved prefix`);
      if (names.has(ev.name)) errors.push(`${where}: duplicate event name`);
      names.add(ev.name);
    }
    if (!ev?.method || !METHOD_RE.test(ev.method)) errors.push(`${where}: method must be PascalCase`);
    else if (methods.has(ev.method)) errors.push(`${where}: duplicate method`);
    else methods.add(ev.method);
    if (!ev?.group) errors.push(`${where}: group is required`);

    const params = ev?.params ?? [];
    if (!Array.isArray(params)) {
      errors.push(`${where}: params must be a list`);
      continue;
    }
    if (params.length + ENVELOPE_PARAMS.length > MAX_PARAMS) {
      errors.push(`${where}: more than ${MAX_PARAMS - ENVELOPE_PARAMS.length} params`);
    }
    const paramNames = new Set();
    for (const p of params) {
      const pw = `${where}.${p?.name ?? '?'}`;
      if (!p?.name || !NAME_RE.test(p.name)) errors.push(`${pw}: param name must be snake_case`);
      else {
        if (p.name.length > MAX_NAME_LENGTH) errors.push(`${pw}: param name too long`);
        if (RESERVED_PREFIXES.some((x) => p.name.startsWith(x))) errors.push(`${pw}: reserved prefix`);
        if (ENVELOPE_PARAMS.includes(p.name)) errors.push(`${pw}: clashes with an envelope param`);
        if (paramNames.has(p.name)) errors.push(`${pw}: duplicate param`);
        paramNames.add(p.name);
      }
      if (!PARAM_TYPES.has(p?.type)) errors.push(`${pw}: type must be one of ${[...PARAM_TYPES].join(', ')}`);
      if (typeof p?.required !== 'boolean') errors.push(`${pw}: required must be true or false`);
    }
  }
  return errors;
}

/** snake_case -> camelCase */
export function camel(name) {
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Required params first, keeping catalog order inside each half. */
export function orderedParams(ev) {
  const params = ev.params ?? [];
  return [...params.filter((p) => p.required), ...params.filter((p) => !p.required)];
}
