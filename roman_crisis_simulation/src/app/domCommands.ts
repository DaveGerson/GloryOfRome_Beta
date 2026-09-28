/**
 * app/domCommands.ts
 *
 * What the command palette and the game screen's keys actually DO, done
 * through the same controls the player would press - never around them. A
 * register is opened by clicking its tab (so the tab's own "seen" dismissal
 * runs), the narration log and a private scene by pressing their openers (so
 * a disabled opener stays shut and each dialog's focus trap returns focus
 * to its opener), a counsel is drafted by pressing its pill (so chat and
 * structured modes each keep their own drafting rule). Same idiom as
 * App.tsx's own `#chat-input, #structured-input` focus after a failure.
 */

import type { TabId } from '../perception/visibility';
import { sidePanelTabDomId } from '../components/SidePanel';
import { SUGGESTION_INDEX_ATTRIBUTE } from '../components/TurnComposer';

export type CommandOpener = 'narration-log' | 'private-scene';

const COMPOSER_SELECTOR = '#chat-input, #structured-input';

/** Focus whichever composer is mounted; false when it is absent or held. */
export function focusComposer(doc: Document = document): boolean {
    const composer = doc.querySelector<HTMLTextAreaElement | HTMLElement>(COMPOSER_SELECTOR);
    if (!composer || (composer as HTMLTextAreaElement).disabled) return false;
    composer.focus();
    return true;
}

/** Open a register: click its tab (selection + the tab's "seen" dismissal) and move focus to it. */
export function selectRegister(id: TabId, doc: Document = document): boolean {
    const tab = doc.getElementById(sidePanelTabDomId(id));
    if (!tab) return false;
    tab.click();
    tab.focus();
    return true;
}

/** Press an opener, focusing it first so its dialog returns focus there on close. */
export function pressOpener(name: CommandOpener, doc: Document = document): boolean {
    const opener = doc.querySelector<HTMLButtonElement>(`[data-gor-command="${name}"]`);
    if (!opener || opener.disabled) return false;
    opener.focus();
    opener.click();
    return true;
}

/** Draft a counsel exactly as its pill would, then hand the tablet the focus. */
export function draftSuggestion(index: number, doc: Document = document): boolean {
    const pill = doc.querySelector<HTMLButtonElement>(`[${SUGGESTION_INDEX_ATTRIBUTE}="${index}"]`);
    if (!pill || pill.disabled) return false;
    pill.click();
    // After React commits the draft, so the caret lands in the new text.
    setTimeout(() => focusComposer(doc), 0);
    return true;
}
