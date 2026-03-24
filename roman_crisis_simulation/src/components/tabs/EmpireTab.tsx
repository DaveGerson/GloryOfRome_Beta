import React from 'react';
import { WorldState, RegionState, Entity } from '../../types';
import GlossaryTooltip from '../GlossaryTooltip';

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

const EmpireTab: React.FC<{ worldState: WorldState; entities: Entity[] }> = ({ worldState, entities }) => {
    const getStabilityColor = (stability: string) => {
        const lowerStability = stability.toLowerCase();
        if (lowerStability.includes('unrest')) return 'text-yellow-600 font-bold';
        if (lowerStability.includes('rebellion') || lowerStability.includes('revolt') || lowerStability.includes('wavering')) return 'text-red-700 font-bold';
        if (lowerStability.includes('stable')) return 'text-green-700 font-bold';
        return 'text-stone-700';
    }

    return (
        <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1">Locations in Rome</h3>
            {Object.entries(worldState.regions).map(([name, region]: [string, RegionState]) => {
                const charactersInLocation = entities.filter(e => e.location === name && e.entity_type === 'individual' && e.status === 'alive');
                const glossaryEntry = locationGlossary[name as keyof typeof locationGlossary];

                return (
                    <div key={name} className="roman-stone-panel p-3 rounded-sm">
                        <h4 className="font-bold text-stone-800">
                             {glossaryEntry ? (
                                <GlossaryTooltip description={glossaryEntry.description} wikiLink={glossaryEntry.wikiLink}>
                                    {name}
                                </GlossaryTooltip>
                            ) : name}
                        </h4>
                        <div className="text-sm mt-1 space-y-1">
                            <p><strong>Status:</strong> <span className={getStabilityColor(region.stability)}>{region.stability}</span></p>
                            <p><strong>Control:</strong> {region.controlling_faction ? region.controlling_faction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Disputed'}</p>
                            
                            {region.current_events.length > 0 && (
                                <div>
                                    <h5 className="text-xs font-bold text-stone-700 mt-2">Local Events:</h5>
                                    <ul className="text-xs text-stone-600 list-disc list-inside">
                                        {region.current_events.map((event, i) => <li key={i}>{event}</li>)}
                                    </ul>
                                </div>
                            )}

                            {charactersInLocation.length > 0 && (
                                <div>
                                    <h5 className="text-xs font-bold text-stone-700 mt-2">Characters Present:</h5>
                                    <ul className="text-xs text-stone-600 list-disc list-inside">
                                        {charactersInLocation.map(char => <li key={char.entity_id}>{char.name}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    );
};

export default EmpireTab;