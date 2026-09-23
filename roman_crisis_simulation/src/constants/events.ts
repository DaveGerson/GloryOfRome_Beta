import { GameEvent, Entity, WorldState, SimulationState } from '../types';
import { isEconomyAtOrWorseThan } from '../events/stabilityVocabulary';

/**
 * The authored-event library (ROADMAP_PHASE_4.md 4D item 2, D12/D24):
 * historically-grounded payoff MATERIAL for the 235-238 AD crisis, not a
 * fire-once script collection. Contract for every event here:
 *  - Triggers are ROLE-AGNOSTIC predicates over world/sim state and the
 *    entity roster - no player.position gates; any playable character can
 *    face any of these currents.
 *  - `repeatable`/`cooldownTurns` govern re-firing (events/engine.ts::
 *    isEventEligible); an event without `repeatable` keeps the original
 *    fire-once contract.
 *  - `premise` is the one-line GM-side seed the adjudicator may weave into
 *    a turn when its PACING JUDGMENT tightens (the HISTORICAL MATERIAL
 *    block, ai/prompts/adjudication.ts); verbatim modal firing stays the
 *    exception (D12).
 *  - Choice deltas use the PLAYER_CHARACTER placeholder
 *    (events/engine.ts::applyEventChoiceDeltas) and only delta types that
 *    mint no Reports/ledger entries - see the DISCARD CONSTRAINT note
 *    there before adding 'rumor' deltas to any authored choice.
 *  - `worldState.economic_stability` is a free string the adjudicator
 *    writes; triggers MUST read it through events/stabilityVocabulary.ts
 *    (canonical grades + synonym normalizer), never by raw `===`, so a
 *    synonym ("Collapsing" for "Failing") cannot leave an event dormant
 *    (BACKLOG B7; pinned by tests/stabilityVocabulary.test.ts).
 */
export const ALL_EVENTS: GameEvent[] = [
    {
        id: 'grain_shortage',
        title: 'Grain Shortage in the Capital',
        description: 'A failing grain shipment from Egypt has caused prices to skyrocket in the Suburra. The plebeians are starving and their mood grows sour. If this unrest is not addressed, it could boil over into a full-blown riot.',
        premise: "The Egyptian grain fleet fails and bread prices triple in the Suburra - the mob's patience is thinning toward riot.",
        // Role-agnostic (4D.2): a starving capital confronts ANY player -
        // emperor, senator, or broker - the moment the economy fails.
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null) => {
            return player !== null && isEconomyAtOrWorseThan(worldState.economic_stability, 'Failing');
        },
        // Famine recurs while the economy stays broken; a season's relief
        // buys roughly ten weeks before the granaries empty again.
        repeatable: true,
        cooldownTurns: 10,
        options: [
            {
                text: 'Spend your own fortune on grain, distributed in your name.',
                description: 'Feed the mob at ruinous personal expense - and let every loaf carry your name.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -20000, reason: 'Emergency grain bought and distributed in your name.' },
                    { type: 'region', key: 'The Suburra:stability', delta: 0, reason: 'Stable' },
                ]
            },
            {
                text: 'Demand the Senatorial class fund the relief.',
                description: 'The wealthy can surely afford to solve this problem, but they will not thank whoever forces their hand.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: 25000, reason: 'Senatorial grain levy, extracted under your pressure.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:senatorial_party', delta: -2, reason: 'Angered by a forced grain levy.' },
                ]
            },
            {
                text: 'Do nothing and let the market correct itself.',
                description: 'A show of composure, or callousness? The risk of a riot is high.',
                deltas: [
                     { type: 'region', key: 'The Suburra:stability', delta: 0, reason: 'Riots' },
                     { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: -1, reason: 'Seen as indifferent during the grain crisis.' },
                ]
            }
        ]
    },
    {
        id: 'whispers_of_mutiny',
        title: 'Whispers of Mutiny',
        description: "Word reaches you that the Praetorian Guard's patience with you is at its breaking point. Their affinity for a rival grows daily, and there are whispers in the barracks of moving against you. A decisive action is needed to remind them where their allegiance should lie.",
        premise: "The Praetorian Guard's loyalty runs thin - their favor drifts to a rival, and the barracks whisper of a change of masters.",
        // Role-agnostic (4D.2): generalizes the old Emperor-only,
        // maximinus_thrax-hardcoded check. Fires for ANY player the Guard
        // has soured on while it warms to some OTHER patron - the Guard's
        // OWN directional relationships are read (its trust toward the
        // player vs. toward any rival), not the player's perception of it.
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null) => {
            if (!player) return false;
            const guard = entities.find(e => e.entity_id === 'praetorian_guard');
            if (!guard || guard.status !== 'alive') return false;
            const trustInPlayer = guard.relationships[player.entity_id]?.trust_level ?? 0;
            const favorsRival = Object.values(guard.relationships).some(
                r => r && r.entity_id !== player.entity_id && r.trust_level > 5
            );
            return trustInPlayer < 0 && favorsRival;
        },
        // The Guard's loyalty is never settled for long; bought or cowed,
        // it drifts again within a season.
        repeatable: true,
        cooldownTurns: 12,
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
                text: 'Expose the plot before the Senate.',
                description: 'Bring the whispers into the open and force everyone to choose a side.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: 2, reason: 'Applauded for exposing a plot within the Guard.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: -2, reason: 'Humiliated before the Senate by your denunciation.' },
                ]
            }
        ]
    },
    // --- 4D.2 new historical seeds (235-238 AD, the Maximinus era) ---------
    {
        id: 'rhine_acclamation',
        title: 'Acclamation on the Rhine',
        description: 'Dispatches from Mogontiacum: the Rhine legions, weary of unpaid campaigns and contemptuous of distant civilian masters, have raised a general upon their shields and hailed him imperator. The frontier army now expects Rome to answer - with recognition, with gold, or with war.',
        premise: "On the Rhine, legions weary of arrears and civilian masters raise a soldier's name upon their shields - an acclamation Rome must answer.",
        // Historical seed: March 235, the Rhine legions at Mogontiacum
        // acclaimed Maximinus Thrax against Severus Alexander. Keys off the
        // empire-level meta-state: a rebellious army acclaims outright; a
        // divided one does so once a major crisis gives it cover.
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null, simulationState?: SimulationState) => {
            if (!player || !simulationState) return false;
            return simulationState.military_status === 'Rebellious'
                || (simulationState.military_status === 'Divided' && simulationState.major_ongoing_crisis !== null);
        },
        // Acclamations recur while soldiers make emperors; each one buys a
        // season of wary quiet at most.
        repeatable: true,
        cooldownTurns: 16,
        options: [
            {
                text: 'Send envoys with gold to buy the legions\' patience.',
                description: 'A donative may hold the frontier - and teach the army that acclamation pays.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -30000, reason: 'Donative dispatched to the Rhine legions.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: 2, reason: 'Bought goodwill among the commanders.' },
                ]
            },
            {
                text: 'Denounce the acclaimed usurper as an enemy of Rome.',
                description: 'Force the Senate and the city to close ranks - and make the frontier your open enemy.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: 2, reason: 'Rallied the Senate against a usurper.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: -3, reason: 'Declared against the soldiers\' choice.' },
                ]
            },
            {
                text: 'Open secret talks with the acclaimed general\'s camp.',
                description: 'Every usurper needs friends in Rome. Better to be owed by the next emperor than proscribed by him.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: 3, reason: 'Quietly courted the acclaimed general\'s partisans.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: -2, reason: 'Rumbles that you treat with usurpers.' },
                ]
            }
        ]
    },
    {
        id: 'gordian_stirrings',
        title: 'Stirrings in Africa',
        description: 'Letters out of Carthage and Thysdrus: the great landowners of Africa, bled white by imperial exactions, have killed a rapacious procurator and now press the aged proconsul to accept the purple. In Rome, senators are quietly counting votes - whoever moves first, for or against the African cause, will shape what follows.',
        premise: 'In Africa, taxed landowners edge an aging proconsul toward the purple - and senators in Rome quietly count votes for a rival regime.',
        // Historical seed: 238 AD, the Gordians' proclamation at Thysdrus
        // after a procurator's extortions, embraced by the Senate. Keys off
        // the meta-state: a wobbling throne plus a Senate still capable of
        // blessing a rival.
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null, simulationState?: SimulationState) => {
            if (!player || !simulationState) return false;
            return simulationState.imperial_status !== 'Stable'
                && (simulationState.senate_status === 'Functional' || simulationState.senate_status === 'Ascendant');
        },
        // Fire-once: Africa rises behind a rival claimant only once per
        // campaign - however it ends, that die stays cast.
        options: [
            {
                text: 'Back the African cause with money and letters.',
                description: 'Bind yourself early to the rival regime the Senate may yet bless.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -15000, reason: 'Gold and pledges sent to the African estates.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:senatorial_party', delta: 3, reason: 'Seen as a friend of the senatorial cause in Africa.' },
                ]
            },
            {
                text: 'Expose the conspiracy\'s correspondents in Rome.',
                description: 'Name the senators counting votes for Africa - and let the reigning power owe you for it.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:senatorial_party', delta: -3, reason: 'Betrayed the African cause\'s friends in the Curia.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: 2, reason: 'Handed the soldiers a list of senatorial conspirators.' },
                ]
            },
            {
                text: 'Stay silent and let Africa and the throne bleed each other.',
                description: 'Neither letter nor denunciation leaves your hand. Patience is also a weapon.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:roman_senate', delta: -1, reason: 'Your silence during the African crisis was noted.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:senatorial_party', delta: -1, reason: 'The African cause\'s friends remember who stood aside.' },
                ]
            }
        ]
    },
    {
        id: 'praetorian_pay_crisis',
        title: 'The Donative Comes Due',
        description: 'The Praetorian pay chests stand near empty: pay runs weeks in arrears while bread prices climb, and the cohorts on the Viminal are openly reckoning what a change of regime has historically been worth to them. Their tribunes present the demand politely, once.',
        premise: "The Praetorians' pay runs in arrears while prices climb - the Guard names its donative, and its patience is priced in denarii.",
        // Historical seed: the third-century crisis pattern of donatives and
        // arrears deciding the Guard's loyalty (as at every accession since
        // Claudius). Keys off a failing economy plus an army no longer
        // reliably loyal - role-agnostic: the Guard presents the bill to
        // whoever holds visible power or wealth.
        trigger: (worldState: WorldState, entities: Entity[], player: Entity | null, simulationState?: SimulationState) => {
            if (!player || !simulationState) return false;
            return isEconomyAtOrWorseThan(worldState.economic_stability, 'Failing')
                && simulationState.military_status !== 'Loyal';
        },
        // Arrears accumulate again in about two months of a broken economy.
        repeatable: true,
        cooldownTurns: 8,
        options: [
            {
                text: 'Pay the donative in full, at once.',
                description: 'Empty the chests and keep the Guard\'s swords sheathed - until the next reckoning.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -40000, reason: 'Praetorian donative paid in full.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: 3, reason: 'Paid the donative without haggling.' },
                ]
            },
            {
                text: 'Pay half now, and promise the rest against future revenues.',
                description: 'Split the difference - and hope the Guard\'s arithmetic is forgiving.',
                deltas: [
                    { type: 'resource', key: 'PLAYER_CHARACTER:denarii', delta: -20000, reason: 'Half the donative paid, the rest promised.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: -1, reason: 'The Guard counts promises at half their face value.' },
                ]
            },
            {
                text: 'Refuse, and remind them of their oath.',
                description: 'Oaths are cheaper than denarii. The Guard has broken both before.',
                deltas: [
                    { type: 'relation', key: 'PLAYER_CHARACTER:praetorian_guard', delta: -4, reason: 'Refused the donative outright.' },
                    { type: 'relation', key: 'PLAYER_CHARACTER:military_cabal', delta: -1, reason: 'Word spreads that you stint the soldiers.' },
                ]
            }
        ]
    }
];
