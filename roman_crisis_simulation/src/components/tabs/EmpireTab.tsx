import React, { useState } from 'react';
import { WorldState, RegionState, Entity } from '../../types';
import GlossaryTooltip from '../GlossaryTooltip';
import { Card, RegisterHeading } from '../ui/Core';
import { SubRail } from '../ui/SubRail';
import { isRegionKnownToPlayer } from '../../perception/visibility';
import { isEntityKnownToPlayer } from '../../knowledge/relationships';
import type { KnowledgeClaim } from '../../knowledge/store';
import { getTabRegister, setTabRegister } from '../../persistence/uiPrefs';

const REGISTERS = ['rome', 'provinces'] as const;
type EmpireRegister = typeof REGISTERS[number];

const locationGlossary = {
    'Palatine Hill': {
        description: "The centermost of the Seven Hills of Rome, it was one of the most desirable neighborhoods in the ancient city and became the home of emperors.",
        wikiLink: "https://en.wikipedia.org/wiki/Palatine_Hill"
    },
    'The Curia': {
        description: "The Senate House of ancient Rome. A site for political meetings, debates, and rulings.",
        wikiLink: "https://en.wikipedia.org/wiki/Curia_Hostilia"
    },
    'Praetorian Camp': {
        description: "The Castra Praetoria were the ancient barracks of the Praetorian Guard. A formidable fortress just outside the city proper.",
        wikiLink: "https://en.wikipedia.org/wiki/Castra_Praetoria"
    },
    'The Suburra': {
        description: "A vast, crowded, and infamous lower-class neighborhood in ancient Rome, known for its crime, poverty, and dense population.",
        wikiLink: "https://en.wikipedia.org/wiki/Suburra"
    }
};

/** Keyword-matched severity tone for a region's free-text stability string. */
const statusTone = (stability: string): string => {
    const s = stability.toLowerCase();
    if (/(rebellion|revolt|waver|simmer)/.test(s)) return 'var(--crimson-500)';
    if (/(unrest|restive|tense|deadlock)/.test(s)) return 'var(--bronze-500)';
    if (/(stable|quiet|loyal)/.test(s)) return 'var(--laurel-500)';
    return 'var(--text-body)';
};

/**
 * Item 23's RECKONED register: a reading the player's agents estimated rather
 * than counted. A dashed track with a Tyrian ◆ where a solid meter's numeral
 * would be, so an uncertain reading never wears the clothes of a certain one.
 */
const ReckonedReadout: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="gor-reckoned">
        <div className="gor-meter-row">
            <span className="gor-label">{label}</span>
            <span style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--text-heading)' }}>
                {value}<span aria-hidden="true" className="gor-reckoned-mark">◆</span>
            </span>
        </div>
        <span className="gor-reckoned-track" aria-hidden="true" />
    </div>
);

/**
 * D5 - the same locality/network sight rule as WorldStateTab
 * (isRegionKnownToPlayer): full detail only for regions the player stands
 * in or has network eyes on; everything else is a name and nothing more.
 * Location lore (the glossary) stays on hidden rows - what the Palatine IS
 * is common knowledge; what's happening there this week is not.
 */
const EmpireTab: React.FC<{
    worldState: WorldState;
    entities: Entity[];
    playerEntity: Entity | null;
    knowledge: KnowledgeClaim[];
}> = ({ worldState, entities, playerEntity, knowledge }) => {
    const [register, setRegister] = useState<EmpireRegister>(() => getTabRegister('locations', REGISTERS, 'rome'));
    const knownEntities = playerEntity
        ? entities.filter(entity => isEntityKnownToPlayer(playerEntity, entity, knowledge))
        : [];

    const regionNames = Object.keys(worldState.regions);
    const knownCount = playerEntity
        ? regionNames.filter(name => isRegionKnownToPlayer(name, playerEntity, entities)).length
        : 0;

    const selectRegister = (next: EmpireRegister) => {
        setRegister(next);
        setTabRegister('locations', next);
    };

    const rail = (
        <SubRail
            ariaLabel="Empire register"
            value={register}
            onChange={selectRegister}
            options={[
                { value: 'rome', label: 'Rome', count: knownCount },
                { value: 'provinces', label: 'The Provinces' },
            ]}
        />
    );

    if (register === 'provinces') {
        return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {rail}
            <RegisterHeading title="The state of the Empire" />
            {/* Item 23's RECKONED register: these two are the model's own free
                prose, not figures the simulation holds, so they get a hedged
                phrase behind a dashed track and a Tyrian ◆ — never a
                false-precise number. */}
            <ReckonedReadout label="Economic Stability" value={worldState.economic_stability} />
            <ReckonedReadout label="Political Climate" value={worldState.political_climate} />
            <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
                ◆ marks a reading your agents reckoned rather than counted.
            </p>
        </div>;
    }

    return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rail}
        <RegisterHeading title="Locations in Rome" />
        {/* What is unwritten is most of the map — say how much, rather than
            letting a column of blanked vellum read as a fault. */}
        <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)', marginTop: -8 }}>
            {knownCount} of {regionNames.length} known.
        </span>
        {Object.entries(worldState.regions).map(([name, region]: [string, RegionState]) => {
            const glossaryEntry = locationGlossary[name as keyof typeof locationGlossary];
            const title = glossaryEntry ? (
                <GlossaryTooltip description={glossaryEntry.description} wikiLink={glossaryEntry.wikiLink}>
                    {name}
                </GlossaryTooltip>
            ) : name;
            const known = playerEntity ? isRegionKnownToPlayer(name, playerEntity, entities) : false;

            if (!known) {
                // Item 27: blanked vellum at FULL opacity, not opacity:.6 —
                // a dimmed card reads as "disabled", when what this actually
                // means is "unwritten".
                return (
                    <div key={name} className="gor-card gor-vellum" style={{ padding: '10px 14px' }}>
                        <span className="gor-vellum-name">{title}</span>
                        <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)', margin: '3px 0 0' }}>No word has reached you from here.</p>
                    </div>
                );
            }

            const charactersInLocation = knownEntities.filter(e => e.location === name && e.entity_type === 'individual' && e.status === 'alive');
            return (
                <Card
                    key={name}
                    title={title}
                    action={<span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: statusTone(region.stability) }}>{region.stability}</span>}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                        <span><strong>Control:</strong> {region.controlling_faction ? region.controlling_faction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Disputed'}</span>
                        {region.current_events.length > 0 && (
                            <span><strong>Word on the street:</strong> {region.current_events.join(' · ')}</span>
                        )}
                        {charactersInLocation.length > 0 && (
                            <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Present: {charactersInLocation.map(char => char.name).join(', ')}</span>
                        )}
                    </div>
                </Card>
            );
        })}
    </div>;
};

export default EmpireTab;
