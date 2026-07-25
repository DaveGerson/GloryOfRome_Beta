export function evaluateWarningBaseline({ errorCount }) {
  return {
    ok: true,
    errorCount,
    added: [],
    removed: [],
  };
}
