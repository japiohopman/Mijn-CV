/**
 * Pure, read-only validation for governing Issues and implementation PRs.
 * Diagnostics use stable machine-readable codes and JSON-pointer-like paths.
 */
export const DEFAULT_REQUIRED_ISSUE_SECTIONS = [
  'Scope',
  'Acceptance criteria',
  'Dependencies',
  'Out of scope',
  'Validation plan'
];

export const DEFAULT_REQUIRED_PR_SECTIONS = [
  'Governing Issue',
  'Summary',
  'Scope boundary',
  'Acceptance criteria evidence',
  'Verification',
  'Risks and blockers',
  'Handoff'
];

const ISSUE_REFERENCE_PATTERN = /(?:#[1-9]\d*|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*)\b/i;

function pointer(segments) {
  if (segments.length === 0) return '/';
  return '/' + segments.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function diagnostic(path, code, message) {
  return { path: pointer(path), code, message };
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

function getBody(input, entityName) {
  if (typeof input === 'string') return { body: input, errors: [] };
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (typeof input.body !== 'string') {
      return { body: '', errors: [diagnostic(['body'], 'BODY_MUST_BE_STRING', entityName + ' body must be a string.')] };
    }
    return { body: input.body, errors: [] };
  }
  return {
    body: '',
    errors: [diagnostic([], 'INVALID_CONTRACT_INPUT', entityName + ' input must be a string or an object with a body property.')]
  };
}

/**
 * Extract Markdown sections, recognizing hash headings and bold standalone titles.
 * @param {string} body
 * @returns {Map<string, string>}
 */
export function extractMarkdownSections(body) {
  const sections = new Map();
  if (typeof body !== 'string') return sections;

  const lines = body.split(/\r?\n/);
  let currentSection = null;
  let currentContent = [];
  let inCodeFence = false;
  let fenceDelimiter = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track code fence boundaries (``` or ~~~)
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const delim = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceDelimiter = delim;
      } else if (delim === fenceDelimiter) {
        inCodeFence = false;
        fenceDelimiter = null;
      }
      if (currentSection) currentContent.push(line);
      continue;
    }

    if (inCodeFence) {
      if (currentSection) currentContent.push(line);
      continue;
    }

    let foundHeading = null;
    let initialInlineContent = null;

    const hashMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (hashMatch) {
      foundHeading = hashMatch[1].trim();
    } else {
      const boldMatch = trimmed.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
      if (boldMatch) {
        foundHeading = boldMatch[1].trim();
        if (boldMatch[2] && boldMatch[2].trim()) initialInlineContent = boldMatch[2].trim();
      }
    }

    if (foundHeading) {
      if (currentSection) sections.set(currentSection.toLowerCase(), currentContent.join('\n').trim());
      currentSection = foundHeading;
      currentContent = initialInlineContent === null ? [] : [initialInlineContent];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) sections.set(currentSection.toLowerCase(), currentContent.join('\n').trim());
  return sections;
}

function requiredSectionsErrors(body, requiredSections) {
  const errors = [];
  const parsed = extractMarkdownSections(body);

  for (const sectionName of requiredSections) {
    const normalized = sectionName.toLowerCase();
    const path = ['body', 'sections', sectionName];
    if (!parsed.has(normalized)) {
      errors.push(diagnostic(path, 'REQUIRED_SECTION_MISSING', 'Required section "' + sectionName + '" is missing.'));
    } else {
      const content = parsed.get(normalized);
      if (!content || content.trim() === '') {
        errors.push(diagnostic(path, 'REQUIRED_SECTION_EMPTY', 'Required section "' + sectionName + '" is empty.'));
      }
    }
  }

  return { parsed, errors };
}

function resolveRequiredSections(options, optionKey, defaultSections) {
  const direct = options && options[optionKey];
  if (Array.isArray(direct) && direct.length > 0) return direct;
  const configured = options && options.config && options.config[optionKey];
  if (Array.isArray(configured) && configured.length > 0) return configured;
  return defaultSections;
}

/**
 * Validate required Issue sections.
 * @param {object|string} issueInput
 * @param {object} [options]
 * @returns {{ valid: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateIssueContract(issueInput, options = {}) {
  const resolved = getBody(issueInput, 'Issue');
  const errors = [...resolved.errors];
  if (errors.length > 0) return { valid: false, errors: sortDiagnostics(errors) };

  const body = resolved.body;
  if (body.trim() === '') {
    errors.push(diagnostic(['body'], 'BODY_EMPTY', 'Issue body cannot be empty.'));
  } else {
    const required = resolveRequiredSections(options, 'requiredIssueSections', DEFAULT_REQUIRED_ISSUE_SECTIONS);
    errors.push(...requiredSectionsErrors(body, required).errors);
  }

  const ordered = sortDiagnostics(errors);
  return { valid: ordered.length === 0, errors: ordered };
}

/**
 * Validate required PR sections and require a real governing Issue reference.
 * No network lookup is performed; this is syntax/contract validation only.
 * @param {object|string} prInput
 * @param {object} [options]
 * @returns {{ valid: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validatePullRequestContract(prInput, options = {}) {
  const resolved = getBody(prInput, 'Pull request');
  const errors = [...resolved.errors];
  if (errors.length > 0) return { valid: false, errors: sortDiagnostics(errors) };

  const body = resolved.body;
  if (body.trim() === '') {
    errors.push(diagnostic(['body'], 'BODY_EMPTY', 'Pull request body cannot be empty.'));
  } else {
    const configuredRequired = resolveRequiredSections(options, 'requiredPRSections', DEFAULT_REQUIRED_PR_SECTIONS);
    // A caller may customize the required sections, but cannot disable governing-Issue linkage.
    const required = configuredRequired.some((name) => name.toLowerCase() === 'governing issue')
      ? configuredRequired
      : [...configuredRequired, 'Governing Issue'];
    const checked = requiredSectionsErrors(body, required);
    errors.push(...checked.errors);

    if (required.some((name) => name.toLowerCase() === 'governing issue')) {
      const issueContent = checked.parsed.get('governing issue') || '';
      if (!ISSUE_REFERENCE_PATTERN.test(issueContent)) {
        errors.push(diagnostic(
          ['body', 'sections', 'Governing Issue'],
          'GOVERNING_ISSUE_REFERENCE_REQUIRED',
          'Governing Issue must contain a valid Issue number such as #123 or a GitHub Issue URL.'
        ));
      }
    }
  }

  const ordered = sortDiagnostics(errors);
  return { valid: ordered.length === 0, errors: ordered };
}
