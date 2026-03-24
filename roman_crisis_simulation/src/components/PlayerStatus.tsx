import React from 'react';
import { Entity } from '../types';
import InfoTooltip from './InfoTooltip';

const PlayerStatus: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    if (!playerEntity) return null;

    const narrativeSnippet = playerEntity.current_state_narrative.split('.').slice(0, 2).join('.') + '.';

    return (
        <div className="p-4 bg-gradient-to-b from-[#e8e6e1] to-[#d8d5ce] border-b-4 border-double border-[#c9c5b8]">
            <h3 className="text-xl font-bold text-red-900 roman-inset-text">{playerEntity.name}</h3>
            <p className="text-sm text-stone-700">{playerEntity.position}</p>
            <div className="mt-3 pt-2 border-t border-stone-300">
                <div className="flex items-center text-sm font-bold text-stone-800">
                    Current Goal <InfoTooltip text="Your character's most immediate objective. Pursue this or forge your own path." />
                </div>
                <p className="text-sm text-stone-600 italic">
                    {playerEntity.short_term_goals[0] || "Survive the week."}
                </p>
            </div>
             <div className="mt-2">
                <div className="flex items-center text-sm font-bold text-stone-800">
                    Current State <InfoTooltip text="Your character's current emotional and physical state, which influences their thoughts." />
                </div>
                <p className="text-sm text-stone-600">
                    {narrativeSnippet}
                </p>
            </div>
        </div>
    );
};

export default PlayerStatus;
