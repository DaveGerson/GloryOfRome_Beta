import React from 'react';
import { WorldState, RegionState, Entity } from '../../types';
import GlossaryTooltip from '../GlossaryTooltip';
import { Card } from '../ui/Core';

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

const EmpireTab: React.FC<{ worldState: WorldState; entities: Entity[] }> = ({ worldState, entities }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 className="gor-label" style={{ color: 'var(--crimson-500)' }}>Locations in Rome</h3>
        {Object.entries(worldState.regions).map(([name, region]: [string, RegionState]) => {
            const charactersInLocation = entities.filter(e => e.location === name && e.entity_type === 'individual' && e.status === 'alive');
            const glossaryEntry = locationGlossary[name as keyof typeof locationGlossary];

            return (
                <Card
                    key={name}
                    title={glossaryEntry ? (
                        <GlossaryTooltip description={glossaryEntry.description} wikiLink={glossaryEntry.wikiLink}>
                            {name}
                        </GlossaryTooltip>
                    ) : name}
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
    </div>
);

export default EmpireTab;
