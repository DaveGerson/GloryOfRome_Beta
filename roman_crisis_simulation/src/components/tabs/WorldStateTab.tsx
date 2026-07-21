import React from 'react';
import { Entity, SimulationState, WorldState, RegionState } from '../../types';

/**
 * "The State of the Empire - as known to you" (Phase 2 item 2, D5).
 *
 * Two different visibility rules apply on this one screen:
 *  - The macro SimulationState fields (imperial_status, senate_status,
 *    military_status, plebeian_mood, major_ongoing_crisis) are treated as
 *    PUBLIC per D5's "crude v1 convention" - "the throne is vacant" is the
 *    kind of thing everyone in the Empire knows, so these are always shown
 *    in full, color-coded by severity.
 *  - Region detail is NOT public. It's shown in full only for the player's
 *    current location and any region containing one of their
 *    visibility_network contacts (the same locality/network rule
 *    perception/visibility.ts applies to region-type EventDeltas). Every
 *    other region is listed by name only, marked "beyond your sight" - the
 *    player is never shown raw global truth about places they have no eyes
 *    on.
 */

const SEVERITY_COLORS: Record<string, string> = {
    good: 'text-green-700',
    warn: 'text-yellow-700',
    bad: 'text-red-800',
};

function badgeClass(severity: 'good' | 'warn' | 'bad'): string {
    return `font-bold ${SEVERITY_COLORS[severity]}`;
}

const IMPERIAL_STATUS_SEVERITY: Record<SimulationState['imperial_status'], 'good' | 'warn' | 'bad'> = {
    Stable: 'good',
    Contested: 'warn',
    Vacant: 'bad',
};

const SENATE_STATUS_SEVERITY: Record<SimulationState['senate_status'], 'good' | 'warn' | 'bad'> = {
    Ascendant: 'good',
    Functional: 'good',
    Irrelevant: 'warn',
    Deposed: 'bad',
};

const MILITARY_STATUS_SEVERITY: Record<SimulationState['military_status'], 'good' | 'warn' | 'bad'> = {
    Loyal: 'good',
    Divided: 'warn',
    Rebellious: 'bad',
};

const PLEBEIAN_MOOD_SEVERITY: Record<SimulationState['plebeian_mood'], 'good' | 'warn' | 'bad'> = {
    Content: 'good',
    Uneasy: 'warn',
    Rioting: 'bad',
};

const MacroStatusRow: React.FC<{ label: string; value: string; severity: 'good' | 'warn' | 'bad' }> = ({ label, value, severity }) => (
    <div className="flex justify-between items-center py-1 border-b border-stone-300/60 last:border-b-0">
        <span className="text-stone-700">{label}</span>
        <span className={badgeClass(severity)}>{value}</span>
    </div>
);

/** Is `regionName` something the player has direct or networked sight into? */
function isRegionKnownToPlayer(regionName: string, player: Entity, entities: Entity[]): boolean {
    if (player.location === regionName) return true;
    return player.visibility_network.some(id => entities.find(e => e.entity_id === id)?.location === regionName);
}

const KnownRegionCard: React.FC<{ name: string; region: RegionState; isHome: boolean }> = ({ name, region, isHome }) => (
    <div className="roman-stone-panel p-3 rounded-sm">
        <h4 className="font-bold text-stone-800 flex items-center gap-2">
            {name}
            {isHome && <span className="text-xs font-normal text-red-900 uppercase tracking-wide">(your location)</span>}
        </h4>
        <p className="text-sm mt-1"><strong>Status:</strong> {region.stability}</p>
        <p className="text-sm"><strong>Control:</strong> {region.controlling_faction ? region.controlling_faction.replace(/_/g, ' ') : 'Disputed'}</p>
        {region.current_events.length > 0 && (
            <ul className="text-xs text-stone-600 list-disc list-inside mt-1">
                {region.current_events.map((event, i) => <li key={i}>{event}</li>)}
            </ul>
        )}
    </div>
);

const HiddenRegionRow: React.FC<{ name: string }> = ({ name }) => (
    <div className="roman-stone-panel p-3 rounded-sm opacity-60">
        <h4 className="font-bold text-stone-600">{name}</h4>
        <p className="text-xs italic text-stone-500 mt-1">Beyond your sight - no word has reached you from here.</p>
    </div>
);

const WorldStateTab: React.FC<{
    simulationState: SimulationState;
    worldState: WorldState;
    entities: Entity[];
    playerEntity: Entity | null;
    currentEvents: string[];
}> = ({ simulationState, worldState, entities, playerEntity, currentEvents }) => (
    <div className="p-4 space-y-4">
        <div>
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">The State of the Empire</h3>
            <p className="text-xs text-stone-500 mt-1 mb-2 italic">As known to you - common knowledge across the Empire.</p>
            <div className="roman-stone-panel p-3 rounded-sm">
                <MacroStatusRow label="The Throne" value={simulationState.imperial_status} severity={IMPERIAL_STATUS_SEVERITY[simulationState.imperial_status]} />
                <MacroStatusRow label="The Senate" value={simulationState.senate_status} severity={SENATE_STATUS_SEVERITY[simulationState.senate_status]} />
                <MacroStatusRow label="The Legions" value={simulationState.military_status} severity={MILITARY_STATUS_SEVERITY[simulationState.military_status]} />
                <MacroStatusRow label="The Plebs" value={simulationState.plebeian_mood} severity={PLEBEIAN_MOOD_SEVERITY[simulationState.plebeian_mood]} />
                <div className="flex justify-between items-center py-1">
                    <span className="text-stone-700">Ongoing Crisis</span>
                    <span className={simulationState.major_ongoing_crisis ? badgeClass('bad') : 'text-stone-500'}>
                        {simulationState.major_ongoing_crisis ?? 'None reported'}
                    </span>
                </div>
            </div>
        </div>

        <div>
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Recent Headlines</h3>
            {currentEvents.length === 0 ? (
                <p className="text-stone-600 text-sm mt-2">The city criers have nothing new to shout.</p>
            ) : (
                <ul className="text-sm text-stone-700 list-disc list-inside mt-2 space-y-1">
                    {currentEvents.map((event, i) => <li key={i}>{event}</li>)}
                </ul>
            )}
        </div>

        <div>
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Your Intelligence Picture</h3>
            <p className="text-xs text-stone-500 mt-1 mb-2 italic">Regions you can see - your own ground, and anywhere your network has eyes.</p>
            <div className="space-y-2">
                {Object.entries(worldState.regions).map(([name, region]) => {
                    if (!playerEntity) return <HiddenRegionRow key={name} name={name} />;
                    const known = isRegionKnownToPlayer(name, playerEntity, entities);
                    return known ? (
                        <KnownRegionCard key={name} name={name} region={region} isHome={playerEntity.location === name} />
                    ) : (
                        <HiddenRegionRow key={name} name={name} />
                    );
                })}
            </div>
        </div>
    </div>
);

export default WorldStateTab;
