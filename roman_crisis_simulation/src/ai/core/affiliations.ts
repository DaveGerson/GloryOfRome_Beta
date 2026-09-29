/**
 * ai/core/affiliations.ts
 *
 * Affiliations, openly professed or kept secret (DESIGN_DECISIONS.md D49):
 * the factions, causes, cults and faiths a character holds to - "they might
 * publicly be a booster of a triumph, but might keep their affiliation to a
 * cult of Bacchus a secret, or even their religion if they convert to
 * Christianity".
 *
 * One home for the rules, as ./conditions.ts is for marks: the engine that
 * applies an 'affiliation' delta, the perception layer that says who saw it,
 * the load and model boundaries, and every prompt builder read the same
 * definitions. Pure and deterministic.
 *
 * Who may know a tie: an OPENLY PROFESSED one is public knowledge - anyone
 * who knows the figure knows it, and a change to one is perceived as public.
 * A SECRET one is ground truth known to its holder and the GM; others learn
 * it only as secrets are learned - witnessing it (present at the rite), an
 * investigation (see secretAffiliationsOf, the seam for that wiring), a
 * confidant, or its holder going public or being exposed. The player's own
 * secret ties are shown to the player, marked as secret, and never to an NPC
 * who has not learned them.
 */

import {
    AffiliationChangeEnum,
    AffiliationKindEnum,
    type Affiliation,
    type AffiliationKind,
    type Entity,
    type EventDelta,
} from '../../types';

/** Upper bound on the ties one entity holds - persisted and briefed, so bounded like conditions. */
export const MAX_ENTITY_AFFILIATIONS = 12;

const MAX_AFFILIATION_ID_LENGTH = 40;

function isKind(value: unknown): value is AffiliationKind {
    return typeof value === 'string' && (AffiliationKindEnum as readonly string[]).includes(value);
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** A stable snake_case handle from a delta key's second half or a tie's name. */
export function affiliationIdFrom(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_AFFILIATION_ID_LENGTH)
        .replace(/_+$/g, '');
}

function isAffiliation(value: unknown): value is Affiliation {
    if (!value || typeof value !== 'object') return false;
    const a = value as Record<string, unknown>;
    return typeof a.id === 'string' && a.id.length > 0
        && typeof a.name === 'string' && a.name.trim().length > 0
        && isKind(a.kind)
        && typeof a.public === 'boolean'
        && (a.faction_id === undefined || typeof a.faction_id === 'string');
}

/** An entity's ties, tolerating an absent field (every entity saved before D49) and skipping a malformed record. */
export function affiliationsOf(entity: Pick<Entity, 'affiliations'> | undefined): Affiliation[] {
    const list = entity?.affiliations;
    return Array.isArray(list) ? list.filter(isAffiliation) : [];
}

/** The ties a figure openly professes - public knowledge (D49). */
export function publicAffiliationsOf(entity: Pick<Entity, 'affiliations'> | undefined): Affiliation[] {
    return affiliationsOf(entity).filter(affiliation => affiliation.public);
}

/**
 * The ties a figure keeps SECRET - GM-private ground truth. The seam for the
 * investigation wiring (D47/D49): an agent reaching for the truth about a
 * figure reaches these, and what the player then learns is recorded through
 * knowledge/store.ts::ingestLearnedAffiliation. Never render this list on a
 * player surface or hand it to a player-facing or NPC-facing prompt.
 */
export function secretAffiliationsOf(entity: Pick<Entity, 'affiliations'> | undefined): Affiliation[] {
    return affiliationsOf(entity).filter(affiliation => !affiliation.public);
}

/**
 * Normalizes an affiliations field arriving from outside the engine - a
 * model-authored entity or a loaded save - record by record: a missing handle
 * is derived from the name, a missing kind is 'other', a missing `public` is
 * SECRET (the private default - an unstated tie is never announced), a
 * `faction_id` is kept only when it is a string. A nameless record is
 * dropped, handles are deduplicated, and the list is bounded. Returns
 * undefined when nothing survives.
 */
export function normalizeAffiliations(value: unknown): Affiliation[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const kept: Affiliation[] = [];
    const ids = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const name = cleanText(raw.name);
        const id = affiliationIdFrom(cleanText(raw.id) || name);
        if (!name || !id || ids.has(id)) continue;
        ids.add(id);
        const factionId = cleanText(raw.faction_id);
        kept.push({
            id,
            name,
            kind: isKind(raw.kind) ? raw.kind : 'other',
            public: raw.public === true,
            ...(factionId ? { faction_id: factionId } : {}),
        });
        if (kept.length >= MAX_ENTITY_AFFILIATIONS) break;
    }
    return kept.length > 0 ? kept : undefined;
}

/** The affiliation id an 'affiliation' delta names: its key's second half, else its payload name. */
export function affiliationIdOfDelta(delta: EventDelta): string {
    const [, rawId] = delta.key.split(':');
    return affiliationIdFrom(rawId || cleanText(delta.affiliation?.name));
}

/**
 * Applies one 'affiliation' delta to `entity` IN PLACE (the engine hands it
 * a deep-cloned roster). Returns a GM-console note when refused, else null.
 *
 *  - join:      takes up a tie - openly when `public` is true, else in
 *               secret (the private default). Joining a tie already held
 *               restates it; it can be made public that way, never secret
 *               again - what the world has seen it cannot unsee.
 *  - leave:     gives the tie up.
 *  - go_public: the holder professes a secret tie openly.
 *  - expose:    someone else lays a secret tie bare.
 * Going public or being exposed may also name a tie never recorded (the
 * story found one out); it is then added as openly known.
 */
export function applyAffiliationDelta(entity: Entity, delta: EventDelta): string | null {
    const payload = delta.affiliation;
    const refuse = (why: string) => `[Engine] Refused an 'affiliation' delta on '${delta.key}' - ${why}; ${entity.name}'s affiliations were left unchanged.`;
    if (!payload || !(AffiliationChangeEnum as readonly string[]).includes(payload.change)) {
        return refuse('it carries no join/leave/go_public/expose change');
    }
    const id = affiliationIdOfDelta(delta);
    if (!id) return refuse('it names no affiliation');

    const list = affiliationsOf(entity).map(affiliation => ({ ...affiliation }));
    const index = list.findIndex(affiliation => affiliation.id === id);
    const name = cleanText(payload.name);
    const factionId = cleanText(payload.faction_id);
    const restated = {
        ...(name ? { name } : {}),
        ...(isKind(payload.kind) ? { kind: payload.kind } : {}),
        ...(factionId ? { faction_id: factionId } : {}),
    };
    const add = (isPublic: boolean): string | null => {
        if (!name) return refuse('a new affiliation needs a name');
        if (list.length >= MAX_ENTITY_AFFILIATIONS) return refuse(`they already hold the most affiliations one character may carry (${MAX_ENTITY_AFFILIATIONS})`);
        list.push({ id, name, kind: isKind(payload.kind) ? payload.kind : 'other', public: isPublic, ...(factionId ? { faction_id: factionId } : {}) });
        return null;
    };

    switch (payload.change) {
        case 'join': {
            if (index >= 0) {
                list[index] = { ...list[index], ...restated, public: list[index].public || payload.public === true };
                break;
            }
            const refusal = add(payload.public === true);
            if (refusal) return refusal;
            break;
        }
        case 'leave': {
            if (index < 0) return refuse(`they hold no affiliation '${id}' to leave`);
            list.splice(index, 1);
            break;
        }
        case 'go_public':
        case 'expose': {
            if (index >= 0) {
                list[index] = { ...list[index], ...restated, public: true };
                break;
            }
            const refusal = add(true);
            if (refusal) return refusal;
            break;
        }
    }

    if (list.length > 0) entity.affiliations = list;
    else delete entity.affiliations;
    return null;
}

/** What an 'affiliation' delta visibly did to one tie. */
export interface AffiliationEffect {
    kind: 'joined' | 'left' | 'avowed' | 'exposed';
    /** The tie as it now stands - or, once left, as it last stood. */
    affiliation: Affiliation;
    /** Whether the change was made in the open (a public tie, or one going public) - public knowledge, perceived by anyone. */
    public: boolean;
}

/**
 * What an 'affiliation' delta did, read from the state it left (the way
 * ./conditions.ts::conditionDeltaEffect reads a mark): `after` is the
 * holder's ties post-turn, `before` their ties as the turn began, or
 * undefined when the caller has no record of them (the delta's own change
 * is then trusted for a tie still held, and a departure cannot be seen).
 * The change is PUBLIC when the tie was professed openly before or after
 * it; otherwise it happened in secret. Returns null when nothing changed (a
 * restated tie, a refused delta).
 */
export function affiliationDeltaEffect(
    delta: EventDelta,
    after: Affiliation[],
    before: Affiliation[] | undefined,
): AffiliationEffect | null {
    const id = affiliationIdOfDelta(delta);
    const now = after.find(affiliation => affiliation.id === id);
    const then = before?.find(affiliation => affiliation.id === id);
    const change = delta.affiliation?.change;
    const revealed = change === 'expose' ? 'exposed' : 'avowed';
    if (before === undefined) {
        if (!now) return null;
        return { kind: change === 'go_public' || change === 'expose' ? revealed : 'joined', affiliation: now, public: now.public };
    }
    if (now && !then) {
        return { kind: now.public && (change === 'go_public' || change === 'expose') ? revealed : 'joined', affiliation: now, public: now.public };
    }
    if (!now && then) return { kind: 'left', affiliation: then, public: then.public };
    if (now && then && now.public && !then.public) return { kind: revealed, affiliation: now, public: true };
    return null;
}

/** How an affiliation clause is written for one prompt. */
export interface AffiliationClauseOptions {
    /** Carry the handle a later 'affiliation' delta names it by - for the prompts that author deltas. */
    handle?: boolean;
    /**
     * How a SECRET tie is marked. 'gm' (the omniscient prompts) says who
     * knows it; 'own' addresses its holder. Public ties are marked openly
     * professed either way.
     */
    voice?: 'gm' | 'own';
}

/** One tie as a prompt clause. */
export function affiliationClause(affiliation: Affiliation, options: AffiliationClauseOptions = {}): string {
    const standing = affiliation.public
        ? 'openly professed'
        : options.voice === 'own'
            ? 'KEPT SECRET - known only to you and to anyone who has learned it'
            : 'SECRET - known only to its holder and to anyone who has learned it';
    const tags = [
        options.handle ? `handle '${affiliation.id}'` : '',
        affiliation.kind,
        affiliation.faction_id ? `tie to ${affiliation.faction_id}` : '',
        standing,
    ].filter(Boolean).join('; ');
    return `${affiliation.name} (${tags})`;
}

/** Every tie as one prompt line, or '' when there are none. */
export function affiliationsLine(affiliations: Affiliation[], options: AffiliationClauseOptions = {}): string {
    return affiliations.map(affiliation => affiliationClause(affiliation, options)).join('; ');
}
