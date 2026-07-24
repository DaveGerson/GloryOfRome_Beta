import { describe, expect, it } from 'vitest';
import type { Entity } from '../types';
import {
  MAX_KNOWLEDGE_CLAIMS,
  type KnowledgeClaim,
  type PlayerSafeEvidence,
  type RelationshipObservationDraft,
} from '../knowledge/store';
import {
  buildPlayerSafeEvidence,
  ingestRelationshipObservations,
  isEntityKnownToPlayer,
  knownRecipientOptionsForPlayer,
  relationshipTimelineFor,
  validateRelationshipObservationDrafts,
} from '../knowledge/relationships';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entity_id: 'severus_alexander',
    name: 'Severus Alexander',
    entity_type: 'individual',
    status: 'alive',
    location: 'Rome',
    relationships: {},
    memories: [],
    resources: {},
    visibility_network: [],
    current_state_narrative: '',
    short_term_goals: [],
    long_term_ambitions: [],
    ...overrides,
  };
}

const player = makeEntity({
  faction_id: 'imperial_household',
  visibility_network: ['network_contact', 'known_group'],
  relationships: {
    hidden_engine_key: {
      entity_id: 'hidden_engine_key',
      relationship_type: 'secret rival',
      trust_level: -10,
      recent_interactions: ['GM-only encounter'],
    },
  },
});

const lucius = makeEntity({ entity_id: 'lucius', name: 'Senator Lucius' });
const caius = makeEntity({ entity_id: 'caius', name: 'Caius' });
const entities = [player, lucius, caius];

function evidence(
  overrides: Partial<PlayerSafeEvidence> = {}
): PlayerSafeEvidence {
  return {
    id: 'report_7_1',
    source: 'rumor',
    text: 'Senator Lucius defended Severus Alexander before Caius in the Curia.',
    ...overrides,
  };
}

function draft(
  overrides: Partial<RelationshipObservationDraft> = {}
): RelationshipObservationDraft {
  return {
    evidenceId: 'report_7_1',
    participantIds: ['severus_alexander', 'lucius'],
    excerpt: 'Senator Lucius defended Severus Alexander before Caius in the Curia.',
    ...overrides,
  };
}

const knownEntityIds = ['severus_alexander'];

function validate(
  drafts: RelationshipObservationDraft[],
  safeEvidence: PlayerSafeEvidence[] = [evidence()]
) {
  return validateRelationshipObservationDrafts({
    drafts,
    evidence: safeEvidence,
    entities,
    knownEntityIds,
  });
}

function ingest(
  prev: KnowledgeClaim[],
  drafts: RelationshipObservationDraft[],
  safeEvidence: PlayerSafeEvidence[] = [evidence()],
  turn = 7
) {
  return ingestRelationshipObservations(prev, {
    drafts,
    evidence: safeEvidence,
    entities,
    knownEntityIds,
    turn,
  });
}

describe('relationship observation semantic validation and ingestion', () => {
  it('persists only an exact sourced excerpt and stamps one frozen initial update', () => {
    const store = ingest([], [draft()]);

    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      subject: 'severus_alexander',
      claim: 'Senator Lucius defended Severus Alexander before Caius in the Curia.',
      claimKey: 'relationship-observation:7:0',
      firstLearnedTurn: 7,
      updates: [{
        turn: 7,
        source: 'rumor',
        text: 'Senator Lucius defended Severus Alexander before Caius in the Curia.',
      }],
      relationshipObservation: {
        evidenceId: 'report_7_1',
        participantIds: ['severus_alexander', 'lucius'],
      },
    });
    expect(store[0].updates).toHaveLength(1);
  });

  it.each([
    ['a missing evidence id', draft({ evidenceId: 'missing' })],
    ['fewer than two unique participants', draft({ participantIds: ['lucius', 'lucius'] })],
    ['a nonexistent participant id', draft({ participantIds: ['severus_alexander', 'not_an_entity'] })],
    ['a model-rewritten excerpt', draft({ excerpt: 'Lucius loyally supported the emperor.' })],
    ['an empty excerpt', draft({ excerpt: '' })],
    ['a whitespace-only excerpt', draft({ excerpt: '   ' })],
  ])('rejects %s fail-closed', (_label, invalidDraft) => {
    expect(validate([invalidDraft])).toEqual([]);
    expect(ingest([], [invalidDraft])).toEqual([]);
  });

  it('rejects an unknown participant whose display name is absent from the cited evidence', () => {
    const cited = evidence({ text: 'Senator Lucius defended Severus Alexander before the Curia.' });
    const invalid = draft({ participantIds: ['severus_alexander', 'caius'], excerpt: cited.text });
    expect(validate([invalid], [cited])).toEqual([]);
    expect(ingest([], [invalid], [cited])).toEqual([]);
  });

  it('allows a previously unknown participant only when the cited evidence names that entity', () => {
    const accepted = validate([draft()]);
    expect(accepted).toEqual([draft()]);
  });

  it('copies source provenance from evidence and ignores model-authored source or quote fields', () => {
    const pollutedDraft = {
      ...draft(),
      source: 'self',
      quote: { speakerId: 'caius', text: 'MODEL FABRICATION' },
      sentiment: 'loyal',
      confidence: 1,
      analysis: 'Lucius must secretly adore the emperor.',
      secret_truth: 'DRAFT_SECRET_TRUTH_SENTINEL',
      gm_private: 'DRAFT_GM_PRIVATE_SENTINEL',
      raw_delta: 'DRAFT_RAW_DELTA_SENTINEL',
      roll: 20,
      total: 30,
      margin: 18,
      tier: 'critical_success',
      trace: 'DRAFT_TRACE_SENTINEL',
      privateIntent: 'DRAFT_PRIVATE_INTENT_SENTINEL',
      narration: 'DRAFT_NARRATION_SENTINEL',
    } as unknown as RelationshipObservationDraft;
    const pollutedEvidence = [{
      ...evidence(),
      secret_truth: 'EVIDENCE_SECRET_TRUTH_SENTINEL',
      gm_private: 'EVIDENCE_GM_PRIVATE_SENTINEL',
      raw_delta: 'EVIDENCE_RAW_DELTA_SENTINEL',
      roll: 19,
      tier: 'success',
      trace: 'EVIDENCE_TRACE_SENTINEL',
      privateIntent: 'EVIDENCE_PRIVATE_INTENT_SENTINEL',
      narration: 'EVIDENCE_NARRATION_SENTINEL',
    }] as unknown as PlayerSafeEvidence[];
    const pollutedEntities = entities.map(entity => ({
      ...entity,
      relationships: { private: 'ENTITY_RELATIONSHIP_SENTINEL' },
      short_term_goals: ['ENTITY_SHORT_GOAL_SENTINEL'],
      long_term_ambitions: ['ENTITY_LONG_GOAL_SENTINEL'],
      current_state_narrative: 'ENTITY_STATE_NARRATIVE_SENTINEL',
      active_scheme: { name: 'ENTITY_SCHEME_SENTINEL', overall_goal: '', steps: [] },
    })) as unknown as Entity[];

    const accepted = validateRelationshipObservationDrafts({
      drafts: [pollutedDraft],
      evidence: pollutedEvidence,
      entities: pollutedEntities,
      knownEntityIds,
    });
    expect(accepted).toEqual([draft()]);

    const store = ingestRelationshipObservations([], {
      drafts: [pollutedDraft],
      evidence: pollutedEvidence,
      entities: pollutedEntities,
      knownEntityIds,
      turn: 7,
    });
    expect(store[0].updates[0].source).toBe('rumor');
    expect(store[0].relationshipObservation?.quote).toBeUndefined();
    const playerArtifacts = `${JSON.stringify(accepted)}\n${JSON.stringify(store)}`;
    for (const forbidden of [
      'MODEL FABRICATION', 'sentiment', 'confidence', 'analysis', 'secretly adore',
      'SECRET_TRUTH_SENTINEL', 'GM_PRIVATE_SENTINEL', 'RAW_DELTA_SENTINEL',
      '"roll"', '"total"', '"margin"', 'critical_success', 'TRACE_SENTINEL',
      'PRIVATE_INTENT_SENTINEL', 'NARRATION_SENTINEL', 'ENTITY_RELATIONSHIP_SENTINEL',
      'ENTITY_SHORT_GOAL_SENTINEL', 'ENTITY_LONG_GOAL_SENTINEL',
      'ENTITY_STATE_NARRATIVE_SENTINEL', 'ENTITY_SCHEME_SENTINEL',
    ]) {
      expect(playerArtifacts).not.toContain(forbidden);
    }
  });

  it('keeps contradictory observations as separate claims with unique ordinal keys', () => {
    const safeEvidence = [
      evidence({ id: 'report_7_support', text: 'Senator Lucius defended Severus Alexander before the Senate.' }),
      evidence({ id: 'report_7_condemn', source: 'scout', text: 'Senator Lucius condemned Severus Alexander before the Senate.' }),
    ];
    const drafts = [
      draft({ evidenceId: 'report_7_support', excerpt: safeEvidence[0].text }),
      draft({ evidenceId: 'report_7_condemn', excerpt: safeEvidence[1].text }),
    ];

    const store = ingest([], drafts, safeEvidence);
    expect(store).toHaveLength(2);
    expect(store.map(claim => claim.claimKey)).toEqual([
      'relationship-observation:7:0',
      'relationship-observation:7:1',
    ]);
    expect(store.map(claim => claim.updates)).toEqual([
      [{ turn: 7, source: 'rumor', text: safeEvidence[0].text }],
      [{ turn: 7, source: 'scout', text: safeEvidence[1].text }],
    ]);
  });

  it('is idempotent for an already-ingested evidence id', () => {
    const first = ingest([], [draft()]);
    const second = ingest(first, [draft()], [evidence()], 8);
    expect(second).toBe(first);
  });

  it(`shares the existing MAX_KNOWLEDGE_CLAIMS (${MAX_KNOWLEDGE_CLAIMS}) bound`, () => {
    const prior = Array.from({ length: MAX_KNOWLEDGE_CLAIMS }, (_, index): KnowledgeClaim => ({
      id: `old_${index}`,
      subject: `old_subject_${index}`,
      claim: `old claim ${index}`,
      claimKey: `old:${index}`,
      firstLearnedTurn: index,
      updates: [{ turn: index, source: 'public', text: `old claim ${index}` }],
    }));
    const next = ingest(prior, [draft()]);
    expect(next).toHaveLength(MAX_KNOWLEDGE_CLAIMS);
    expect(next.some(claim => claim.id === 'old_0')).toBe(false);
    expect(next.some(claim => claim.relationshipObservation?.evidenceId === 'report_7_1')).toBe(true);
  });

  it('allocates the next relationship ordinal after the maximum existing ordinal, not the count', () => {
    const existing = ingest([], [draft()], [evidence()], 7).concat({
      id: 'claim_7_relationship-observation:7:3', subject: 'lucius', claim: 'Existing gap marker',
      topic: 'relationship-observation', claimKey: 'relationship-observation:7:3', firstLearnedTurn: 7,
      updates: [{ turn: 7, source: 'rumor' as const, text: 'Existing gap marker' }],
      relationshipObservation: { evidenceId: 'existing_3', participantIds: ['lucius', 'severus_alexander'] },
    });
    const nextEvidence = evidence({ id: 'report_7_2', text: 'Senator Lucius warned Severus Alexander before the Curia.' });
    const next = ingest(existing, [draft({ evidenceId: nextEvidence.id, excerpt: nextEvidence.text })], [nextEvidence]);
    expect(next.at(-1)?.claimKey).toBe('relationship-observation:7:4');
    expect(new Set(next.map(claim => claim.id)).size).toBe(next.length);
  });

  it('fails closed for duplicate evidence ids before semantic validation or ingestion, regardless of order', () => {
    const duplicateEvidence = [
      evidence({ id: 'same', source: 'rumor', text: 'Senator Lucius defended Severus Alexander.' }),
      evidence({ id: 'same', source: 'scout', text: 'Senator Lucius condemned Severus Alexander.' }),
    ];
    const duplicateDraft = draft({ evidenceId: 'same', excerpt: duplicateEvidence[0].text });
    for (const ordered of [duplicateEvidence, duplicateEvidence.slice().reverse()]) {
      expect(validate([duplicateDraft], ordered)).toEqual([]);
      expect(ingest([], [duplicateDraft], ordered)).toEqual([]);
    }
  });
});

describe('deterministic trusted quote attribution', () => {
  it('attaches one explicit unambiguous speaker/verb/quoted-text match', () => {
    const text = 'Senator Lucius said, "Severus has my public support."';
    const built = buildPlayerSafeEvidence(
      { id: 'direct_8_1', source: 'witnessed', text },
      entities
    );

    expect(built.trustedQuote).toEqual({
      speakerId: 'lucius',
      text: 'Severus has my public support.',
    });
    expect(text).toContain(built.trustedQuote!.text);
  });

  it.each([
    'Senator Lucius praised Severus without a direct quotation.',
    'Someone said, "Severus has my support."',
    'Senator Lucius said, "I support Severus," while Caius replied, "I do not."',
    'Senator Lucius said one thing and later said, "I support Severus," then said, "For now."',
    'In front of Senator Lucius, a guard said, "The gates are open."',
  ])('fails closed to ordinary evidence for ambiguous or non-explicit prose: %s', text => {
    expect(buildPlayerSafeEvidence({ id: 'direct_8_1', source: 'witnessed', text }, entities).trustedQuote)
      .toBeUndefined();
  });

  it('copies a trusted quote only when its speaker is a validated participant and its text is inside the selected excerpt', () => {
    const text = 'Caius watched as Senator Lucius said, "Severus has my public support." The crowd cheered.';
    const withQuote = buildPlayerSafeEvidence({ id: 'direct_8_1', source: 'witnessed', text }, entities);
    const accepted = ingest([], [draft({
      evidenceId: 'direct_8_1',
      excerpt: 'Senator Lucius said, "Severus has my public support."',
    })], [withQuote], 8);
    expect(accepted[0].relationshipObservation?.quote).toEqual(withQuote.trustedQuote);

    const excerptOmitsQuote = ingest([], [draft({
      evidenceId: 'direct_8_1',
      excerpt: 'The crowd cheered.',
    })], [withQuote], 8);
    expect(excerptOmitsQuote[0].relationshipObservation?.quote).toBeUndefined();

    const speakerOmitted = ingest([], [draft({
      evidenceId: 'direct_8_1',
      participantIds: ['severus_alexander', 'caius'],
      excerpt: text,
    })], [withQuote], 8);
    expect(speakerOmitted[0].relationshipObservation?.quote).toBeUndefined();
  });
});

describe('perception-safe entity knownness and relationship timelines', () => {
  const hiddenEntity = makeEntity({
    entity_id: 'OFF_NETWORK_HIDDEN_NAME_SENTINEL',
    name: 'Off Network Hidden Name Sentinel',
    status: 'dead',
    faction_id: player.faction_id,
    location: player.location,
    relationships: {
      severus_alexander: {
        entity_id: 'severus_alexander',
        relationship_type: 'secret patron',
        trust_level: 10,
        recent_interactions: ['secret meeting'],
      },
    },
    current_state_narrative: 'Secretly directing the succession.',
    short_term_goals: ['Install a puppet emperor'],
    long_term_ambitions: ['Rule Rome unseen'],
    active_scheme: {
      name: 'Hidden bid',
      overall_goal: 'Take the purple',
      steps: [{ objective: 'Remain unknown', status: 'in_progress' }],
    },
    secret_truth: { actually_alive: true, hidden_since_turn: 2, motive: 'revenge' },
  });
  const observedEntity = lucius;

  const knowledgeWithObservation = ingest([], [draft()]);
  const knowledgeWithContradictions = ingest(
    knowledgeWithObservation,
    [draft({
      evidenceId: 'report_8_1',
      excerpt: 'Senator Lucius condemned Severus Alexander before the Curia.',
    })],
    [evidence({ id: 'report_8_1', text: 'Senator Lucius condemned Severus Alexander before the Curia.' })],
    8
  );

  it('learns an entity from an observation participant but not from hidden roster or mechanic state', () => {
    expect(isEntityKnownToPlayer(player, hiddenEntity, [])).toBe(false);
    expect(isEntityKnownToPlayer(player, observedEntity, knowledgeWithObservation)).toBe(true);
  });

  it('does not infer identity from location, status, shared faction membership, relationship keys, goals, narrative, schemes, or secret truth', () => {
    expect(isEntityKnownToPlayer(player, hiddenEntity, [])).toBe(false);
    expect(isEntityKnownToPlayer(player, makeEntity({
      entity_id: 'hidden_engine_key',
      name: 'Hidden Engine Relationship',
    }), [])).toBe(false);
  });

  it('uses only the visibility network, the player faction itself, or player-held claim subjects/participants', () => {
    expect(isEntityKnownToPlayer(player, makeEntity({ entity_id: 'network_contact' }), [])).toBe(true);
    expect(isEntityKnownToPlayer(player, makeEntity({ entity_id: 'imperial_household', entity_type: 'faction' }), [])).toBe(true);
    expect(isEntityKnownToPlayer(player, caius, [{
      id: 'held_caius',
      subject: 'caius',
      claim: 'A report about Caius.',
      claimKey: 'report:caius:general:rumor',
      firstLearnedTurn: 3,
      updates: [{ turn: 3, source: 'rumor', text: 'A report about Caius.' }],
    }])).toBe(true);
  });

  it('returns the sourced contradictory timeline without synthesizing a verdict', () => {
    const timeline = relationshipTimelineFor(knowledgeWithContradictions, observedEntity.entity_id);
    expect(timeline).toHaveLength(2);
    expect(timeline.map(claim => claim.claim)).toEqual([
      'Senator Lucius defended Severus Alexander before Caius in the Curia.',
      'Senator Lucius condemned Severus Alexander before the Curia.',
    ]);
  });

  it('returns only the observed entity when it is the sole known recipient candidate', () => {
    expect(knownRecipientOptionsForPlayer(
      player,
      [player, hiddenEntity, observedEntity],
      knowledgeWithObservation
    )).toEqual([{ entityId: observedEntity.entity_id, displayName: observedEntity.name }]);
  });

  it('projects safe recipient options, excludes the player and hidden sentinel, sorts names, and ignores status reachability', () => {
    const knownGroup = makeEntity({
      entity_id: 'known_group',
      name: 'A Missing Cohort',
      entity_type: 'group',
      status: 'missing',
    });
    const playerFaction = makeEntity({
      entity_id: 'imperial_household',
      name: 'Imperial Household',
      entity_type: 'faction',
      status: 'exiled',
    });
    const options = knownRecipientOptionsForPlayer(
      player,
      [hiddenEntity, observedEntity, playerFaction, player, knownGroup],
      knowledgeWithObservation
    );

    expect(options).toEqual([
      { entityId: 'known_group', displayName: 'A Missing Cohort' },
      { entityId: 'imperial_household', displayName: 'Imperial Household' },
      { entityId: 'lucius', displayName: 'Senator Lucius' },
    ]);
    expect(JSON.stringify(options)).not.toContain('OFF_NETWORK_HIDDEN_NAME_SENTINEL');
    expect(JSON.stringify(options)).not.toContain('status');
  });
});
