import React from 'react';
import { Entity } from '../../types';
import InfoTooltip from '../InfoTooltip';

const resourceTooltips: Record<string, string> = {
  denarii: "Your personal liquid currency, used for bribes, payments, and general expenses.",
  personal_fortune: "Your total estimated wealth, including property and assets. Not easily spent.",
  deep_analyses: "Represents opportunities to gain in-depth, strategic understanding of a situation or character. A rare and valuable resource for making critical decisions.",
  investigations: "Your capacity to conduct espionage. Spend these to uncover secrets, schemes, or beliefs of other characters.",
  legion_support: "The level of loyalty and support you command from the legions. A critical resource for military actions.",
  senatorial_support: "Your influence within the Senate. Higher support makes it easier to pass legislation and persuade senators.",
  political_influence: "A measure of your general sway and power within the political landscape of Rome.",
  legitimacy: "The degree to which your authority is seen as rightful and just by the people and institutions of Rome.",
  military_might: "The raw power and readiness of military forces aligned with this faction.",
  collective_wealth: "The combined financial power of a faction or group.",
};

const getTooltipText = (key: string): string => {
    if (key.startsWith('blackmail_on_')) {
        const targetName = key.replace('blackmail_on_', '').replace(/_/g, ' ');
        return `Leverage gained over ${targetName} through their secrets. Can be used for coercion.`;
    }
    return resourceTooltips[key] || "A measure of your influence or assets.";
};


const ResourcesTab: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    if (!playerEntity?.resources) {
        return <div className="p-4"><p>No resources to display.</p></div>;
    }

    const directAssets: Record<string, string | number | string[]> = {};
    const influence: Record<string, string | number | string[]> = {};
    const directAssetKeys = ['denarii', 'personal_fortune', 'deep_analyses', 'investigations', 'blackmail'];

    Object.entries(playerEntity.resources).forEach(([key, value]) => {
        if (directAssetKeys.some(k => key.includes(k))) {
            // FIX: Cast `value` from `unknown` to the expected type to resolve the assignment error.
            directAssets[key] = value as string | number | string[];
        } else {
            // FIX: Cast `value` from `unknown` to the expected type to resolve the assignment error.
            influence[key] = value as string | number | string[];
        }
    });

    const renderResourceValue = (value: string | number | string[]) => {
        if (Array.isArray(value)) {
            return (
                <ul className="text-right text-xs italic text-stone-600 mt-1 space-y-0.5 max-w-xs">
                    {value.map((item, index) => <li key={index} className="truncate" title={item}>"{item}"</li>)}
                </ul>
            );
        }
         const isPercentage = typeof value === 'number' && value >= 0 && value <= 100 && !Number.isInteger(value);
        
        return (
            <span className="font-bold text-stone-800">
                {typeof value === 'number' ? value.toLocaleString() : value}
                {isPercentage ? '%' : ''}
            </span>
        );
    };

    const renderResourceList = (resourceMap: Record<string, string | number | string[]>) => (
         <ul className="mt-2 space-y-2">
            {Object.entries(resourceMap).map(([key, value]) => (
                <li key={key} className="flex justify-between items-start">
                    <span className="capitalize text-stone-700 flex items-center">
                        {key.replace(/_/g, ' ')}
                        <InfoTooltip text={getTooltipText(key)} />
                    </span>
                    {renderResourceValue(value)}
                </li>
            ))}
        </ul>
    );

    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1 flex items-center roman-inset-text">
                    Direct Assets
                    <InfoTooltip text="Resources you own and control directly, including tangible assets and uncovered intelligence." />
                </h3>
                {Object.keys(directAssets).length > 0 ? (
                   renderResourceList(directAssets)
                ) : <p className="text-stone-600 mt-2 text-sm">You have no direct assets.</p>}
            </div>
            <div>
                <h3 className="text-lg font-bold text-red-900 border-b border-stone-300 pb-1 flex items-center roman-inset-text">
                    Influence & Support
                    <InfoTooltip text="Resources that are aligned with you but not directly controlled. Their loyalty and support can change." />
                </h3>
                {Object.keys(influence).length > 0 ? (
                    renderResourceList(influence)
                ) : <p className="text-stone-600 mt-2 text-sm">You currently hold no significant influence.</p>}
            </div>
        </div>
    );
};

export default ResourcesTab;