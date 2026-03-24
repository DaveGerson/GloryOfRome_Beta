import { GameEvent, Entity, WorldState } from '../types';

export const ALL_EVENTS: GameEvent[] = [
    {
        id: 'grain_shortage',
        title: 'Grain Shortage in the Capital',
        description: 'A failing grain shipment from Egypt has caused prices to skyrocket in the Suburra. The plebeians are starving and their mood grows sour. If this unrest is not addressed, it could boil over into a full-blown riot.',
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null) => {
            // This event is for the ruler of Rome
            return (player?.position === 'Emperor') && (worldState.economic_stability === 'Failing' || worldState.economic_stability === 'Crisis');
        },
        options: [
            {
                text: 'Release grain from the state reserves.',
                description: 'This will calm the populace but will be a significant expense.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -20000, reason: 'Emergency grain distribution.' },
                    { type: 'region', key: 'The Suburra:stability', delta: 0, reason: 'Stable' },
                ]
            },
            {
                text: 'Impose a special tax on the Senatorial class.',
                description: 'The wealthy can surely afford to solve this problem, but they will not be pleased.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: 25000, reason: 'Special tax on senators for grain relief.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:senatorial_party', delta: -2, reason: 'Angered by a special grain tax.' },
                ]
            },
            {
                text: 'Do nothing and let the market correct itself.',
                description: 'A show of strength, or callousness? The risk of a riot is high.',
                deltas: [
                     { type: 'region', key: 'The Suburra:stability', delta: 0, reason: 'Riots' },
                     { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: -1, reason: 'Seen as ineffective during the grain crisis.' },
                ]
            }
        ]
    },
    {
        id: 'whispers_of_mutiny',
        title: 'Whispers of Mutiny',
        description: "Word has reached you that the Praetorian Guard's loyalty is at its breaking point. Their affinity for Maximinus Thrax grows daily, and there are whispers of a coup to replace you. A decisive action is needed to remind them where their allegiance should lie.",
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null) => {
            if (!player || player.position !== 'Emperor') return false; // Event only for the Emperor

            const praetorianRelation = player.relationships['praetorian_guard'];
            const maximinus = entities.find(e => e.entity_id === 'maximinus_thrax');
            if (!maximinus) return false;
            // This relationship might not exist on Maximinus if they haven't interacted.
            const maximinusPraetorianRelation = maximinus.relationships['praetorian_guard'];

            return (praetorianRelation?.trust_level ?? 0) < 0 && (maximinusPraetorianRelation?.trust_level ?? 0) > 5;
        },
        options: [
            {
                text: 'Promise the Guard an immediate, massive bonus.',
                description: 'Their loyalty can always be bought... for a price.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -50000, reason: 'Massive bonus to ensure Praetorian loyalty.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: 4, reason: 'Promised a massive loyalty bonus.' },
                ]
            },
            {
                text: 'Arrest the suspected ringleaders.',
                description: 'A risky show of force. This could quell the dissent or ignite an open revolt.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: -3, reason: 'Attempted to arrest ringleaders, causing fear and anger.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: -2, reason: 'Seen as a direct attack on military personnel.' },
                ]
            },
            {
                text: 'Publicly denounce Maximinus Thrax as a traitor.',
                description: 'Bring the plot into the open and force everyone to choose a side.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:maximinus_thrax', delta: -5, reason: 'Publicly denounced as a traitor.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: 2, reason: 'Applauded for taking a stand against a military threat.' },
                ]
            }
        ]
    }
];