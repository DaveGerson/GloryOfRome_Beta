/**
 * persistence/chronicleExport.ts
 *
 * Pure, self-contained HTML "Scroll of the Reign" export (2A): turns a
 * player's committed chronicle into an offline-readable Roman parchment &
 * epigraphic-stele HTML document with inline styling and zero `<script>` tags.
 *
 * PRIVACY CONTRACT (D4/D5): accepts ONLY player-visible chronicle slices
 * (`TurnHistoryEntry`, `EventHistoryEntry`, player public identity, optional
 * epitaph). Never reads or emits `gm_private`, `rawCalls`, `mortalityTrace`,
 * `resolutionTrace`, `turnSeed`, `npcMindResults`, `npcIntents`,
 * `headlineActors`, `composureRolls`, or `proseRedactions`. Every dynamic text
 * field is strictly HTML-escaped.
 */
import type { Entity, EventHistoryEntry, TurnHistoryEntry, WorldState } from '../types';
import {
  deserializeTurnSubmission,
  isReservedTurnSubmissionArtifact,
  projectForPlayerReflection,
} from '../playerInput/turnSubmission';

export interface ChronicleExportInput {
  player: Pick<Entity, 'entity_id' | 'name' | 'position' | 'epithet' | 'location' | 'status'>;
  worldState?: Pick<WorldState, 'year' | 'week' | 'economic_stability' | 'political_climate'>;
  turnHistory: readonly TurnHistoryEntry[];
  eventHistory: readonly EventHistoryEntry[];
  metaNarrative?: string;
  epitaph?: string | null;
  causeNarration?: string;
  exportedAt?: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch] ?? ch);
}

const ROMAN_NUMERALS: ReadonlyArray<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRomanNumeral(value: number): string {
  if (!Number.isFinite(value) || value < 1) return 'I';
  let remaining = Math.trunc(value);
  let out = '';
  for (const [arabic, roman] of ROMAN_NUMERALS) {
    while (remaining >= arabic) {
      out += roman;
      remaining -= arabic;
    }
  }
  return out || 'I';
}

function safePlayerOrder(rawIntent: string): string | null {
  const parsed = deserializeTurnSubmission(rawIntent);
  if (parsed) return projectForPlayerReflection(parsed);
  if (isReservedTurnSubmissionArtifact(rawIntent)) return null;
  const trimmed = rawIntent.trim();
  return trimmed || null;
}

export function scrollExportFilename(playerName: string, year?: number): string {
  const slug = playerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'roman-reign';
  const yearSuffix = year !== undefined ? `-ad-${Math.trunc(year)}` : '';
  return `chronicle-${slug}${yearSuffix}.html`;
}

export function buildChronicleScrollHtml(input: ChronicleExportInput): string {
  const { player, worldState, turnHistory, eventHistory, metaNarrative, epitaph, causeNarration, exportedAt } = input;
  const isDead = player.status === 'dead' || Boolean(epitaph && epitaph.trim());
  const titleText = `Chronicle of ${player.name}`;
  const standing = [player.position, player.epithet, player.location].filter(Boolean).join(' · ');

  const eventsByTurn = new Map<number, EventHistoryEntry[]>();
  for (const ev of eventHistory) {
    const list = eventsByTurn.get(ev.turnNumber) ?? [];
    list.push(ev);
    eventsByTurn.set(ev.turnNumber, list);
  }

  const turnsHtml = turnHistory.length === 0
    ? '<p class="empty">The annals are not yet inscribed; no weeks have been recorded.</p>'
    : turnHistory.map(entry => {
      const romanWeek = toRomanNumeral(entry.turnNumber);
      const order = safePlayerOrder(entry.playerIntent);
      const headlines = entry.adjudication.headlines.filter(h => h.trim().length > 0);
      const narration = entry.narration?.trim() ?? '';
      const monologue = entry.playerMonologue?.trim() ?? '';
      const turnEvents = eventsByTurn.get(entry.turnNumber) ?? [];

      const orderHtml = order
        ? `<div class="order"><span class="tag">Decree &amp; Act</span><p>${escapeHtml(order)}</p></div>`
        : '';
      const headlinesHtml = headlines.length > 0
        ? `<ul class="headlines">${headlines.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
        : '';
      const narrationHtml = narration
        ? `<div class="narration">${escapeHtml(narration).replace(/\n+/g, '<br/>')}</div>`
        : '';
      const monologueHtml = monologue
        ? `<blockquote class="monologue">${escapeHtml(monologue)}</blockquote>`
        : '';
      const fatesHtml = turnEvents.length > 0
        ? turnEvents.map(f =>
          `<div class="fate"><strong>Fate: ${escapeHtml(f.eventTitle)}</strong><span>Chosen path: ${escapeHtml(f.choiceText)}</span></div>`
        ).join('')
        : '';

      return `<article class="week">
  <header class="week-head">
    <span class="week-num">Week ${escapeHtml(romanWeek)}</span>
    <span class="week-sub">Turn ${entry.turnNumber}</span>
  </header>
  ${orderHtml}
  ${headlinesHtml}
  ${narrationHtml}
  ${monologueHtml}
  ${fatesHtml}
</article>`;
    }).join('\n');

  const steleText = epitaph?.trim() || causeNarration?.trim() || '';
  const steleSection = isDead
    ? `<section class="stele">
  <p class="stele-kicker">In Memoriam · Hic Iacet</p>
  <h2>${escapeHtml(player.name)}</h2>
  ${steleText ? `<div class="stele-body">${escapeHtml(steleText).replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').concat('</p>')}</div>` : ''}
</section>`
    : '';

  const worldMeta = worldState
    ? `<div class="metrics">
  <span>A.D. ${worldState.year} · Week ${escapeHtml(toRomanNumeral(worldState.week))}</span>
  <span>Economy: ${escapeHtml(worldState.economic_stability || 'Unknown')}</span>
  <span>Climate: ${escapeHtml(worldState.political_climate || 'Unknown')}</span>
  <span>Weeks Recorded: ${turnHistory.length}</span>
</div>`
    : `<div class="metrics"><span>Weeks Recorded: ${turnHistory.length}</span></div>`;

  const scenarioNote = metaNarrative?.trim()
    ? `<p class="preamble">${escapeHtml(metaNarrative.trim())}</p>`
    : '';

  const stampedFooter = exportedAt ? `Inscribed ${escapeHtml(exportedAt)}` : 'Inscribed from the Annals';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titleText)}</title>
  <style>
    :root {
      --parchment: #f5edd8;
      --paper: #fbf7ec;
      --ink: #241b12;
      --muted: #6b5842;
      --gold: #9c7424;
      --crimson: #7b1d1d;
      --rule: #d9c8a3;
      --stele: #19140e;
      --stele-gold: #e3c766;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 16px 64px;
      background: radial-gradient(circle at top, #efe3c6 0%, #e4d4b0 100%);
      color: var(--ink);
      font-family: Georgia, "Palatino Linotype", "Book Antiqua", serif;
      line-height: 1.65;
    }
    .scroll {
      max-width: 820px;
      margin: 0 auto;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-top: 6px solid var(--crimson);
      box-shadow: 0 18px 48px rgba(36, 27, 18, 0.16);
      padding: 40px 44px;
    }
    .masthead {
      text-align: center;
      border-bottom: 2px solid var(--gold);
      padding-bottom: 20px;
      margin-bottom: 28px;
    }
    .kicker {
      font-size: 11px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--crimson);
      font-weight: 700;
      margin: 0 0 8px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 32px;
      letter-spacing: 0.04em;
      color: var(--ink);
    }
    .standing {
      margin: 0;
      font-style: italic;
      color: var(--muted);
    }
    .metrics {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px 22px;
      margin-top: 16px;
      font-size: 13px;
      color: var(--muted);
    }
    .preamble {
      background: var(--parchment);
      border-left: 3px solid var(--gold);
      padding: 12px 16px;
      margin: 0 0 28px;
      font-style: italic;
    }
    .stele {
      background: linear-gradient(180deg, #211a11, var(--stele));
      color: #ede2c4;
      border: 1px solid rgba(227, 199, 102, 0.45);
      padding: 28px 30px;
      margin: 0 0 32px;
    }
    .stele-kicker {
      margin: 0 0 6px;
      font-size: 11px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--stele-gold);
      text-align: center;
    }
    .stele h2 {
      margin: 0 0 14px;
      text-align: center;
      color: #fff6d9;
      font-size: 24px;
    }
    .stele-body p {
      margin: 0 0 12px;
    }
    .week {
      border-left: 2px solid var(--gold);
      padding: 4px 0 22px 20px;
      margin-bottom: 18px;
    }
    .week-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
    }
    .week-num {
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crimson);
      font-size: 13px;
    }
    .week-sub {
      font-size: 12px;
      color: var(--muted);
    }
    .order {
      background: #f3ead3;
      padding: 8px 12px;
      border-radius: 3px;
      margin-bottom: 10px;
    }
    .order .tag {
      display: inline-block;
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--gold);
      font-weight: 700;
    }
    .order p {
      margin: 4px 0 0;
      font-style: italic;
    }
    .headlines {
      margin: 0 0 10px;
      padding-left: 20px;
      font-weight: 600;
    }
    .narration {
      margin-bottom: 10px;
    }
    .monologue {
      margin: 10px 0 0;
      padding: 6px 14px;
      border-left: 2px solid var(--rule);
      color: var(--muted);
      font-style: italic;
    }
    .fate {
      margin-top: 10px;
      padding: 8px 12px;
      background: #f9efed;
      border-left: 3px solid var(--crimson);
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 14px;
    }
    .empty {
      text-align: center;
      color: var(--muted);
      font-style: italic;
    }
    footer {
      margin-top: 32px;
      padding-top: 14px;
      border-top: 1px solid var(--rule);
      text-align: center;
      font-size: 12px;
      color: var(--muted);
    }
    @media print {
      body { background: #fff; padding: 0; }
      .scroll { box-shadow: none; border: none; }
    }
  </style>
</head>
<body>
  <main class="scroll">
    <header class="masthead">
      <p class="kicker">Gloria Romae · Imperial Annals</p>
      <h1>${escapeHtml(titleText)}</h1>
      ${standing ? `<p class="standing">${escapeHtml(standing)}</p>` : ''}
      ${worldMeta}
    </header>
    ${scenarioNote}
    ${steleSection}
    <section aria-label="Chronicle">${turnsHtml}</section>
    <footer>${stampedFooter}</footer>
  </main>
</body>
</html>`;
}

export function triggerHtmlDownload(filename: string, html: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
