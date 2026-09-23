import type { PlayerCharacterOption } from '../types';

/** The four preset destinies offered on the destiny screen. */
export const PLAYER_CHARACTER_OPTIONS: readonly PlayerCharacterOption[] = [
    { name: "The Young Emperor", entity_id: "severus_alexander", description: "Rule as the idealistic but embattled emperor.", difficulty: "Hard" },
    { name: "The Ambitious General", entity_id: "maximinus_thrax", description: "Lead the frontier legions in revolt.", difficulty: "Medium" },
    { name: "The Wealthy Senator", entity_id: "gaius_pontius_magnus", description: "Use your vast wealth and political influence to manipulate the Senate from within.", difficulty: "Medium" },
    { name: "The Cunning Spymaster", entity_id: "lycinia_stolo", description: "Operate from the shadows, trading secrets and lies to shape the future of the Empire.", difficulty: "Hard" },
];

/** Design-system heraldry for the four preset destinies (ui_kits/simulation). */
export const DESTINY_HERALDRY: Record<string, { numeral: string; seal: string; motto: string }> = {
    severus_alexander: { numeral: 'I', seal: 'A', motto: 'Pietas et Concordia' },
    maximinus_thrax: { numeral: 'II', seal: 'M', motto: 'Ferro et Fide' },
    gaius_pontius_magnus: { numeral: 'III', seal: 'G', motto: 'Aurum Regit' },
    lycinia_stolo: { numeral: 'IV', seal: 'L', motto: 'Scientia Potentia' },
};
