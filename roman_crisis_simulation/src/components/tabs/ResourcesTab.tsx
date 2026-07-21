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

const quiet: React.CSSProperties = { fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)' };

const ResourcesTab: React.FC<{ playerEntity: Entity | null }> = ({ playerEntity }) => {
    if (!playerEntity?.resources) {
        return <p style={quiet}>No resources to display.</p>;
    }

    const directAssets: Record<string, string | number | string[]> = {};
    const influence: Record<string, string | number | string[]> = {};
    const directAssetKeys = ['denarii', 'personal_fortune', 'deep_analyses', 'investigations', 'blackmail'];

    Object.entries(playerEntity.resources).forEach(([key, value]) => {
        if (directAssetKeys.some(k => key.includes(k))) {
            directAssets[key] = value as string | number | string[];
        } else {
            influence[key] = value as string | number | string[];
        }
    });

    const renderRow = (key: string, value: string | number | string[]) => {
        const isBlackmail = key.startsWith('blackmail_on_');
        if (Array.isArray(value)) {
            return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
                    <span className="gor-label" style={{ color: isBlackmail ? 'var(--crimson-500)' : undefined, display: 'inline-flex', alignItems: 'center' }}>
                        {key.replace(/_/g, ' ')}
                        <InfoTooltip text={getTooltipText(key)} />
                    </span>
                    {value.map((item, index) => (
                        <span key={index} style={{ ...quiet, textAlign: 'right' }} title={item}>“{item}”</span>
                    ))}
                </div>
            );
        }
        // Fractional 0-100 values are ratios and read as percentages (a
        // long-standing display convention carried over from the old UI).
        const isPercentage = typeof value === 'number' && value >= 0 && value <= 100 && !Number.isInteger(value);
        return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 2px', borderBottom: '1px solid var(--border-faint)' }}>
                <span className="gor-label" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {key.replace(/_/g, ' ')}
                    <InfoTooltip text={getTooltipText(key)} />
                </span>
                <span className="gor-meter-val" style={{ textAlign: 'right' }}>
                    {typeof value === 'number' ? value.toLocaleString() : value}
                    {isPercentage ? '%' : ''}
                </span>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
                <span className="gor-label" style={{ color: 'var(--crimson-500)', display: 'inline-flex', alignItems: 'center' }}>
                    Direct Assets
                    <InfoTooltip text="Resources you own and control directly, including tangible assets and uncovered intelligence." />
                </span>
                {Object.keys(directAssets).length > 0
                    ? Object.entries(directAssets).map(([k, v]) => renderRow(k, v))
                    : <p style={{ ...quiet, marginTop: 8 }}>You have no direct assets.</p>}
            </div>
            <div>
                <span className="gor-label" style={{ color: 'var(--crimson-500)', display: 'inline-flex', alignItems: 'center' }}>
                    Influence &amp; Support
                    <InfoTooltip text="Resources that are aligned with you but not directly controlled. Their loyalty and support can change." />
                </span>
                {Object.keys(influence).length > 0
                    ? Object.entries(influence).map(([k, v]) => renderRow(k, v))
                    : <p style={{ ...quiet, marginTop: 8 }}>You currently hold no significant influence.</p>}
            </div>
        </div>
    );
};

export default ResourcesTab;
