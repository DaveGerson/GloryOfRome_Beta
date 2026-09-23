import { useRef, useState, type ChangeEvent } from 'react';
import type { ImportResult } from '../../persistence/saveGame';
import { useFocusRequest } from './useFocusRequest';

export type ImportFailureReason = Exclude<ImportResult, { ok: true }>['reason'];

// jsdom's File does not implement Blob.text() - FileReader does, and it
// is what every browser this ships to actually supports too.
function readChosenFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * "Restore from a copy" (docs/superpowers/specs/2026-08-05-reign-export-
 * import-design.md) - the one flow behind both of its surfaces, the destiny
 * screen (CharacterSelection) and the configuration menu (SettingsMenu),
 * which each carried an identical copy of it.
 *
 * - One hidden file input (`importInputRef`) behind whichever visible button
 *   calls `openFilePicker`.
 * - A chosen file is staged for the Abandon-style overwrite confirm only when
 *   a reign is at stake (`hasSavedReign`); with nothing to lose it applies at
 *   once.
 * - `onImportReign` writes the slot and never asks - consent precedes it. On
 *   ok the page reloads; otherwise the in-fiction refusal reason is kept.
 * - Focus follows the swap: onto "Keep my reign" (`keepReignRef`, the SAFE
 *   answer, never Replace) when the confirm appears, and back onto "Restore
 *   from a copy" (`restoreButtonRef`) when it is declined.
 */
export function useReignImport({ hasSavedReign, onImportReign }: {
  hasSavedReign: boolean;
  onImportReign?: (fileText: string) => ImportResult;
}) {
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);
  const [importFailure, setImportFailure] = useState<ImportFailureReason | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const keepReignRef = useRef<HTMLButtonElement>(null);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const requestFocus = useFocusRequest();

  // Runs an already-consented import: the confirm (if any) has already
  // been answered by the time this is called. `onImportReign` writes the
  // slot itself; this only reacts to what it reports.
  const applyImport = (text: string) => {
    if (!onImportReign) return;
    const result = onImportReign(text);
    if (result.ok) {
      window.location.reload();
    } else {
      setImportFailure(result.reason);
    }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset now, not after the read - choosing the SAME file twice in a
    // row must still fire a change event.
    event.target.value = '';
    if (!file) return;
    setImportFailure(null);
    let text: string;
    try {
      text = await readChosenFileAsText(file);
    } catch {
      // The device refusing to read the file is, to a player, the same
      // refusal as a file that will not parse - one notice, one reason,
      // never an unhandled rejection.
      setImportFailure('unreadable');
      return;
    }
    if (hasSavedReign) {
      requestFocus(keepReignRef);
      setPendingImportText(text);
    } else {
      applyImport(text);
    }
  };

  const confirmImport = () => {
    if (pendingImportText === null) return;
    const text = pendingImportText;
    setPendingImportText(null);
    applyImport(text);
  };

  const cancelImport = () => {
    requestFocus(restoreButtonRef);
    setPendingImportText(null);
  };

  const openFilePicker = () => importInputRef.current?.click();

  return {
    pendingImportText,
    importFailure,
    importInputRef,
    keepReignRef,
    restoreButtonRef,
    handleImportFileChange,
    confirmImport,
    cancelImport,
    openFilePicker,
  };
}
