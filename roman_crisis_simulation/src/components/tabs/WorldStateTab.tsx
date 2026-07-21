import React from 'react';
import { Entity, SimulationState, WorldState, RegionState } from '../../types';
import { Card, Badge } from '../ui/Core';

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

type Severity = 'good' | 'warn' | 'bad';

const SEVERITY_TONES: Record<Severity, 'laurel' | 'bronze' | 'crimson'> = {
    good: 'laurel',
    warn: 'bronze',
    bad: 'crimson',
};

const IMPERIAL_STATUS_SEVERITY: Record<SimulationState['imperial_status'], Severity> = {
    Stable: 'good',
    Contested: 'warn',
    Vacant: 'bad',
};

const SENATE_STATUS_SEVERITY: Record<SimulationState['senate_status'], Severity> = {
    Ascendant: 'good',
    Functional: 'good',
    Irrelevant: 'warn',
    Deposed: 'bad',
};

const MILITARY_STATUS_SEVERITY: Record<SimulationState['military_status'], Severity> = {
    Loyal: 'good',
    Divided: 'warn',
    Rebellious: 'bad',
};

const PLEBEIAN_MOOD_SEVERITY: Record<SimulationState['plebeian_mood'], Severity> = {
    Content: 'good',
    Uneasy: 'warn',
    Rioting: 'bad',
};

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

const MacroStatusRow: React.FC<{ label: string; value: string; severity: Severity }> = ({ label, value, severity }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 2px', borderBottom: '1px solid var(--border-faint)' }}>
        <span className="gor-label">{label}</span>
        <Badge tone={SEVERITY_TONES[severity]}>{value}</Badge>
    </div>
);

/** Is `regionName` something the player has direct or networked sight into? */
function isRegionKnownToPlayer(regionName: string, player: Entity, entities: Entity[]): boolean {
    if (player.location === regionName) return true;
    return player.visibility_network.some(id => entities.find(e => e.entity_id === id)?.location === regionName);
}

const KnownRegionCard: React.FC<{ name: string; region: RegionState; isHome: boolean }> = ({ name, region, isHome }) => (
    <Card title={name} action={isHome ? <Badge tone="gold">Your location</Badge> : undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
            <span><strong>Status:</strong> {region.stability}</span>
            <span><strong>Control:</strong> {region.controlling_faction ? region.controlling_faction.replace(/_/g, ' ') : 'Disputed'}</span>
            {region.current_events.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-muted)' }}>
                    {region.current_events.map((event, i) => <li key={i}>{event}</li>)}
                </ul>
            )}
        </div>
    </Card>
);

const HiddenRegionRow: React.FC<{ name: string }> = ({ name }) => (
    <div className="gor-card" style={{ padding: '10px 14px', opacity: 0.6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{name}</span>
        <p style={{ ...quiet, fontSize: 13, margin: '3px 0 0' }}>Beyond your sight - no word has reached you from here.</p>
    </div>
);

const WorldStateTab: React.FC<{
    simulationState: SimulationState;
    worldState: WorldState;
    entities: Entity[];
    playerEntity: Entity | null;
    currentEvents: string[];
}> = ({ simulationState, worldState, entities, playerEntity, currentEvents }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
            <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>The State of the Empire</h3>
            <p style={{ ...quiet, fontSize: 13, margin: '3px 0 8px' }}>As known to you - common knowledge across the Empire.</p>
            <div className="gor-card" style={{ padding: '6px 14px 8px' }}>
                <MacroStatusRow label="The Throne" value={simulationState.imperial_status} severity={IMPERIAL_STATUS_SEVERITY[simulationState.imperial_status]} />
                <MacroStatusRow label="The Senate" value={simulationState.senate_status} severity={SENATE_STATUS_SEVERITY[simulationState.senate_status]} />
                <MacroStatusRow label="The Legions" value={simulationState.military_status} severity={MILITARY_STATUS_SEVERITY[simulationState.military_status]} />
                <MacroStatusRow label="The Plebs" value={simulationState.plebeian_mood} severity={PLEBEIAN_MOOD_SEVERITY[simulationState.plebeian_mood]} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 2px' }}>
                    <span className="gor-label">Ongoing Crisis</span>
                    {simulationState.major_ongoing_crisis
                        ? <Badge tone="crimson">{simulationState.major_ongoing_crisis}</Badge>
                        : <span style={quiet}>None reported</span>}
                </div>
            </div>
        </div>

        <div>
            <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Recent Headlines</h3>
            {currentEvents.length === 0 ? (
                <p style={{ ...quiet, marginTop: 8 }}>The city criers have nothing new to shout.</p>
            ) : (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {currentEvents.map((event, i) => <li key={i}>{event}</li>)}
                </ul>
            )}
        </div>

        <div>
            <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Your Intelligence Picture</h3>
            <p style={{ ...quiet, fontSize: 13, margin: '3px 0 8px' }}>Regions you can see - your own ground, and anywhere your network has eyes.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
