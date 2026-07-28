import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';

const BASELINE_URL = new URL('./eslint-warning-baseline.json', import.meta.url);

function fingerprintKey(warning) {
  return JSON.stringify([
    warning.file,
    warning.line,
    warning.column,
    warning.ruleId,
    warning.message,
  ]);
}

function unmatchedWarnings(candidates, counterparts) {
  const remaining = new Map();
  for (const warning of counterparts) {
    const key = fingerprintKey(warning);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  return candidates.filter((warning) => {
    const key = fingerprintKey(warning);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

export function evaluateWarningBaseline({ acceptedWarnings, actualWarnings, errorCount }) {
  const added = unmatchedWarnings(actualWarnings, acceptedWarnings);
  const removed = unmatchedWarnings(acceptedWarnings, actualWarnings);

  return {
    ok: errorCount === 0 && added.length === 0 && removed.length === 0,
    errorCount,
    added,
    removed,
  };
}

function warningFingerprint(projectRoot, result, message) {
  return {
    file: path.relative(projectRoot, result.filePath).split(path.sep).join('/'),
    line: message.line,
    column: message.column,
    ruleId: message.ruleId,
    message: message.message.split(/\r?\n/, 1)[0],
  };
}

function describeWarning(warning) {
  return `${warning.file}:${warning.line}:${warning.column} ${warning.ruleId ?? '(no rule)'} — ${warning.message}`;
}

function printBaselineDrift({ added, removed }) {
  process.stderr.write('\nESLint warning baseline mismatch.\n');
  for (const warning of added) {
    process.stderr.write(`  UNACCEPTED + ${describeWarning(warning)}\n`);
  }
  for (const warning of removed) {
    process.stderr.write(`  RESOLVED   - ${describeWarning(warning)}\n`);
  }
  process.stderr.write(
    'Update tooling/eslint-warning-baseline.json and BACKLOG.md B11 only after deliberate binary triage.\n',
  );
}

async function run() {
  const projectRoot = process.cwd();
  const baseline = JSON.parse(await readFile(BASELINE_URL, 'utf8'));
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['.']);
  const formatter = await eslint.loadFormatter('stylish');
  const formattedResults = formatter.format(results);

  if (formattedResults) {
    process.stdout.write(`${formattedResults.trimEnd()}\n`);
  }

  const actualWarnings = results.flatMap((result) => result.messages
    .filter((message) => message.severity === 1)
    .map((message) => warningFingerprint(projectRoot, result, message)));
  const errorCount = results.reduce((total, result) => total + result.errorCount, 0);
  const evaluation = evaluateWarningBaseline({
    acceptedWarnings: baseline.warnings,
    actualWarnings,
    errorCount,
  });

  if (evaluation.added.length > 0 || evaluation.removed.length > 0) {
    printBaselineDrift(evaluation);
  }

  if (!evaluation.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await run();
}
