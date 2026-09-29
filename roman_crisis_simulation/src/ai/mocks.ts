
// ai/mocks.ts

import { Entity, NpcIntent, NpcMindDecision, Report, SimulationState, StoryRelevance, TruthLedgerEntry, TurnHistoryEntry, WorldState, EventDelta, EntityStub, TurnSubmission } from '../types';
import { applyAdjudication } from './core/engine';
import { MAX_MINDS_PER_TURN } from './prompts/npcMind';
import { normalizeTurnSubmissionInput, projectForNoAttemptResponse, projectForPlayerHistory, projectForPlayerReflection, projectForResolution, serializeTurnSubmission } from '../playerInput/turnSubmission';
import type { PrivateSceneAdjudicatorProjection, PrivateSceneModelResponse, PrivateSceneNpcMemoryProjection } from '../privateScene/model';
import type { PrivateScenePromptInput } from './prompts/privateScene';
import {
  assertNoInventedPlayerAction,
  assertNoPlayerRemoval,
  assertPlayerVisibleAdjudicationSafe,
  playerOwnsDelta,
  playerProseRedactionNotes,
  redactInventedPlayerProse,
  redactInventedPlayerProseFromValue,
  samePlayerIdentity,
} from './core/playerBoundary';
import { stripActorsFromAdjudication, type AdjudicationInterchange, type EventDeltaInterchange } from './core/actorsBoundary';
import { selectDurableIntents } from './core/directorIntents';
import type { GroundTruthKind, InvestigationPlan, PlannedFinding, SchemeNaturePlan } from './core/groundTruth';

/** Deterministic, provider-free private-scene fixture for local play and tests. */
export function mockContinuePrivateScene(input: PrivateScenePromptInput): PrivateSceneModelResponse {
    const latestText = input.transcript.at(-1)?.text ?? '';
    const refused = input.phase === 'invitation' && /\brefus(?:e|es|ed|al)\b/i.test(latestText);
    const ended = !refused && /\b(?:farewell|goodbye)\b/i.test(latestText);
    const disposition: PrivateSceneModelResponse['disposition'] = refused
        ? 'refused'
        : ended
            ? 'ends'
            : 'continues';
    const npcUtterance = refused
        ? 'No. I will not receive you in private.'
        : ended
            ? 'Then we have said all that needs saying.'
            : 'I hear your request. Speak plainly, and I will answer in kind.';

    return {
        disposition,
        npcUtterance,
        speechActs: [{
            speaker: 'npc',
            kind: refused ? 'refusal' : ended ? 'claim' : 'request',
            text: npcUtterance,
            exchange: input.exchange,
        }],
        npcPrivate: {
            sincerity: refused ? 'Firm and sincere.' : ended ? 'Resolved to leave.' : 'Cautious but willing to listen.',
            hiddenIntent: refused ? 'Avoid entanglement.' : ended ? 'End the conversation without further commitment.' : 'Learn what the player truly wants.',
            plannedFollowThrough: disposition === 'continues' ? ['Listen before deciding what to do next.'] : [],
        },
    };
}

// --- MOCK DATA ---
const MOCK_NEW_MOBSTER: Entity = {
    entity_id: "flavius_fulco",
    name: "Flavius Fulco",
    entity_type: "individual",
    status: "alive",
    position: "Suburra Gang Leader",
    // 4C.5 narrative flavor - mock entities carry voice/epithet like real
    // worldgen output does.
    voice: "Suburra gutter cant; menace delivered smiling",
    epithet: "the Collector",
    location: "The Suburra",
    personality: { ambition: 8, paranoia: 7, loyalty: 3, cunning: 8, honor: 2 },
    beliefs: ["Coin is the only true emperor.", "Fear is a more reliable tool than loyalty."],
    secrets: ["Owes a debt to a dangerous senator."],
    skills: { oratory: 5, administration: 6, strategy: 4, intrigue: 8 },
    active_scheme: {
        name: "Suburra Supremacy",
        overall_goal: "Consolidate control over the Suburra's criminal underworld.",
        steps: [
            { objective: "Eliminate rival gangs", status: 'in_progress' },
            { objective: "Extort protection money from merchants", status: 'in_progress' },
        ]
    },
    current_state_narrative: "Flavius Fulco, a ruthless and ambitious gang leader, has emerged from the shadows of the Suburra. He sees the city's instability as the perfect opportunity to expand his criminal enterprise.",
    short_term_goals: ["Eliminate rival gangs", "Extort protection money from merchants"],
    long_term_ambitions: ["Become the undisputed crime lord of Rome"],
    resources: { denarii: 15000, gang_members: 50 },
    relationships: {
        "severus_alexander": { entity_id: "severus_alexander", relationship_type: "irrelevance", trust_level: 0, recent_interactions: [] },
        "lycinia_stolo": { entity_id: "lycinia_stolo", relationship_type: "rival", trust_level: -6, recent_interactions: [] }
    },
    visibility_network: ["praetorian_guard", "lycinia_stolo"],
    memories: [],
};
// Task 4 of the actors-attribution refactor: interchange-shaped ({text,
// actors} headlines, `actors` siblings on entityActions/deltas), hand-
// attributed VERBATIM per task-4-design.md's hand-attribution table -
// fixture defaults are NOT semantically reliable, so each entry below is
// attributed by reading what the prose actually narrates, not copied from
// whichever identity slot happens to sit nearest it.
const MOCK_ADJUDICATION: AdjudicationInterchange = {
  turn: 1,
  entityActions: [
    {
      id: "maximinus_thrax",
      intent: "propaganda",
      target: null,
      notes: "Maximinus Thrax spreads rumors about the Emperor's weakness, boosting his own standing with the troops.",
      actors: ['maximinus_thrax'],
    },
     {
      id: "severus_alexander",
      intent: "appease_troops",
      target: "praetorian_guard",
      // Names the actor by proper name, not by title (E2): "the Emperor" as
      // acting subject collides with ANY test player who happens to hold
      // that title (e.g. a fixture whose default position is 'Emperor'),
      // making this canned prose read as inventing THEIR conduct on a
      // no-attempt turn. Severus Alexander is precisely who this
      // entityAction is about; naming him removes the accidental title
      // collision without weakening the boundary - a REAL adjudicator still
      // fails closed if it emits "the Emperor attempts..." while the actual
      // player holds that title (see ai/core/playerBoundary.ts).
      notes: "Severus Alexander attempts to shore up support with the Praetorians by promising a donative.",
      actors: ['severus_alexander'],
    },
  ],
  deltas: [
    { type: 'resource', key: 'maximinus_thrax:legion_support', delta: 2, reason: 'Successful propaganda campaign.', actors: ['maximinus_thrax'] },
    // The slanderer acts; Severus merely suffers the slander.
    { type: 'relation', key: 'severus_alexander:maximinus_thrax', delta: -1, reason: 'Slandered by military propaganda.', actors: ['maximinus_thrax'] },
    // Rumor deltas carry the GM-private truth-ledger fields (D11): the
    // adjudicator rules on every rumor's actual truth and names its origin
    // when attributable - here, a lie planted by Thrax's propaganda. The
    // NON-private 'topic' (D29) keeps this claim distinct from any other
    // rumor about the Emperor. The claim itself reports a rumored
    // deliberation - cognition, no accomplished act - so `actors` stays
    // empty; `origin_id` remains the mechanical owner (Thrax).
    { type: 'rumor', key: 'severus_alexander', delta: 0.6, reason: 'The Emperor is said to be considering a peaceful tribute to the Germans, angering the legions.', is_true: false, origin_id: 'maximinus_thrax', topic: 'german-tribute', actors: [] },
    { type: 'relation', key: 'severus_alexander:praetorian_guard', delta: 1, reason: 'Promised a donative.', actors: ['severus_alexander'] },
    // Pure description of a priestly ritual - no named agent's act.
    { type: 'add_region', key: 'Temple of Jupiter', delta: 0, reason: '{"stability":"Stable","controlling_faction":null,"current_events":["Priests conduct rituals to placate the gods amidst the political turmoil."]}', actors: [] },
    // Demonstrates the structured status-delta contract (MAINT-P0.2): 'reason'
    // is narrative-only, 'new_location' is the authoritative field the engine
    // acts on. See ai/core/engine.ts's 'status' case.
    { type: 'status', key: 'gaius_pontius_magnus', delta: 0, reason: "Fearing the Praetorians' wavering loyalty, the Senator quietly withdraws to his estate to avoid becoming a target.", new_location: 'The Suburra', actors: ['gaius_pontius_magnus'] },
  ],
  headlines: [
    // World description; no named agent in-text.
    { text: "Discontent grows in the Praetorian Camp as rumors of imperial weakness spread.", actors: [] },
    // LOAD-BEARING: closes the mock-mode B7 gap for any severus player whose
    // aliases don't include 'Emperor' (the shipped preset's position IS
    // 'Emperor', so today only the tripwire catches it - an alias
    // coincidence, not a contract). See tests/turnActorsGate.test.ts.
    { text: "Emperor promises bonus to Praetorian Guard.", actors: ['severus_alexander'] },
  ],
  gm_private: ["The Praetorian Guard's loyalty is wavering more than publicly known.", "Lycinia Stolo's network has been compromised. She is no longer a major player and is being replaced by the more aggressive Flavius Fulco."],
  // Cast: zEntity's zod-inferred output type (passthrough index signature,
  // nullable nested records) structurally differs from types.ts's plain
  // `Entity` the same nullable-vs-optional/passthrough gap
  // ai/core/actorsBoundary.ts's own stripActorsFromAdjudication doc comment
  // already documents for EventDelta/EntityAction. MOCK_NEW_MOBSTER is a
  // real, valid Entity; only the TS shape of the zod inference differs.
  add_entities: [MOCK_NEW_MOBSTER] as unknown as AdjudicationInterchange['add_entities'],
  remove_entities: ['lycinia_stolo']
};

const MOCK_NEW_CHARACTER: Entity = {
    entity_id: "lucius_vorenus",
    name: "Lucius Vorenus",
    entity_type: "individual",
    status: "alive",
    position: "Veteran Centurion",
    voice: "terse parade-ground Latin; oaths kept, words rationed",
    epithet: "Old Parthica",
    location: "The Suburra",
    personality: { ambition: 4, paranoia: 6, loyalty: 8, cunning: 5, honor: 9 },
    beliefs: ["The old ways are the best ways.", "A soldier's loyalty is to his legion, then to Rome."],
    secrets: ["Witnessed corruption by a Senator on a past campaign.", "Worries he is no longer fit for the battlefield."],
    skills: { oratory: 4, administration: 3, strategy: 8, intrigue: 2 },
    active_scheme: {
        name: "A Soldier's Honor",
        overall_goal: "Find a worthy leader to restore honor to the military.",
        steps: [
            { objective: "Re-establish contact with old comrades.", status: 'in_progress' },
            { objective: "Assess the worthy and unworthy leaders of Rome.", status: 'in_progress' },
        ]
    },
    current_state_narrative: "A hardened veteran of the Legio II Parthica, Lucius Vorenus is disgusted by the corruption he sees in Rome. Loyal to the old ways, he believes only a strong, honorable leader can save the Empire from itself. He has a small following of loyal legionaries.",
    short_term_goals: ["Re-establish contact with old comrades", "Assess the political situation"],
    long_term_ambitions: ["Restore honor to the military", "Find a worthy leader to serve"],
    resources: { denarii: 5000, deep_analyses: 2, investigations: 3 },
    relationships: {
        "severus_alexander": { entity_id: "severus_alexander", relationship_type: "contempt", trust_level: -5, recent_interactions: [] },
        "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "cautious respect", trust_level: 3, recent_interactions: [] },
        "praetorian_guard": { entity_id: "praetorian_guard", relationship_type: "distrust", trust_level: -4, recent_interactions: [] },
        "roman_senate": { entity_id: "roman_senate", relationship_type: "indifference", trust_level: 0, recent_interactions: [] },
        "julia_mamaea": { entity_id: "julia_mamaea", relationship_type: "distrust", trust_level: -2, recent_interactions: [] },
        "senatorial_party": { entity_id: "senatorial_party", relationship_type: "political rival", trust_level: -1, recent_interactions: [] },
        "military_cabal": { entity_id: "military_cabal", relationship_type: "potential ally", trust_level: 2, recent_interactions: [] }
    },
    visibility_network: ["severus_alexander", "maximinus_thrax", "praetorian_guard"],
    memories: [],
    // D49: a created character's ties, one worn openly and one kept - the
    // soldiers' mystery of Mithras met underground.
    affiliations: [
        { id: "veterans_of_the_second_parthica", name: "the veterans of the Second Parthica", kind: "cause", public: true },
        { id: "mysteries_of_mithras", name: "the mysteries of Mithras", kind: "cult", public: false },
    ],
};

const MOCK_CUSTOM_WORLD_STATE: WorldState = {
    year: 122, week: 1, economic_stability: 'Failing', political_climate: 'Oppressive',
    regions: {
        'Eboracum Fortress': { stability: 'Stable', controlling_faction: 'legio_ix_hispana', current_events: ["The Ninth Legion holds the northern frontier against unknown horrors."] },
        'Isurium Brigantum': { stability: 'Unrest', controlling_faction: 'brigantes_tribe', current_events: ["The Brigantes chieftains whisper of ancient pacts and sacrifices."] },
        'Misty Moors': { stability: 'Hostile', controlling_faction: null, current_events: ["Strange beasts and whispers of ancient magic plague the moors."] }
    }
};

const MOCK_CUSTOM_ENTITIES: Entity[] = [
    {
      entity_id: "legatus_draco", name: "Legatus Draco", entity_type: "individual", status: "alive", position: "Commander of the Ninth Legion", location: "Eboracum Fortress",
      voice: "clipped command Latin worn thin by fog and losses",
      epithet: "the Dragon of Eboracum",
      short_term_goals: ["Suppress local cults", "Maintain discipline"], long_term_ambitions: ["Survive the winter"],
      current_state_narrative: "A grim, pragmatic commander haunted by the disappearance of patrols in the moors.",
      relationships: { "mock_player_character": { entity_id: "mock_player_character", relationship_type: "subordinate", trust_level: 5, recent_interactions: [] } },
      memories: [], resources: { legionary_support: 70 }, visibility_network: []
    },
    {
      entity_id: "morwen", name: "Morwen", entity_type: "individual", status: "alive", position: "Priestess of the Old Gods", location: "Misty Moors",
      voice: "lilting oracular cadence; speaks in omens, never plainly",
      epithet: "the Moor-Witch",
      short_term_goals: ["Drive the Romans out"], long_term_ambitions: ["Awaken a slumbering horror"],
      current_state_narrative: "A mysterious figure who commands the loyalty of the local tribes and seems to wield strange powers.",
      relationships: { "mock_player_character": { entity_id: "mock_player_character", relationship_type: "enemy", trust_level: -8, recent_interactions: [] } },
      memories: [], resources: { cultist_followers: 100 }, visibility_network: []
    },
];

const MOCK_PLAYER_IN_CUSTOM_WORLD: Entity = {
    entity_id: "mock_player_character",
    name: "Gaius Vibius",
    entity_type: "individual",
    status: "alive",
    position: "Inquisitor and Exorcist",
    voice: "measured inquisitor's Latin; liturgical certainty over doubt",
    epithet: "the Lantern-Bearer",
    location: "Eboracum Fortress",
    personality: { ambition: 5, paranoia: 8, loyalty: 7, cunning: 6, honor: 6 },
    beliefs: ["The darkness must be fought with iron and faith.", "There are truths man was not meant to know."],
    secrets: ["Haunted by a past failure where he condemned an innocent soul."],
    skills: { oratory: 5, administration: 4, strategy: 6, intrigue: 8 },
    active_scheme: {
        name: "Purge the North",
        overall_goal: "Uncover and destroy the source of the supernatural corruption in Britannia.",
        steps: [{ objective: "Investigate the Misty Moors.", status: 'in_progress' }]
    },
    current_state_narrative: "You are an Inquisitor, sent from Rome to investigate supernatural occurrences on the Britannian frontier. You are a man of faith and steel, but what you find here may test both.",
    short_term_goals: ["Investigate the Misty Moors"],
    long_term_ambitions: ["Destroy the source of the corruption"],
    resources: { denarii: 2000, deep_analyses: 3, investigations: 4 },
    relationships: {
        "legatus_draco": { entity_id: "legatus_draco", relationship_type: "ally", trust_level: 5, recent_interactions: [] },
        "morwen": { entity_id: "morwen", relationship_type: "nemesis", trust_level: -8, recent_interactions: [] }
    },
    visibility_network: ["legatus_draco", "morwen"],
    memories: [],
};


// --- MOCK FUNCTIONS ---

export const mockGenerateScenarioStructure = async (metaNarrative: string, playerCharacterDescription: string): Promise<{ worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[] }> => {
    void metaNarrative;
    void playerCharacterDescription;
    console.log("--- MOCK SCENARIO STRUCTURE GENERATION ---");
    const playerStub: EntityStub = {
        entity_id: 'mock_player_character',
        name: 'Gaius Vibius',
        entity_type: 'individual',
        position: 'Inquisitor',
        brief_description: 'An inquisitor sent to Britannia.'
    };
    
    const npcStubs: EntityStub[] = [
        {
            entity_id: 'legatus_draco',
            name: 'Legatus Draco',
            entity_type: 'individual',
            position: 'Legion Commander',
            brief_description: 'Commander of the Ninth Legion.'
        },
         {
            entity_id: 'morwen',
            name: 'Morwen',
            entity_type: 'individual',
            position: 'Priestess',
            brief_description: 'Priestess of the Old Gods.'
        }
    ];

    return {
        worldState: MOCK_CUSTOM_WORLD_STATE,
        playerStub,
        npcStubs
    };
}

export const mockGenerateEntitiesDetails = async (worldState: WorldState, playerStub: EntityStub, npcStubs: EntityStub[]): Promise<Entity[]> => {
    void worldState;
    void playerStub;
    void npcStubs;
    console.log("--- MOCK ENTITY DETAILS GENERATION ---");
    // Return the pre-defined mock entities which match the stubs
    return [...MOCK_CUSTOM_ENTITIES, MOCK_PLAYER_IN_CUSTOM_WORLD];
}

// Deprecated in favor of the 2-step process, but kept for compatibility if needed.
export const mockInitiateWorld = async (metaNarrative: string, playerCharacterDescription: string): Promise<{ worldState: WorldState, entities: Entity[], playerCharacterId: string }> => {
    console.log("--- MOCK WORLD INITIATION (LEGACY) ---");
    const structure = await mockGenerateScenarioStructure(metaNarrative, playerCharacterDescription);
    const entities = await mockGenerateEntitiesDetails(structure.worldState, structure.playerStub, structure.npcStubs);
    return {
        worldState: structure.worldState,
        entities,
        playerCharacterId: structure.playerStub.entity_id,
    };
};

/**
 * What a boundary-compliant provider returns on a no-attempt turn: the same
 * world-driven canned content minus everything the canned content authors
 * for the ACTUAL `playerEntity` of this call. The exported real-path gates
 * below then VERIFY it, exactly as ai/core/turn.ts verifies model output.
 *
 * PLAYER-RELATIVE, not hardcoded: an earlier version matched the literal
 * string 'severus_alexander' (the standard scenario's player), which stripped
 * legitimate third-party NPC activity whenever a DIFFERENT entity was
 * playing - severus_alexander's canned entityAction is ordinary world
 * activity from some other player's perspective.
 *
 * THE CONTRACT IS AN INVARIANT, NOT A LIST OF SURFACES: remove everything the
 * actual player OWNS, on every STRUCTURAL surface the mechanics gate
 * examines (entityActions by id, deltas by ownership, remove_entities). An
 * earlier version enumerated three surfaces (entityActions by id, 'relation'
 * deltas by key root, headlines) and missed three more the canned
 * MOCK_ADJUDICATION authors - a 'resource' delta keyed maximinus_thrax, a
 * 'status' delta keyed gaius_pontius_magnus, and
 * `remove_entities: ['lycinia_stolo']`. Because `playerOwnsDelta` matches the
 * key root for EVERY delta type and `valueRemovesPlayer` matches
 * `remove_entities`, every no-attempt turn threw for three of the four shipped
 * presets; Mock Mode is a production-visible toggle (components/Header.tsx),
 * so that was user-reachable and deterministic.
 *
 * HEADLINES ARE DELIBERATELY NOT PROJECTED HERE (Task 4): they are prose, not
 * a structural identity slot `assertNoInventedPlayerAction` ever examines, so
 * a declared-player headline is left for `redactInventedPlayerProse`
 * (declaration-aware, gate-before-strip - see mockRunNewTurn below) to redact
 * and record as an auditable `[Boundary]` gm_private note, exactly like the
 * real pipeline. Pre-filtering them here would silently drop them with no
 * record and, worse, would have to run a tripwire scan over the WHOLE
 * `{text, actors}` headline object (including the `actors` array of bare
 * entity ids) rather than the declaration-aware per-field gate.
 *
 * Ownership is decided by playerBoundary.ts's OWN exported predicates
 * (`playerOwnsDelta`, `samePlayerIdentity`), never a local copy - a second
 * definition here is precisely how the projection and the gate came to
 * disagree.
 */
function projectMockAdjudicationForNoAttempt(adjudication: AdjudicationInterchange, playerEntity: Entity, roster: readonly Entity[]): AdjudicationInterchange {
  return {
    ...adjudication,
    entityActions: adjudication.entityActions.filter(action => !samePlayerIdentity(action.id, playerEntity)),
    // playerOwnsDelta's declared param is the committed EventDelta shape;
    // the interchange delta carries every field it reads (type/key/
    // origin_id) plus the extra `actors` sibling and zod's nullable-vs-
    // optional gap on new_status/is_true/origin_id/topic/stance (documented
    // on ai/core/actorsBoundary.ts's stripActorsFromEventDelta) - a runtime
    // no-op cast, not a behavior change.
    deltas: adjudication.deltas.filter(delta => !playerOwnsDelta(delta as unknown as EventDelta, playerEntity, roster)),
    remove_entities: adjudication.remove_entities?.filter(id => !samePlayerIdentity(id, playerEntity)),
  };
}

/**
 * The canned narration's quote of the player's observable attempt, built
 * from the player-safe history projection: recipients appear by display
 * name only, never as "Name [entity_id]" (the model-facing resolution
 * form). Canned play ships to keyless players, so this is player-facing
 * text.
 */
function quoteObservableAttemptForPlayer(submission: TurnSubmission): string {
    const history = projectForPlayerHistory(submission);
    if (history.kind === 'freeform') return history.text ?? '';
    return [
        ...(history.actions ?? []),
        ...(history.messagesOrOrders ?? []).map(({ recipient, command }) => `To: ${recipient}\n${command}`),
    ].join('\n\n');
}

export const mockRunNewTurn = async (
    submission: TurnSubmission | string,
    playerEntity: Entity,
    turnNumber: number,
    currentEntities: Entity[],
    currentWorldState: WorldState,
    currentReports: Report[],
    gmInterventionText: string,
    metaNarrative: string,
    currentSimulationState: SimulationState,
    currentTruthLedger: TruthLedgerEntry[] = [],
    currentNpcIntents: NpcIntent[] = [],
    privateSceneAdjudicatorProjection?: PrivateSceneAdjudicatorProjection,
    privateSceneNpcMemoriesByNpcId?: Readonly<Record<string, readonly PrivateSceneNpcMemoryProjection[]>>,
): Promise<{
    updatedEntities: Entity[],
    updatedWorldState: WorldState,
    updatedSimulationState: SimulationState,
    updatedReports: Report[],
    updatedTruthLedger: TruthLedgerEntry[],
    updatedNpcIntents: NpcIntent[],
    narration: string,
    headlines: string[],
    suggestedActions: string[],
    playerMonologue: string,
    newHistoryEntry: TurnHistoryEntry,
}> => {
    const normalizedSubmission = normalizeTurnSubmissionInput(submission);
    const noAttemptResponse = projectForNoAttemptResponse(normalizedSubmission);
    const playerIntent = serializeTurnSubmission(normalizedSubmission);
    const playerReflectionContext = projectForPlayerReflection(normalizedSubmission);
    const observableAttempt = projectForResolution(normalizedSubmission);
    void privateSceneAdjudicatorProjection;
    console.log("--- MOCK TURN RUN ---");
    console.log("GM Intervention Text:", gmInterventionText);
    console.log("Meta Narrative:", metaNarrative);

    // Mock Director (4C.3): the previous turn's intents feed the continuity
    // ruling, and this turn's intents flow out through updatedNpcIntents +
    // the history entry - the same loop the real pipeline runs.
    const storyRelevance = await mockGetStoryRelevance(turnNumber, currentNpcIntents);

    // Mock minds (4C.4): one decision per mock spotlight that resolves to a
    // living, non-player roster entity, bounded like the real pipeline
    // (selectMindEntities in ai/core/turn.ts) - so the mind -> adjudicator
    // loop runs offline end-to-end and the GM console's Mind Decisions view
    // has real data in mock mode.
    const mindDecisions: NpcMindDecision[] = [];
    for (const spotlight of storyRelevance.spotlight_entities) {
        if (mindDecisions.length >= MAX_MINDS_PER_TURN) break;
        const mindEntity = currentEntities.find(e => e.entity_id === spotlight.entity_id && e.status === 'alive');
        if (!mindEntity || mindEntity.entity_id === playerEntity.entity_id) continue;
        mindDecisions.push(await mockGetNpcMindDecision(
            mindEntity,
            storyRelevance.spotlight_intents.find(i => i.entity_id === spotlight.entity_id),
            privateSceneNpcMemoriesByNpcId?.[mindEntity.entity_id],
        ));
    }

    // Player-planted rumor (D19 "lies in play", adjudication contract): the
    // mock turn must exercise the planting path offline - origin_id MUST be
    // the player's own entity_id and is_true false, so the truth ledger
    // records player authorship and the Report channel feeds the knowledge
    // store. Built per-call (not in MOCK_ADJUDICATION) because the player's
    // entity_id is only known here. The 'reason' text must read like any
    // other rumor: player-visible wording never marks a rumor as planted or
    // reveals its truth (D11).
    const playerPlantedRumor: EventDeltaInterchange = {
        type: 'rumor',
        key: 'maximinus_thrax',
        delta: 0.5,
        reason: 'Word in the taverns holds that Maximinus Thrax has been skimming the legions\' pay for himself.',
        is_true: false,
        origin_id: playerEntity.entity_id,
        // NON-private D29 topic: the matter this rumor concerns, so it keys as
        // its own knowledge claim distinct from other talk about Thrax.
        topic: 'legion-pay',
        // The claim narrates Thrax's act (hand-attribution table,
        // task-4-design.md).
        actors: ['maximinus_thrax'],
    };
    const adjudication: AdjudicationInterchange = {
        ...MOCK_ADJUDICATION,
        turn: turnNumber,
        deltas: observableAttempt
            ? [...MOCK_ADJUDICATION.deltas, playerPlantedRumor]
            : [...MOCK_ADJUDICATION.deltas],
        // FRESH array, never the shared MOCK_ADJUDICATION.gm_private - the
        // pushes below (and this pacing note) must not accumulate onto the
        // module constant across turns. The mock adjudicator records its
        // D23 pacing judgment every turn (ROADMAP_PHASE_4.md 4D item 1),
        // default posture non-intervention, so the "[Pacing]" -> GM console
        // loop is visible offline.
        gm_private: [
            ...MOCK_ADJUDICATION.gm_private,
            '[Pacing] Letting the week breathe - the standing schemes are generating pressure on their own; no intervention needed.',
        ],
    };

    // Real-path boundary gates (E2): the mock previously never ran these,
    // the exact hole that hid a P0 - a compliant provider's no-attempt
    // response is projected here and the SAME gates ai/core/turn.ts runs on
    // real model output verify it, so a canned identity collision (e.g.
    // gaius_pontius_magnus's status delta) still throws in parity with the
    // real pipeline.
    //
    // D42 (gate-before-strip; roadmaps/DESIGN_DECISIONS.md): the mock mirrors
    // the real pipeline's exact order - project -> assertNoInventedPlayerAction
    // -> redactInventedPlayerProse (declaration-aware, on the INTERCHANGE,
    // before actors is stripped) -> assertPlayerVisibleAdjudicationSafe ->
    // stripActorsFromAdjudication -> applyAdjudication/history. All three
    // gates accept the `AdjudicationInterchange | Adjudication` union
    // directly (playerBoundary.ts), so no reshaping cast is needed here.
    const hasObservableAttempt = observableAttempt !== null;
    const gatedAdjudication = hasObservableAttempt ? adjudication : projectMockAdjudicationForNoAttempt(adjudication, playerEntity, currentEntities);
    // Same consequence split as ai/core/turn.ts::enforceNoAttemptBoundary:
    // structural violations throw, prose is redacted and recorded GM-side.
    assertNoInventedPlayerAction(gatedAdjudication, playerEntity, hasObservableAttempt, currentEntities);
    gatedAdjudication.gm_private.push(...playerProseRedactionNotes(
        redactInventedPlayerProse(gatedAdjudication, playerEntity, hasObservableAttempt),
    ));
    assertPlayerVisibleAdjudicationSafe(gatedAdjudication);
    // Commit boundary for this surface (D42): strip the interchange-only
    // `actors` now that the declaration-aware gate has seen it. `gm_private`
    // is the SAME array reference before and after (a shallow spread), so
    // every push above and below lands on the one committed array.
    const strippedAdjudication = stripActorsFromAdjudication(gatedAdjudication);

    // Same perception context the real pipeline passes (ai/core/turn.ts):
    // the player is excluded from the NPC memory loop, and the mock
    // Director's spotlight pair stands in as the spotlight cast.
    const appliedAdjudication = applyAdjudication(strippedAdjudication, currentEntities, currentWorldState, currentReports, currentTruthLedger, {
        playerEntityId: playerEntity.entity_id,
        spotlightIds: storyRelevance.spotlight_entities.map(s => s.entity_id),
        turnNumber,
    });
    const { updatedEntities, updatedWorldState } = appliedAdjudication;
    const { updatedReports, updatedTruthLedger, perceivingNpcIds } = appliedAdjudication;

    // Task 4: narration/monologue become structured {text, actors} payloads,
    // mirroring the real pipeline's switch to structured output. Declared
    // ONLY on an observable-attempt turn (built only when observableAttempt
    // is non-null), where the gate is inert regardless - attribution
    // faithful either way (task-4-design.md's mock-mirror design): this
    // narrates the player's own submitted action and Thrax's stirring.
    const isThrax = playerEntity.entity_id === 'maximinus_thrax';
    const denarii = typeof playerEntity.resources?.denarii === 'number' ? playerEntity.resources.denarii : 0;
    const isBroke = denarii <= 0;
    // The chronicle quotes the player's action as the player wrote it:
    // recipients by display name (the player-safe history projection), never
    // the "Name [entity_id]" form the resolution projection feeds a model.
    // Only the observable part is quoted - private intent and questions are
    // not the action being noted.
    const quotedAttempt = quoteObservableAttemptForPlayer(normalizedSubmission);

    const narrationPayload = noAttemptResponse
        ? { text: '', actors: [] as string[] }
        : isThrax
            ? {
                text: `(Mock Mode) Your action to "${quotedAttempt}" has been noted. Across Rome, your frontier legions hold their ground as whisperers carry word of the boy emperor's panic. The Senate trembles at your advance.`,
                actors: [playerEntity.entity_id, 'severus_alexander', 'roman_senate'],
            }
            : {
                text: `(Mock Mode) Your action to "${quotedAttempt}" has been noted. In the city, Maximinus Thrax continues to stir up trouble, spreading rumors about the Emperor's weakness. The mood in the Praetorian Camp grows darker.`,
                actors: [playerEntity.entity_id, 'maximinus_thrax'],
            };

    const suggestedActions = noAttemptResponse
        ? [
            'Consider your next move carefully.',
            'Consolidate your power.',
            'Seek new allies.',
        ]
        : isThrax
            ? [
                'Mock: Rally the frontier legions',
                'Mock: Demand concessions from the Senate',
                'Mock: Intimidate the Praetorian envoys',
            ]
            : isBroke
                ? [
                    'Mock: Rally loyal followers',
                    'Mock: Send a message to the Senate',
                    'Mock: Assert political authority',
                ]
                : [
                    "Mock: Investigate Thrax's rumors",
                    'Mock: Send a message to the Senate',
                    'Mock: Try to bribe the Praetorians',
                ];

    const monologuePayload = noAttemptResponse
        ? { text: '', actors: [] as string[] }
        : await mockGetPlayerMonologue(playerEntity, MOCK_ADJUDICATION.headlines.map(headline => headline.text), [playerReflectionContext]);

    // Durable-intent filter parity (E2): commit only intents that survive
    // selectDurableIntents' spotlight+alive+dedupe gate (ai/core/turn.ts),
    // instead of the raw, unfiltered Director output - so a spotlighted
    // entity absent from (or dead in) the current roster never persists a
    // phantom intent.
    const durableIntents = selectDurableIntents(storyRelevance, currentEntities, playerEntity.entity_id);

    // Visible-surface gates (E2): the same redact-or-throw wiring the real
    // pipeline runs on updatedSimulationState/narration/playerMonologue
    // (ai/core/turn.ts) - a removal claim naming the player throws, prose is
    // redacted and recorded GM-side. Deliberately excluded:
    // assertPlayerVisibleTextSafe/assertPlayerVisibleValueSafe on narration/
    // monologue, because mock narration embeds the player's own echoed
    // submission text rather than provider output; the mechanics boundary is
    // covered on the adjudication via assertPlayerVisibleAdjudicationSafe above.
    for (const value of [currentSimulationState, narrationPayload.text, monologuePayload.text]) {
        assertNoPlayerRemoval(value, playerEntity, hasObservableAttempt);
    }
    // The simulation-state gate stays 4-arg/tripwire-only (task-4-design.md
    // section 4): mock sim state has no provider and therefore no
    // declaration, so a synthesized empty declaration is deliberately NOT
    // used here - this preserves the pinned mockParity crisis-redaction
    // behavior over the whole object.
    const simulationRedaction = redactInventedPlayerProseFromValue(
        currentSimulationState, playerEntity, hasObservableAttempt, 'simulationState');
    const narrationRedaction = redactInventedPlayerProseFromValue(
        narrationPayload.text, playerEntity, hasObservableAttempt, 'narration', narrationPayload.actors);
    const monologueRedaction = redactInventedPlayerProseFromValue(
        monologuePayload.text, playerEntity, hasObservableAttempt, 'monologue', monologuePayload.actors);
    strippedAdjudication.gm_private.push(...playerProseRedactionNotes([
        ...simulationRedaction.redactions,
        ...narrationRedaction.redactions,
        ...monologueRedaction.redactions,
    ]));

    const newHistoryEntry: TurnHistoryEntry = {
        turnNumber,
        playerIntent,
        adjudication: strippedAdjudication,
        narration: narrationRedaction.value,
        // Parity with ai/core/turn.ts: always set, `''` included (D44).
        playerMonologue: monologueRedaction.value,
        postTurnEntities: updatedEntities,
        perceivingNpcIds,
        npcIntents: durableIntents.length > 0 ? durableIntents : undefined,
        npcMindResults: mindDecisions.length > 0 ? mindDecisions : undefined,
    };

    return {
        updatedEntities,
        updatedWorldState,
        updatedSimulationState: simulationRedaction.value,
        updatedReports,
        updatedTruthLedger,
        updatedNpcIntents: durableIntents,
        narration: narrationRedaction.value,
        headlines: strippedAdjudication.headlines,
        suggestedActions,
        playerMonologue: monologueRedaction.value,
        newHistoryEntry,
    };
};

export const mockCreateCharacter = async (description: string): Promise<Entity> => {
    console.log("--- MOCK CHARACTER CREATION ---");
    if(!MOCK_NEW_CHARACTER) throw new Error("Mock for MOCK_NEW_CHARACTER does not exist");
    return { ...MOCK_NEW_CHARACTER, current_state_narrative: `(Mock Character) Based on your description: "${description}", this character was generated.` };
};

export const mockGetClarificationOnEvent = async (event: string, question: string): Promise<string> => {
    void question;
    console.log("--- MOCK CLARIFICATION ---");
    return `(Mock) Regarding "${event}", the general consensus is that it was orchestrated by a rival faction to sow discord. The motives seem purely political.`;
};

// --- D47 grounded intelligence, provider-free -------------------------------
//
// The mock investigation family runs the SAME code-side path as the real one
// (ai/tools/intelligence.ts): the same three rolls, the same ground-truth
// plan (ai/core/groundTruth.ts), the same truth-ledger entries - only the
// prose is canned instead of written by a model. Its generator is seeded
// from the target and the aspect (mockIntelSeed), never Math.random, so an
// offline run lands the same way every time.

/**
 * The deterministic seed a provider-free investigation rolls from: a 32-bit
 * FNV-1a hash of the target and the aspect, so the same question about the
 * same figure always lands the same way offline.
 */
export function mockIntelSeed(targetId: string, kind: string): number {
    let hash = 0x811c9dc5;
    for (const char of `${targetId}:${kind}`) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** Canned false findings - what a misled agent brings back offline. Chosen to be true of no one in the shipped cast. */
const MOCK_FALSE_FINDINGS: Record<GroundTruthKind, string[]> = {
    beliefs: [
        'Believes the gods have abandoned Rome.',
        'Holds that the grain dole ruins the plebs.',
        'Thinks the eastern frontier matters more than the Rhine.',
    ],
    secrets: [
        'Keeps a second household at Ostia under a false name.',
        'Owes a fortune to a Syrian moneylender.',
        'Consults a Chaldean astrologer before every decision.',
    ],
    scheme: ['Coin is quietly moving toward the eastern ports.'],
    deep_analysis: [
        'Has been seen dining with a Parthian envoy.',
        'Keeps a band of Illyrian bodyguards on retainer.',
        'Has lately sold a family estate for ready coin.',
    ],
};

function withoutFinalStop(text: string): string {
    return text.trim().replace(/[.!?]+$/, '');
}

/** The canned account of one planned finding: the truth as reached, the truth with its one distortion, or a canned falsehood. */
function mockFindingText(finding: PlannedFinding, index: number, kind: GroundTruthKind): string {
    if (finding.truth === null) {
        const canned = MOCK_FALSE_FINDINGS[kind];
        return canned[index % canned.length];
    }
    const told = finding.fragmentary ? `…${finding.truth}…` : finding.truth;
    if (finding.standing === 'garbled') {
        return finding.distortion === 'misattributed'
            ? `Said of a freedman of the household: ${told}`
            : `${withoutFinalStop(told)}, at Ostia.`;
    }
    return told;
}

export const mockGetDeepAnalysis = async (target: Entity, plan: InvestigationPlan): Promise<string> => {
    console.log("--- MOCK DEEP ANALYSIS ---");
    if (plan.findings.length === 0) {
        return `(Mock Analysis) Our agents could establish nothing about ${target.name} beyond what is public. An unknown quantity, for now.`;
    }
    const facts = plan.findings.map((finding, i) => `${withoutFinalStop(mockFindingText(finding, i, 'deep_analysis'))}.`);
    return `(Mock Analysis) Our agents report on ${target.name}: ${facts.join(' ')} They pose a threat worth watching.`;
};

/**
 * The canned nature reading (D28/D47): the true design when the clues earned
 * it, the design with one element misread when they earned half of it, and a
 * canned false design when they were a false trail.
 */
export const mockGetSchemeNatureReading = async (target: Entity, plan: SchemeNaturePlan): Promise<string> => {
    console.log("--- MOCK SCHEME NATURE ---");
    if (plan.noDesign) return `(Mock) Your agents read the threads as nothing at all: ${target.name} is plotting nothing of note.`;
    if (!plan.design) return `(Mock) Your agents read the threads as one design: ${target.name} means to buy up the grain fleet and starve the Palatine into terms.`;
    const goal = withoutFinalStop(plan.design.goal);
    return plan.standing === 'garbled'
        ? `(Mock) Your agents read the threads as one design: ${goal}, by way of the grain fleet.`
        : `(Mock) Your agents read the threads as one design: ${goal}.`;
};

export const mockGetInvestigationResult = async (target: Entity, isRisky: boolean, subject: 'secrets' | 'beliefs' | 'scheme', plan: InvestigationPlan): Promise<{ report: string, consequences: string | null, reportData: string[] }> => {
    console.log("--- MOCK INVESTIGATION ---");

    // D47: the itemised findings follow the plan, one per planned finding -
    // the truth as reached, the one recorded distortion, or a canned
    // falsehood. The narrative report carries no claim of its own (every
    // claim offline is an itemised finding the ledger can flag), and the
    // consequence line stays canned: the tier's consequences contract is
    // enforced on a MODEL's output (ai/tools/intelligence.ts); offline, a
    // risky visit is always noticed.
    const reportData = plan.findings.map((finding, i) => `(Mock) ${mockFindingText(finding, i, subject)}`);
    let reportText: string;

    if (reportData.length === 0) {
        // Reached truthfully, and there was nothing of the kind to find.
        reportText = `(Mock) Your agents looked into ${target.name}'s ${subject} and found nothing worth the name.`;
    } else switch(subject) {
        case 'beliefs':
            reportText = `(Mock) Your agents bring back word of what ${target.name} holds true.`;
            break;
        case 'scheme':
            // D28: a scheme investigation returns ONE clue, never the whole
            // plot. The report is discarded below the reveal; the nature is
            // read from the accumulated clues (mockGetSchemeNatureReading).
            reportText = `(Mock) Your agents bring back another thread of ${target.name}'s design.`;
            break;
        case 'secrets':
        default:
             reportText = `(Mock) Your agents bring back word of what ${target.name} would keep hidden.`;
             break;
    }

    if (isRisky) {
        return {
            reportData,
            report: reportText,
            consequences: "One of your agents was seen near the target's villa and is now being watched, reducing their effectiveness."
        };
    }
    return {
        reportData,
        report: reportText,
        consequences: null
    };
};

/**
 * Task 4: returns the structured `{ text, actors }` payload the real
 * `getPlayerMonologue` (ai/tools/intelligence.ts) now returns. `actors: []`
 * is faithful, not a placeholder - this is the player's own pure interior
 * cognition (task-4-design.md's mock-mirror design), never an authored act.
 */
export const mockGetPlayerMonologue = async (player: Entity, turnHeadlines: string[], recentPlayerIntents: string[]): Promise<{ text: string; actors: string[] }> => {
    console.log("--- MOCK PLAYER MONOLOGUE ---");
    const recentActionsSummary = recentPlayerIntents.length > 0 ? `my recent actions (${recentPlayerIntents.join('; ')})` : `my inaction`;
    const text = `(Mock Monologue) These events... (${turnHeadlines.join(', ')}). Considering ${recentActionsSummary}, a pattern emerges. This plays directly into my hands. If I'm careful, I can use this chaos to my advantage. But I must watch for vipers in the grass.`;
    return { text, actors: [] };
};


/** The mock Director's fixed one-line intents for the mock spotlight pair (4C.3). */
const MOCK_SPOTLIGHT_INTENTS: Record<string, string> = {
    maximinus_thrax: 'Turn the legions against the Emperor with a whisper campaign about his weakness.',
    praetorian_guard: 'Extract the promised donative before pledging their swords to anyone.',
};

/** Canned mind decisions for the mock spotlight pair (4C.4) - fixed so the offline loop is deterministic and inspectable in the GM console. */
const MOCK_MIND_DECISIONS: Record<string, Omit<NpcMindDecision, 'entity_id'>> = {
    maximinus_thrax: {
        chosen_action: '(Mock) Dispatch trusted centurions through the camps at night to swear the wavering cohorts to my cause.',
        method: '(Mock) Oaths over wine, sweetened with promises of double pay under a soldier-emperor.',
        private_reasoning: '(Mock) The boy-emperor buys loyalty he cannot keep. Every denarius he promises the Praetorians is a week I gain to make the legions mine.',
        scheme_adjustment: '(Mock) The whisper campaign has done its work - the scheme advances from rumor to recruitment.',
    },
    praetorian_guard: {
        chosen_action: '(Mock) Send a deputation to the Palatine demanding the promised donative in coin, not words.',
        method: '(Mock) Formal petition by day; quiet talk with Thrax\'s men by night, keeping every option paid for.',
        private_reasoning: '(Mock) Emperors come and go; the Guard endures. Whoever pays first owns our swords this season - and both suitors should believe they are winning us.',
    },
};

/**
 * Mock per-spotlight mind decision (4C.4): fixed canned decisions for the
 * mock spotlight pair, a generic in-character fallback for anyone else -
 * so the mind -> adjudicator loop runs offline end-to-end regardless of
 * roster. GM-private data like the real thing (D4/D5).
 */
export const mockGetNpcMindDecision = async (
    self: Entity,
    directorIntent?: NpcIntent,
    privateSceneMemories: readonly PrivateSceneNpcMemoryProjection[] = [],
): Promise<NpcMindDecision> => {
    void privateSceneMemories;
    console.log(`--- MOCK NPC MIND for ${self.name} ---`);
    const canned = MOCK_MIND_DECISIONS[self.entity_id];
    if (canned) return { entity_id: self.entity_id, ...canned };
    return {
        entity_id: self.entity_id,
        chosen_action: `(Mock) ${self.name} moves carefully to advance their own position this week.`,
        method: '(Mock) Quiet words, quieter coin.',
        private_reasoning: directorIntent
            ? `(Mock) My resolve holds: ${directorIntent.intent}`
            : `(Mock) I keep my own counsel and watch for an opening.`,
    };
};

export const mockGetStoryRelevance = async (turnNumber: number, previousIntents: NpcIntent[] = []): Promise<StoryRelevance> => {
    console.log("--- MOCK STORY RELEVANCE ---");
    // Continuity loop offline (4C.3): an NPC that already held an intent
    // last turn is ruled 'continue', a freshly spotlighted one 'new' - so a
    // mock campaign's second turn exercises the fed-back-in path for real.
    const previousIds = new Set(previousIntents.map(p => p.entity_id));
    const relevance: StoryRelevance = {
        spotlight_entities: [
            { entity_id: 'maximinus_thrax', reason: 'His propaganda is causing instability.' },
            { entity_id: 'praetorian_guard', reason: 'Their loyalty is in question and is a major plot point.' }
        ],
        spotlight_intents: ['maximinus_thrax', 'praetorian_guard'].map(entity_id => ({
            entity_id,
            intent: MOCK_SPOTLIGHT_INTENTS[entity_id],
            continuity: previousIds.has(entity_id) ? 'continue' : 'new',
        })),
        add_entity_suggestion: { description: 'A ruthless Suburra gang leader named Flavius Fulco who sees the chaos as an opportunity.', reason: 'Introduces a criminal element to complicate the political struggle.'},
        remove_entity_suggestion: { entity_id: 'lycinia_stolo', reason: 'Her role as an informant is less critical now that open conflict is brewing.'},
        add_location_suggestion: { name: 'Temple of Jupiter', description: 'The main religious site on the Capitoline Hill.', reason: 'Introduces a religious dimension to the conflict.'},
    };
    return relevance;
};
