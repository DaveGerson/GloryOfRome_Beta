/**
 * @vitest-environment jsdom
 *
 * Regression pins for the design-system audit fixes: the shared bare-button
 * reset and its focus ring, forced colours, reduced motion, the configuration
 * menu's descriptions and phone fit, the GM console's size and its
 * intervention dock's turn, the epilogue's announcements and focus, the
 * tooltip that keeps itself whole, the focus trap's disclosures, and the
 * small contrast and cascade repairs.
 *
 * Layout and paint cannot be measured in jsdom, so where a fix is pure CSS
 * its contract is pinned in the stylesheet source, as
 * tests/readingPrefs.test.tsx does for the reading register.
 *
 * Same house style as designPassSurfaces.test.tsx: React 19 act() +
 * react-dom/client only, no testing-library.
 */
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GoogleGenAI } from '@google/genai';
import SettingsMenu, { CURTAIN_COPY, REIGN_COPY_NOTE } from '../components/SettingsMenu';
import { ApiKeyCard } from '../components/ApiKeyCard';
import GameMasterScreen, { FixturesView } from '../components/GameMasterScreen';
import EpilogueScreen, { EPILOGUE_STATUS } from '../components/EpilogueScreen';
import ErrorBoundary from '../components/ErrorBoundary';
import OnboardingOverlay from '../components/OnboardingOverlay';
import { CustomDestinyForm, ForgingScreen } from '../components/CustomDestinyForm';
import CharacterSelection from '../components/CharacterSelection';
import { TurnFailureNotice } from '../components/ui/FailureNotices';
import { Tooltip } from '../components/ui/Feedback';
import { SubRail } from '../components/ui/SubRail';
import { TypingIndicator } from '../components/ui/Game';
import { createFocusTrap } from '../components/ui/focusTrap';
import { toRoman } from '../components/ui/Brand';
import { runNewTurn } from '../ai/core/turn';
import { endTurnCapture } from '../ai/core/geminiService';
import type { GeminiClient } from '../ai/core/geminiService';
import { makeEntity, makeSimulationState, makeTurnHistoryEntry, makeWorldState } from './factories';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');
const components = read('design/components.css');
const shell = read('design/shell.css');
const nocturne = read('design/nocturne.css');

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return container;
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

const settingsProps = (overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}): React.ComponentProps<typeof SettingsMenu> => ({
  onClose: vi.fn(), apiKey: null, onSaveApiKey: vi.fn(), onClearApiKey: vi.fn(),
  pacingPosture: 'balanced', onSetPacingPosture: vi.fn(), isNox: false, onSetIsNox: vi.fn(),
  gmConsoleEnabled: true, onSetGmConsoleEnabled: vi.fn(), gmInterventionEnabled: true, onSetGmInterventionEnabled: vi.fn(),
  narrationVoiceMode: 'on_demand', onSetNarrationVoiceMode: vi.fn(),
  isMockMode: false, onSetIsMockMode: vi.fn(), gmConsoleOpen: false, onSetGmConsoleOpen: vi.fn(),
  hasSavedReign: false, onExportReign: vi.fn(),
  ...overrides,
});

const gmProps = (overrides: Partial<React.ComponentProps<typeof GameMasterScreen>> = {}): React.ComponentProps<typeof GameMasterScreen> => ({
  history: [], onClose: vi.fn(), interventionText: '', onSetIntervention: () => true,
  playerCharacterId: null, worldState: makeWorldState(), turnNumber: 1,
  ...overrides,
});

describe('the bare button: one reset, one ring', () => {
  it('defines the shared class the inline resets moved into', () => {
    expect(components).toContain('.gor-bare-btn{all:unset;box-sizing:border-box;cursor:pointer}');
    expect(components).toContain('.gor-bare-btn:focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:var(--focus-ring)}');
  });

  it('leaves no inline all:unset on a button in the menu, the rite, the GM console or a glossary term', () => {
    for (const file of ['components/SettingsMenu.tsx', 'components/OnboardingOverlay.tsx', 'components/GameMasterScreen.tsx', 'components/gm/RawView.tsx', 'components/GlossaryTooltip.tsx']) {
      expect(read(file), file).not.toMatch(/all:\s*'unset'/);
    }
  });

  it('puts every close ×, GM tab and turn-rail button on the class', async () => {
    const settings = await mount(<SettingsMenu {...settingsProps()} />);
    const close = settings.querySelector<HTMLButtonElement>('[aria-label="Close configuration menu"]')!;
    expect(close.classList.contains('gor-bare-btn')).toBe(true);
    expect(close.style.getPropertyValue('all')).toBe('');

    const rite = await mount(<OnboardingOverlay isOpen onClose={vi.fn()} />);
    expect(rite.querySelector('[aria-label="Close introduction"]')!.classList.contains('gor-bare-btn')).toBe(true);

    const history = [makeTurnHistoryEntry({ turnNumber: 1 }), makeTurnHistoryEntry({ turnNumber: 2 })];
    const gm = await mount(<GameMasterScreen {...gmProps({ history, turnNumber: 3 })} />);
    expect(gm.querySelector('[aria-label="Close Game Master screen"]')!.classList.contains('gor-bare-btn')).toBe(true);
    const tabs = Array.from(gm.querySelectorAll('[role="tab"]'));
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.every(tab => tab.classList.contains('gor-bare-btn'))).toBe(true);
    const rail = Array.from(gm.querySelectorAll('nav[aria-label="Turns"] button'));
    expect(rail).toHaveLength(2);
    // The rail scrolls, so its ring is drawn inside the row.
    expect(rail.every(button => button.classList.contains('gor-gm-rail-btn'))).toBe(true);
    expect(components).toContain('.gor-bare-btn.gor-gm-rail-btn:focus-visible{box-shadow:inset 0 0 0 2px var(--gold-500)}');
  });
});

describe('forced colours', () => {
  const forcedBlocks = shell.split('@media (forced-colors:active){').slice(1).map(block => block.slice(0, block.indexOf('\n}')));
  const forced = forcedBlocks.join('\n');

  it('keeps an outline on every focused control, drawn inside a chamfered or clipped one', () => {
    expect(forced).toContain(':focus-visible{outline:2px solid Highlight!important}');
    for (const control of ['.gor-btn', '.gor-pill', '.gor-tab', '.gor-seg-btn', '.gor-pointer', '.gor-subrail-btn', '.gor-event-choice']) {
      expect(forced).toMatch(new RegExp(`\\${control}:focus-visible[^{]*\\{outline-offset:-4px\\}`));
    }
  });

  it('repaints the selected side-panel tab in the selection colours, its focus in HighlightText', () => {
    expect(forced).toContain('.gor-tab[role="tab"][aria-selected="true"]{background:Highlight;color:HighlightText;forced-color-adjust:none;box-shadow:none;text-shadow:none}');
    expect(forced).toMatch(/\.gor-tab\[role="tab"\]\[aria-selected="true"\]:focus-visible[^{]*\{outline-color:HighlightText!important\}/);
  });

  it('gives the GM console a ground colour forced colours can repaint', async () => {
    const gm = await mount(<GameMasterScreen {...gmProps()} />);
    const dialog = gm.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.background).toMatch(/#131009\)? #131009|rgb\(19, 16, 9\)$/);
  });
});

describe('reduced motion', () => {
  const blanket = 'animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:1ms!important;transition-delay:0s!important;scroll-behavior:auto!important';

  it('answers the device as firmly as the in-app switch, so inline animations stop too', () => {
    expect(shell).toContain(`html[data-gor-motion="reduced"] *,html[data-gor-motion="reduced"] *::before,html[data-gor-motion="reduced"] *::after{${blanket}}`);
    expect(shell).toContain(`@media (prefers-reduced-motion:reduce){\n*,*::before,*::after{${blanket}}\n}`);
  });

  it('stops the primary button\'s shimmer and the epilogue\'s ember by name', () => {
    const reduced = components.slice(components.lastIndexOf('@media (prefers-reduced-motion:reduce){\n.gor-msg'));
    expect(reduced).toContain('.gor-btn-primary:hover:not(:disabled)::after{animation:none}');
    expect(reduced).toMatch(/\.gor-stele-waiting[,{]/);
  });
});

describe('the configuration menu', () => {
  it('describes both curtain switches, tied to them, in the state in force', async () => {
    const on = await mount(<SettingsMenu {...settingsProps()} />);
    for (const [id, note] of [['settings-gm-console-enabled', CURTAIN_COPY.consoleNote.on], ['settings-gm-intervention-enabled', CURTAIN_COPY.interventionNote.on]]) {
      const input = on.querySelector<HTMLInputElement>(`#${id}`)!;
      const described = on.querySelector(`#${input.getAttribute('aria-describedby')}`);
      expect(described?.textContent).toBe(note);
    }
    const off = await mount(<SettingsMenu {...settingsProps({ gmConsoleEnabled: false, gmInterventionEnabled: false })} />);
    expect(off.querySelector('#settings-gm-console-enabled-note')?.textContent).toBe(CURTAIN_COPY.consoleNote.off);
    expect(off.querySelector('#settings-gm-intervention-enabled-note')?.textContent).toBe(CURTAIN_COPY.interventionNote.off);
  });

  it('still sends each curtain switch to its handler', async () => {
    const onSetGmConsoleEnabled = vi.fn();
    const onSetGmInterventionEnabled = vi.fn();
    const host = await mount(<SettingsMenu {...settingsProps({ onSetGmConsoleEnabled, onSetGmInterventionEnabled })} />);
    await act(async () => host.querySelector<HTMLInputElement>('#settings-gm-console-enabled')!.click());
    await act(async () => host.querySelector<HTMLInputElement>('#settings-gm-intervention-enabled')!.click());
    expect(onSetGmConsoleEnabled).toHaveBeenCalledWith(false);
    expect(onSetGmInterventionEnabled).toHaveBeenCalledWith(false);
  });

  it('shows no ruling id to the player', async () => {
    const host = await mount(<SettingsMenu {...settingsProps()} />);
    expect(host.textContent).toContain(REIGN_COPY_NOTE);
    expect(host.textContent).not.toMatch(/\(D\d+\)/);
  });

  it('makes pacing a radio group described by its note, like Lighting beside it', async () => {
    const onSetPacingPosture = vi.fn();
    const host = await mount(<SettingsMenu {...settingsProps({ onSetPacingPosture })} />);
    const group = host.querySelector<HTMLElement>('[aria-label="Pacing posture"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(host.querySelector(`#${group.getAttribute('aria-describedby')}`)?.textContent).toMatch(/^Measured Fates — /);
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map(radio => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map(radio => radio.tabIndex)).toEqual([-1, 0, -1]);
    await act(async () => radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(onSetPacingPosture).toHaveBeenCalledWith('dramatic');
  });

  it('lets the dialog shrink to a phone and its title with it', () => {
    expect(components).toMatch(/\.gor-dialog\{[^}]*min-width:0/);
    const phone = components.slice(components.indexOf('@media (max-width:480px){'));
    expect(phone).toContain('.gor-dialog-head h2{font-size:clamp(18px,5.6vw,27px)!important;min-width:0;overflow-wrap:anywhere}');
  });

  it('wears the laurel "On this device" badge only while a key is kept here', async () => {
    const none = await mount(<ApiKeyCard apiKey={null} onSaveApiKey={vi.fn()} onClearApiKey={vi.fn()} />);
    expect(none.querySelector('.gor-badge')).toBeNull();
    const kept = await mount(<ApiKeyCard apiKey="AIzaTESTKEY1234" onSaveApiKey={vi.fn()} onClearApiKey={vi.fn()} />);
    expect(kept.querySelector('.gor-badge-laurel')?.textContent).toBe('On this device');
  });
});

describe('the GM console', () => {
  it('names the turn runNewTurn will record the directive under', async () => {
    const turnNumber = 2;
    const player = makeEntity({ position: 'Emperor', resources: { denarii: 1000 } });
    const stubAi = { models: { generateContent: vi.fn() } } as unknown as GoogleGenAI;
    const result = await runNewTurn(
      stubAi, 'I hold court.', player, turnNumber, [player], makeWorldState(), makeSimulationState(),
      [], [], [], [], 'A plague breaks out in the Suburra', true, 'A political thriller',
    );
    endTurnCapture();
    expect(result.newHistoryEntry.turnNumber).toBe(turnNumber);

    const gm = await mount(<GameMasterScreen {...gmProps({ history: [makeTurnHistoryEntry({ turnNumber: 1 })], turnNumber })} />);
    const label = Array.from(gm.querySelectorAll('span')).find(span => span.textContent?.startsWith('GM Intervention'))!;
    expect(label.textContent).toBe(`GM Intervention — lands in Turn ${toRoman(result.newHistoryEntry.turnNumber)}`);
  });

  it('is sized to the window, so the dock cannot fall below it', async () => {
    const gm = await mount(<GameMasterScreen {...gmProps()} />);
    expect(gm.querySelector<HTMLElement>('[role="dialog"]')!.style.height).toBe('calc(100dvh - 56px)');
    expect(components).toContain('[aria-labelledby="gm-screen-title"]{width:calc(100% - 16px)!important;height:calc(100dvh - 16px)!important');
  });

  it('cuts the narration tablet\'s drop cap in the tablet\'s own heading ink', () => {
    expect(components).toContain('.gor-gm-tablet.gor-dropcap::first-letter{color:var(--tablet-head);text-shadow:none}');
  });
});

describe('the GM console\'s gold buttons', () => {
  const goldEntry = makeTurnHistoryEntry({
    turnNumber: 4, turnSeed: 0x5EEDF00D,
    resolutionTrace: {
      assessment: { is_consequential: true, action_category: 'oratory', relevant_skill: 'oratory', difficulty: 12, opposing_entity_id: null, rationale: 'Addressed the Senate.' },
      roll: 11, total: 15, margin: 3, tier: 'success',
    },
  });

  it('puts the directive and both Fixtures buttons on the class that rings them inside their chamfer', async () => {
    const gm = await mount(<GameMasterScreen {...gmProps()} />);
    const directive = Array.from(gm.querySelectorAll('button')).find(button => button.textContent === 'Set Directive for Next Turn')!;
    expect(directive.classList.contains('gor-gm-gold-btn')).toBe(true);
    expect(directive.style.clipPath).toBe('var(--chamfer-sm)');

    const fixtures = await mount(<FixturesView entry={goldEntry} history={[goldEntry]} sessionCalls={0} hasTruthLedger={false} hasKnowledge={false} onExport={vi.fn()} />);
    const gold = Array.from(fixtures.querySelectorAll('button')).filter(button => button.style.clipPath === 'var(--chamfer-sm)');
    expect(gold.map(button => button.textContent)).toEqual(['Strike the mould again', 'Take the impression']);
    expect(gold.every(button => button.classList.contains('gor-gm-gold-btn'))).toBe(true);
  });

  it('draws their ring as an inset outline, which neither the clip nor the inline bevel can hide', () => {
    expect(components).toContain('.gor-gm-gold-btn:focus-visible{outline:2px solid var(--ink-950);outline-offset:-5px}');
    const forced = shell.split('@media (forced-colors:active){').slice(1).map(block => block.slice(0, block.indexOf('\n}'))).join('\n');
    expect(forced).toMatch(/\.gor-gm-gold-btn:focus-visible[^{]*\{outline-offset:-4px\}/);
  });
});

describe('the epilogue', () => {
  const player = makeEntity({ name: 'Severus Alexander', position: 'Emperor', status: 'dead' });
  const ai = { models: { generateContent: vi.fn() } } as unknown as GeminiClient;
  const beat = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });

  it('announces the end through a region that was there, empty, first', async () => {
    const host = await mount(
      <EpilogueScreen player={player} causeNarration="He fell." turnHistory={[]} eventHistory={[]} metaNarrative="" ai={ai} isMockMode />,
    );
    const status = host.querySelector('[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('');
    await beat();
    expect(host.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe(EPILOGUE_STATUS.written);
    // The visible waiting line no longer speaks for itself.
    expect(host.querySelector('[aria-live]')).toBeNull();
  });

  it('moves focus to the name, an h2 under the masthead\'s h1', async () => {
    const host = await mount(
      <EpilogueScreen player={player} causeNarration="" turnHistory={[]} eventHistory={[]} metaNarrative="" ai={ai} isMockMode />,
    );
    expect(host.querySelector('h1')).toBeNull();
    const name = host.querySelector('h2')!;
    expect(name.textContent).toBe('Severus Alexander');
    expect(name.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(name);
  });

  it('says the record was set down by another hand when the chroniclers fail, in legible ink', async () => {
    const failing = { models: { generateContent: vi.fn().mockRejectedValue(new Error('offline')) } } as unknown as GeminiClient;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await mount(
      <EpilogueScreen player={player} causeNarration="" turnHistory={[]} eventHistory={[]} metaNarrative="" ai={failing} isMockMode={false} />,
    );
    for (let attempt = 0; attempt < 20 && !host.textContent?.includes('could not be reached'); attempt++) await beat();
    await beat();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(EPILOGUE_STATUS.fallback);
    const note = Array.from(host.querySelectorAll('p')).find(p => p.textContent?.includes('could not be reached'))!;
    expect(note.style.color).toBe('var(--stele-dim)');
  });

  it('waits with an ember the reduced-motion list can name', () => {
    expect(read('components/EpilogueScreen.tsx')).not.toMatch(/animation:\s*'gorEmber/);
    expect(components).toContain('.gor-stele-waiting{animation:gorEmber 2.4s ease-in-out infinite}');
  });
});

describe('the crash screen', () => {
  it('sizes every button, not only the primary', async () => {
    const Throws: React.FC = () => { throw new Error('fracture'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await mount(<ErrorBoundary><Throws /></ErrorBoundary>);
    const resting = Array.from(host.querySelectorAll('button'));
    expect(resting.every(button => /gor-btn-(sm|md|lg)/.test(button.className))).toBe(true);
    await act(async () => resting.find(button => button.textContent?.includes('Abandon'))!.click());
    const confirming = Array.from(host.querySelectorAll('button'));
    expect(confirming.map(button => button.textContent)).toEqual(['Abandon', 'Keep my reign']);
    expect(confirming.every(button => button.classList.contains('gor-btn-md'))).toBe(true);
  });
});

describe('the rite holds still', () => {
  it('keeps one height through its steps, each leaf centred in it', async () => {
    const host = await mount(<OnboardingOverlay isOpen onClose={vi.fn()} />);
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains('gor-rite')).toBe(true);
    const leaf = dialog.querySelector('.gor-rite-leaf')!;
    expect(leaf.querySelector('#onboarding-body')).not.toBeNull();
    expect(leaf.querySelector('.gor-specimen')).not.toBeNull();
    expect(components).toMatch(/\.gor-rite\{box-sizing:border-box;display:flex;flex-direction:column;min-height:min\(\d+px,calc\(100dvh - 48px\)\)\}/);
    expect(components).toContain('.gor-rite-leaf{flex:1;display:flex;flex-direction:column;justify-content:center}');
  });
});

describe('Forge a New Destiny', () => {
  const formProps = {
    description: '', onDescriptionChange: vi.fn(), metaNarrative: '', onMetaNarrativeChange: vi.fn(),
    useCustomGamestate: false, onUseCustomGamestateChange: vi.fn(), error: null, interactionLocked: false,
    onSubmit: vi.fn(), onBack: vi.fn(),
  };

  it('pins the foot bar to the real edge: the room below the form is a spacer, not scroller padding', async () => {
    const host = await mount(<CustomDestinyForm {...formProps} />);
    const scroller = host.querySelector<HTMLElement>('.gor-destinies-forge')!;
    expect(scroller.style.padding).toBe('40px 32px 0px');
    const runout = scroller.querySelector('.gor-forge-runout')!;
    expect(runout.previousElementSibling?.tagName).toBe('FORM');
    expect(runout.getAttribute('aria-hidden')).toBe('true');
    expect(shell).toContain('.gor-destinies-forge{padding:22px 16px 0!important}');
  });

  it('says it is forging once, by focusing its heading, while the fate lines stay silent', async () => {
    const host = await mount(<ForgingScreen useCustomGamestate={false} />);
    const heading = host.querySelector('h2')!;
    expect(document.activeElement).toBe(heading);
    const indicator = host.querySelector('.gor-typing')!;
    expect(indicator.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it('keeps the bare indicator out of the accessibility tree wherever it is used', async () => {
    const host = await mount(<TypingIndicator lines={['One', 'Two']} intervalMs={50} />);
    expect(host.querySelector('.gor-typing')!.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});

describe('Choose Your Destiny on a short screen', () => {
  const selectionProps = { onSelectCharacter: vi.fn(), onCreateCharacter: vi.fn(async () => {}) };
  const saved = { characterName: 'Severus Alexander', turnNumber: 4, savedAt: '2026-08-05T12:00:00.000Z' };

  it('marks the destinies only while a reign is saved, readable or not', async () => {
    const fresh = await mount(<CharacterSelection {...selectionProps} />);
    expect(fresh.querySelector('.gor-destinies')!.classList.contains('gor-destinies-reign')).toBe(false);
    const withReign = await mount(<CharacterSelection {...selectionProps} savedGame={saved} onContinue={vi.fn()} />);
    expect(withReign.querySelector('.gor-destinies')!.classList.contains('gor-destinies-reign')).toBe(true);
    const unreadable = await mount(<CharacterSelection {...selectionProps} savedGame={{ unreadable: 'version_mismatch' }} />);
    expect(unreadable.querySelector('.gor-destinies')!.classList.contains('gor-destinies-reign')).toBe(true);
    for (const hero of [fresh, withReign]) {
      expect(hero.querySelector('.gor-destinies-hero .gor-destinies-medallion')).not.toBeNull();
      expect(hero.querySelector('.gor-destinies-hero .gor-destinies-lede')).not.toBeNull();
    }
  });

  it('compacts the hero only below 820px of height, and only for a saved reign', () => {
    const block = shell.slice(shell.indexOf('@media (max-height:820px){'));
    const rules = block.slice(0, block.indexOf('\n}'));
    expect(rules).toContain('.gor-destinies-reign .gor-destinies-medallion{zoom:.54}');
    expect(rules).toContain('.gor-destinies-reign .gor-mosaic{display:none}');
    expect(rules).toMatch(/\.gor-destinies-reign \.gor-destinies-title\{font-size:30px!important/);
    // Every rule in the block is scoped to a saved reign: nothing else moves.
    const lines = rules.split('\n').slice(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const rule of lines) expect(rule.slice(0, rule.indexOf('{'))).toContain('.gor-destinies-reign');
  });
});

describe('the focus trap and a disclosure', () => {
  function dialogWith(...children: HTMLElement[]): HTMLElement {
    const container = document.createElement('div');
    container.tabIndex = -1;
    container.append(...children);
    document.body.appendChild(container);
    return container;
  }
  const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });

  it('lets Tab move on from a summary instead of throwing it back to the first control', () => {
    const close = document.createElement('button');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Parsed adjudication';
    details.append(summary);
    const textarea = document.createElement('textarea');
    const container = dialogWith(close, details, textarea);
    const trap = createFocusTrap(container);
    summary.focus();
    expect(document.activeElement).toBe(summary);
    const event = tab();
    trap.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
    container.remove();
  });

  it('still wraps at the true end when the last stop is a summary', () => {
    const first = document.createElement('button');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    details.append(summary);
    const container = dialogWith(first, details);
    const trap = createFocusTrap(container);
    summary.focus();
    const event = tab();
    trap.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    container.remove();
  });

  it('treats a heading focused on purpose inside the dialog as a place to move on from', () => {
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    const first = document.createElement('button');
    const last = document.createElement('button');
    const container = dialogWith(heading, first, last);
    const trap = createFocusTrap(container);
    heading.focus();
    const forward = tab();
    trap.handleKeyDown(forward);
    expect(forward.defaultPrevented).toBe(false);
    // Nothing precedes it: Shift+Tab wraps to the last stop.
    const back = tab(true);
    trap.handleKeyDown(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    container.remove();
  });
});

describe('the tooltip keeps itself whole', () => {
  it('drops below a trigger whose room above is cut off, and slides back inside the edge', async () => {
    const rects: Record<string, Partial<DOMRect>> = {
      panel: { top: 400, bottom: 768, left: 600, right: 1024 },
      wrap: { top: 420, bottom: 440, left: 1000, right: 1010 },
      bubble: { top: 360, bottom: 410, left: 890, right: 1120, width: 230, height: 50 },
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const key = this.classList.contains('gor-tooltip') ? 'bubble' : this.classList.contains('gor-tooltip-wrap') ? 'wrap' : this.dataset.panel ? 'panel' : null;
      const r = key ? rects[key] : {};
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r } as DOMRect;
    });
    const host = await mount(
      <div data-panel="1" style={{ overflowY: 'auto' }}>
        <Tooltip wide label="Your capacity for espionage."><span tabIndex={0}>†</span></Tooltip>
      </div>,
    );
    await act(async () => host.querySelector<HTMLElement>('[tabindex="0"]')!.focus());
    const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tip.classList.contains('gor-tooltip-below')).toBe(true);
    expect(tip.style.getPropertyValue('--gor-tip-shift')).toBe('-104px');
  });

  it('reads as a sentence inside a small-caps label', () => {
    const rule = components.slice(components.indexOf('.gor-tooltip{'), components.indexOf('}', components.indexOf('.gor-tooltip{')));
    for (const reset of ['font-weight:400', 'font-style:normal', 'letter-spacing:0', 'text-transform:none', 'translateX(calc(-50% + var(--gor-tip-shift,0px)))']) {
      expect(rule).toContain(reset);
    }
    expect(components).toContain('.gor-tooltip-below{bottom:auto;top:calc(100% + 8px)}');
  });
});

describe('names read as words', () => {
  it('parts a sub-rail label from its count', async () => {
    const host = await mount(
      <SubRail ariaLabel="Occurrences" value="week" onChange={vi.fn()}
        options={[{ value: 'week', label: 'This week', count: 2 }, { value: 'examined', label: 'Examined' }]} />,
    );
    const [withCount, bare] = Array.from(host.querySelectorAll('button'));
    expect(withCount.textContent).toBe('This week, 2');
    expect(withCount.querySelector('.gor-sr-only')?.textContent).toBe(', ');
    expect(bare.textContent).toBe('Examined');
  });
});

describe('small repairs', () => {
  it('draws a failure notice\'s spent attempts crimson and flush, not as the dossier\'s coins', async () => {
    const host = await mount(<TurnFailureNotice failure={{ kind: 'transient' }} onEditTheWeek={vi.fn()} onOpenSettings={vi.fn()} onEnableMockMode={vi.fn()} />);
    expect(host.querySelector('.gor-pips')!.classList.contains('gor-pips-attempts')).toBe(true);
    expect(components).toContain('.gor-pips.gor-pips-attempts{margin-left:0}');
    expect(components).toContain('.gor-pips-attempts .gor-pip.gor-pip-spent{background:var(--metal-crimson);border-color:transparent}');
  });

  it('inks the composer\'s error line with the skin\'s own danger colour', () => {
    expect(components).toContain('.gor-hint-error{color:var(--danger)}');
  });

  it('writes an unknown region\'s name in ink, not a hairline', () => {
    const rule = components.slice(components.indexOf('.gor-vellum-name{'), components.indexOf('}', components.indexOf('.gor-vellum-name{')));
    expect(rule).toContain('color:var(--text-muted)');
    expect(rule).not.toContain('text-stroke');
  });

  it('re-cuts the conflict verdict for the night', () => {
    expect(nocturne).toContain('.gor-verdict-conflict{color:#E89A8C;background:rgba(140,28,19,.16)}');
  });

  it('gives the tab an icon of its own, so nothing asks for /favicon.ico', () => {
    const html = read('index.html');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,%3Csvg /);
  });

  it('shrinks the phone masthead title below a 375 phone', () => {
    expect(shell).toContain('@media (max-width:374px){\n.gor-masthead-title,.gor-masthead-compact .gor-masthead-title{font-size:clamp(13px,4.3vw,16.5px)}\n}');
  });
});

/** A stylesheet without its comments and its conditional blocks (@media, @container, @supports): what is left applies at every width. */
function atEveryWidth(css: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let kept = '';
  let index = 0;
  for (;;) {
    const found = source.slice(index).search(/@(?:media|container|supports)\b/);
    if (found < 0) return kept + source.slice(index);
    kept += source.slice(index, index + found);
    let cursor = source.indexOf('{', index + found) + 1;
    for (let depth = 1; depth > 0 && cursor < source.length; cursor++) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') depth--;
    }
    index = cursor;
  }
}

describe('box sizes the narrow screens no longer patch', () => {
  it('sizes the private scene and its fields as border boxes once, at every width, keeping the desktop box', () => {
    const everywhere = atEveryWidth(components);
    // 662 = the old 620px content box + 2 x 20px padding + 2 x 1px border, so
    // the desktop scene is the size it always was, and the same for its height.
    expect(everywhere).toMatch(/\.gor-private-scene\{box-sizing:border-box;[^}]*width:min\(662px,calc\(100vw - 32px\)\);max-height:calc\(76vh \+ 42px\);[^}]*padding:20px;[^}]*border:1px solid/);
    expect(everywhere).toMatch(/\.gor-private-scene textarea,\.gor-private-scene select\{box-sizing:border-box;display:block;width:100%;margin:10px 0;padding:8px\}/);
    // Once: no narrow-viewport query or shell rule restates either.
    for (const rule of ['.gor-private-scene{box-sizing', '.gor-private-scene textarea,.gor-private-scene select{box-sizing']) {
      expect(`${components}\n${shell}`.split(rule)).toHaveLength(2);
    }
  });
});
