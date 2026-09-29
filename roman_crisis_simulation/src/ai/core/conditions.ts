/**
 * ai/core/conditions.ts
 *
 * The condition tracker (DESIGN_DECISIONS.md D48): the lasting marks a
 * character bears - a nasty scar, a limp, nightmares, grief, a broken oath.
 * "The narration is the game's state": a mark the story leaves is recorded
 * here, it shapes what its bearer sets out to do (the prompts carry that -
 * no numeric modifier is computed), and later events can deepen, ease or
 * heal it.
 *
 * One home for the rules, so the engine that applies a 'condition' delta
 * (ai/core/engine.ts), the perception layer that says what one visibly did
 * (perception/visibility.ts), the load and model boundaries that accept
 * conditions on an entity, and the prompt builders that describe them all
 * read the same definitions. Pure and deterministic, like ./resources.ts.
 *
 * Who may know a condition: an OUTWARD mark is perceived like a status
 * change (witnessed or through a contact); an INWARD one is known to its
 * bearer alone. An NPC's inward conditions are GM-private - they may reach
 * the omniscient adjudicator and that NPC's own mind, never the player.
 */

import {
    ConditionChangeEnum,
    ConditionSeverityEnum,
    type Condition,
    type ConditionSeverity,
    type Entity,
    type EventDelta,
} from '../../types';

/**
 * Upper bound on the conditions one entity bears. Conditions persist in the
 * save and ride into every brief, so like every accreting slice they are
 * bounded; a mark past the bound is refused and recorded rather than
 * silently dropping an older one the story may still lean on.
 */
export const MAX_ENTITY_CONDITIONS = 12;

const MAX_CONDITION_ID_LENGTH = 40;

/** The default weight of a mark added without one. */
const DEFAULT_SEVERITY: ConditionSeverity = 'serious';

function isSeverity(value: unknown): value is ConditionSeverity {
    return typeof value === 'string' && (ConditionSeverityEnum as readonly string[]).includes(value);
}

function severityRank(severity: ConditionSeverity): number {
    return ConditionSeverityEnum.indexOf(severity);
}

/** One step heavier (step 1) or lighter (step -1), held within light..grave. */
function stepSeverity(severity: ConditionSeverity, step: 1 | -1): ConditionSeverity {
    const rank = Math.max(0, Math.min(ConditionSeverityEnum.length - 1, severityRank(severity) + step));
    return ConditionSeverityEnum[rank];
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * A stable snake_case handle from a delta key's second half or a condition's
 * name ("A nasty scar" -> 'a_nasty_scar'). Empty when nothing usable remains.
 */
export function conditionIdFrom(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_CONDITION_ID_LENGTH)
        .replace(/_+$/g, '');
}

function isCondition(value: unknown): value is Condition {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    return typeof c.id === 'string' && c.id.length > 0
        && typeof c.name === 'string' && c.name.trim().length > 0
        && typeof c.description === 'string'
        && typeof c.outward === 'boolean'
        && isSeverity(c.severity)
        && typeof c.since_turn === 'number' && Number.isFinite(c.since_turn);
}

/**
 * An entity's conditions, tolerating an absent field (every entity saved
 * before D48) and skipping any malformed record, so no reader - a prompt, a
 * panel - ever trips on one.
 */
export function conditionsOf(entity: Pick<Entity, 'conditions'> | undefined): Condition[] {
    const list = entity?.conditions;
    return Array.isArray(list) ? list.filter(isCondition) : [];
}

/** Only the marks others can see. */
export function outwardConditionsOf(entity: Pick<Entity, 'conditions'> | undefined): Condition[] {
    return conditionsOf(entity).filter(condition => condition.outward);
}

/**
 * Normalizes a conditions field arriving from outside the engine - a model
 * that authored a whole entity (world generation, character creation,
 * add_entities) or a loaded save. Each record is rebuilt field by field: a
 * missing handle is derived from the name, a missing weight is 'serious', a
 * missing visibility is INWARD (the private default - an unstated mark is
 * never shown to others), a missing turn is `sinceTurn`. A record with no
 * name is dropped, handles are deduplicated, and the list is bounded.
 * Returns undefined when nothing survives, so the entity keeps no field.
 */
export function normalizeConditions(value: unknown, sinceTurn = 0): Condition[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const kept: Condition[] = [];
    const ids = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const name = cleanText(raw.name);
        const id = conditionIdFrom(cleanText(raw.id) || name);
        if (!name || !id || ids.has(id)) continue;
        ids.add(id);
        kept.push({
            id,
            name,
            description: cleanText(raw.description),
            outward: raw.outward === true,
            severity: isSeverity(raw.severity) ? raw.severity : DEFAULT_SEVERITY,
            since_turn: typeof raw.since_turn === 'number' && Number.isFinite(raw.since_turn) ? raw.since_turn : sinceTurn,
        });
        if (kept.length >= MAX_ENTITY_CONDITIONS) break;
    }
    return kept.length > 0 ? kept : undefined;
}

/** The condition id a 'condition' delta names: its key's second half, else its payload name. */
export function conditionIdOfDelta(delta: EventDelta): string {
    const [, rawId] = delta.key.split(':');
    return conditionIdFrom(rawId || cleanText(delta.condition?.name));
}

/**
 * Applies one 'condition' delta to `entity` IN PLACE (the engine hands it a
 * deep-cloned roster). Returns a GM-console note when the delta is refused -
 * the engine's refuse-and-record answer to a malformed instruction - or null
 * when it applied.
 *
 *  - add:    a new mark (name required; the bound is enforced). Adding a
 *            mark already borne RESTATES it - its name/description/
 *            visibility/weight may be refreshed, its turn is kept - so a
 *            repeated add never duplicates it.
 *  - deepen: one step heavier (or to a stated heavier weight), with an
 *            optional new description.
 *  - ease:   one step lighter (or to a stated lighter weight); a mark eased
 *            at its lightest stays until it is healed.
 *  - heal:   the mark is gone.
 */
export function applyConditionDelta(entity: Entity, delta: EventDelta, turnNumber: number): string | null {
    const payload = delta.condition;
    const refuse = (why: string) => `[Engine] Refused a 'condition' delta on '${delta.key}' - ${why}; ${entity.name}'s conditions were left unchanged.`;
    if (!payload || !(ConditionChangeEnum as readonly string[]).includes(payload.change)) {
        return refuse('it carries no add/deepen/ease/heal change');
    }
    const id = conditionIdOfDelta(delta);
    if (!id) return refuse('it names no condition');

    const list = conditionsOf(entity).map(condition => ({ ...condition }));
    const index = list.findIndex(condition => condition.id === id);
    const name = cleanText(payload.name);
    const description = cleanText(payload.description);
    const restated = {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(typeof payload.outward === 'boolean' ? { outward: payload.outward } : {}),
    };

    switch (payload.change) {
        case 'add': {
            if (index >= 0) {
                list[index] = { ...list[index], ...restated, ...(isSeverity(payload.severity) ? { severity: payload.severity } : {}) };
                break;
            }
            if (!name) return refuse('a new condition needs a name');
            if (list.length >= MAX_ENTITY_CONDITIONS) return refuse(`they already bear the most conditions one character may carry (${MAX_ENTITY_CONDITIONS})`);
            list.push({
                id,
                name,
                description,
                outward: payload.outward === true,
                severity: isSeverity(payload.severity) ? payload.severity : DEFAULT_SEVERITY,
                since_turn: turnNumber,
            });
            break;
        }
        case 'deepen':
        case 'ease': {
            if (index < 0) return refuse(`they bear no condition '${id}' to ${payload.change}`);
            const current = list[index];
            const step = payload.change === 'deepen' ? 1 : -1;
            const stated = isSeverity(payload.severity) ? payload.severity : undefined;
            const statedMoves = stated !== undefined && Math.sign(severityRank(stated) - severityRank(current.severity)) === step;
            list[index] = { ...current, ...restated, severity: statedMoves ? stated : stepSeverity(current.severity, step) };
            break;
        }
        case 'heal': {
            if (index < 0) return refuse(`they bear no condition '${id}' to heal`);
            list.splice(index, 1);
            break;
        }
    }

    if (list.length > 0) entity.conditions = list;
    else delete entity.conditions;
    return null;
}

/** What a 'condition' delta visibly did to one mark, from one vantage. */
export interface ConditionEffect {
    kind: 'gained' | 'deepened' | 'eased' | 'healed';
    /** The mark as it now stands - or, once healed, as it last stood. */
    condition: Condition;
}

/**
 * What a 'condition' delta visibly did, read from the state it left - the
 * way perception/visibility.ts's statusDeltaEffect mirrors the engine's
 * 'status' case. `after` is the bearer's conditions post-turn; `before` the
 * bearer's conditions as the turn began, or undefined when the caller has no
 * record of them (the delta's own change word is then trusted for a mark
 * still standing, and a heal cannot be seen). `seesInward` is true only for
 * the bearer: everyone else sees outward marks alone, so an inward mark - or
 * one turned inward - is no effect at all to them. Returns null when nothing
 * perceptible changed (a restated mark, a refused delta).
 */
export function conditionDeltaEffect(
    delta: EventDelta,
    after: Condition[],
    before: Condition[] | undefined,
    seesInward: boolean,
): ConditionEffect | null {
    const id = conditionIdOfDelta(delta);
    const visible = (condition: Condition | undefined) => condition && (seesInward || condition.outward) ? condition : undefined;
    const now = visible(after.find(condition => condition.id === id));
    const change = delta.condition?.change;
    if (before === undefined) {
        if (!now) return null;
        return { kind: change === 'deepen' ? 'deepened' : change === 'ease' ? 'eased' : 'gained', condition: now };
    }
    const then = visible(before.find(condition => condition.id === id));
    if (now && !then) return { kind: 'gained', condition: now };
    if (!now && then) return { kind: 'healed', condition: then };
    if (!now || !then) return null;
    const moved = severityRank(now.severity) - severityRank(then.severity);
    if (moved > 0 || (moved === 0 && change === 'deepen')) return { kind: 'deepened', condition: now };
    if (moved < 0 || (moved === 0 && change === 'ease')) return { kind: 'eased', condition: now };
    return null;
}

/** How a condition clause is written for one prompt. */
export interface ConditionClauseOptions {
    /** Say who can see it - for prompts that may carry inward marks (the omniscient adjudicator, the bearer's own mind or narration). A clause about someone else's mark omits it: only outward marks are ever shown there. */
    visibility?: boolean;
    /** Carry the handle a later 'condition' delta names it by - for the prompts that author deltas. */
    handle?: boolean;
}

/** One condition as a prompt clause. */
export function conditionClause(condition: Condition, options: ConditionClauseOptions = {}): string {
    const visibility = options.visibility === false ? '' : condition.outward ? 'outward - others can see it' : 'inward - known only to its bearer';
    const tags = [options.handle ? `handle '${condition.id}'` : '', condition.severity, visibility].filter(Boolean).join('; ');
    return `${condition.name} (${tags})${condition.description ? `: ${condition.description}` : ''}`;
}

/** Every condition as one prompt line, or '' when there are none. */
export function conditionsLine(conditions: Condition[], options: ConditionClauseOptions = {}): string {
    return conditions.map(condition => conditionClause(condition, options)).join('; ');
}
