/**
 * Schema-backed configuration validation for Development Autoloop.
 *
 * The versioned JSON Schema is the source of truth. This small, dependency-free
 * evaluator intentionally supports only the JSON Schema keywords used by that
 * schema; tests guard this boundary and keep the example config in sync.
 * Validation is read-only and never dispatches, calls a network, or mutates state.
 */
import { readFileSync } from 'node:fs';

export const CONFIG_SCHEMA = JSON.parse(
  readFileSync(new URL('../config/autoloop.schema.v1.json', import.meta.url), 'utf8')
);

export const SUPPORTED_SCHEMA_VERSION = CONFIG_SCHEMA.properties.schemaVersion.const;
export const VALID_RUN_MODES = new Set(CONFIG_SCHEMA.properties.runMode.enum);
export const REQUIRED_LABEL_KEYS = Object.keys(CONFIG_SCHEMA.properties.labels.properties);
export const KNOWN_CONFIG_KEYS = new Set(Object.keys(CONFIG_SCHEMA.properties));

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type',
  'const',
  'enum',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'minLength',
  'pattern',
  'minItems',
  'minimum'
]);

function pointer(segments) {
  if (segments.length === 0) return '/';
  return '/' + segments.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function pushDiagnostic(errors, path, code, message) {
  errors.push({ path: pointer(path), code, message });
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortDiagnostics(errors) {
  return errors.sort((a, b) =>
    compareText(a.path, b.path) ||
    compareText(a.code, b.code) ||
    compareText(a.message, b.message)
  );
}

function matchesType(value, expectedType) {
  switch (expectedType) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

function valueDescription(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value) && typeof value === 'number') return 'integer';
  return typeof value;
}

function validateSchemaNode(schema, value, path, errors, provided = true) {
  if (!provided) return;

  const allowedTypes = schema.type === undefined
    ? []
    : Array.isArray(schema.type) ? schema.type : [schema.type];

  if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(value, type))) {
    pushDiagnostic(
      errors,
      path,
      'SCHEMA_TYPE',
      'Expected ' + allowedTypes.join(' or ') + '; received ' + valueDescription(value) + '.'
    );
    return;
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') &&
      !Object.is(value, schema.const)) {
    pushDiagnostic(errors, path, 'SCHEMA_CONST', 'Value must equal ' + JSON.stringify(schema.const) + '.');
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    pushDiagnostic(errors, path, 'SCHEMA_ENUM', 'Value must be one of: ' + schema.enum.map(JSON.stringify).join(', ') + '.');
  }

  if (typeof value === 'string' && Number.isInteger(schema.minLength) &&
      Array.from(value).length < schema.minLength) {
    pushDiagnostic(errors, path, 'SCHEMA_MIN_LENGTH', 'String must contain at least ' + schema.minLength + ' character(s).');
  }

  if (typeof value === 'string' && typeof schema.pattern === 'string' &&
      !new RegExp(schema.pattern).test(value)) {
    pushDiagnostic(errors, path, 'SCHEMA_PATTERN', 'String does not match the required pattern.');
  }

  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    pushDiagnostic(errors, path, 'SCHEMA_MINIMUM', 'Number must be at least ' + schema.minimum + '.');
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      pushDiagnostic(errors, path, 'SCHEMA_MIN_ITEMS', 'Array must contain at least ' + schema.minItems + ' item(s).');
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => validateSchemaNode(schema.items, item, [...path, index], errors));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const knownNames = new Set(Object.keys(properties));

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          pushDiagnostic(errors, [...path, key], 'SCHEMA_REQUIRED', 'Required property is missing.');
        }
      }
    }

    const actualKeys = Object.keys(value).sort(compareText);
    if (schema.additionalProperties === false) {
      for (const key of actualKeys) {
        if (!knownNames.has(key)) {
          pushDiagnostic(errors, [...path, key], 'SCHEMA_ADDITIONAL_PROPERTIES', 'Property is not allowed by this schema.');
        }
      }
    }

    for (const key of Object.keys(properties).sort(compareText)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateSchemaNode(properties[key], value[key], [...path, key], errors);
      }
    }
  }
}

/**
 * Validate a configuration object or JSON string.
 *
 * @param {object|string} rawInput
 * @returns {{ valid: boolean, config: object|null, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateConfig(rawInput) {
  let configObject = rawInput;

  if (typeof rawInput === 'string') {
    try {
      configObject = JSON.parse(rawInput);
    } catch {
      return {
        valid: false,
        config: null,
        errors: [{ path: '/', code: 'INVALID_JSON', message: 'Input is not valid JSON.' }]
      };
    }
  }

  const errors = [];
  validateSchemaNode(CONFIG_SCHEMA, configObject, [], errors);

  // The evaluator deliberately fails closed if the schema is extended with an
  // unsupported keyword; otherwise schema authors could add constraints that
  // the validator silently ignores.
  const inspectKeywords = (node, path) => {
    for (const key of Object.keys(node)) {
      if (key === '$schema' || key === '$id' || key === 'title' || key === 'description') continue;
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        pushDiagnostic(errors, path, 'UNSUPPORTED_SCHEMA_KEYWORD', 'Schema keyword "' + key + '" is not supported by this validator.');
      }
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const [key, child] of Object.entries(node.properties)) inspectKeywords(child, [...path, 'properties', key]);
    }
    if (node.items && typeof node.items === 'object') inspectKeywords(node.items, [...path, 'items']);
  };
  inspectKeywords(CONFIG_SCHEMA, []);

  const orderedErrors = sortDiagnostics(errors);
  if (orderedErrors.length > 0) {
    return { valid: false, config: null, errors: orderedErrors };
  }

  return { valid: true, config: configObject, errors: [] };
}
