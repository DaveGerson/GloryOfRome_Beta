import { Entity, WorldState, SimulationState } from '../types';

export const FACTIONS_INITIAL: Entity[] = [
    {
        entity_id: "senatorial_party", name: "Senatorial Party", entity_type: "faction", status: "alive", location: "The Curia",
        // Group voice (4C.5): a faction speaks as a bloc. Epithet from the
        // latus clavus, the broad purple stripe of senatorial rank.
        voice: "measured curial consensus-speak; precedent invoked, blame diffused",
        epithet: "the Broad Stripes",
        short_term_goals: ["Uphold senatorial authority", "Limit the power of 'barracks emperors'"],
        long_term_ambitions: ["Restore the Republic in all but name"],
        current_state_narrative: "A coalition of traditionalist senators who believe that only their ancient institution can guide Rome through the coming storm. They are wealthy and influential, but lack direct military power.",
        relationships: {
            "military_cabal": { entity_id: "military_cabal", relationship_type: "political rival", trust_level: -8, respect_level: -5, perceived_threat: 9, ideological_alignment: -9, recent_interactions: [] },
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "uneasy ally", trust_level: 4, respect_level: 6, perceived_threat: 2, ideological_alignment: 7, dependency_level: 5, recent_interactions: [] }
        },
        memories: [], resources: { legitimacy: 95, collective_wealth: 1000000 },
        visibility_network: ["military_cabal", "severus_alexander", "praetorian_guard"],
        faction_members: ["roman_senate", "gaius_pontius_magnus"]
    },
    {
        entity_id: "military_cabal", name: "Military Cabal", entity_type: "faction", status: "alive", location: "Praetorian Camp",
        voice: "blunt camp Latin; pay, steel, and loyalty counted like rations",
        epithet: "the Men of the Camps",
        short_term_goals: ["Secure overdue pay for the legions", "Install a strong military leader as emperor"],
        long_term_ambitions: ["Ensure the army is the ultimate power in the Empire"],
        current_state_narrative: "A loose alliance of powerful commanders, now centered in Rome itself. Disgusted with the weak, civilian leadership, they are popular with the troops and represent an immediate military threat to the established order.",
        relationships: {
            "senatorial_party": { entity_id: "senatorial_party", relationship_type: "political rival", trust_level: -8, respect_level: -7, perceived_threat: 2, ideological_alignment: -9, recent_interactions: [] },
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "contempt", trust_level: -6, respect_level: -8, perceived_threat: 3, ideological_alignment: -8, recent_interactions: [] }
        },
        memories: [], resources: { military_might: 90, popular_support: 60 },
        visibility_network: ["senatorial_party", "severus_alexander", "praetorian_guard"],
        faction_members: ["maximinus_thrax"]
    }
];

export const ROME_INITIAL_STATE: Entity[] = [
    {
        entity_id: "severus_alexander", name: "Severus Alexander", entity_type: "individual", status: "alive", position: "Emperor", location: "Palatine Hill",
        // 4C.5: what the legions muttered about him historically - crowned at
        // thirteen, still under his mother's hand.
        voice: "earnest, Greek-schooled courtesy; hedges commands into appeals",
        epithet: "the Boy Emperor",
        personality: { ambition: 5, paranoia: 6, loyalty: 7, cunning: 4, honor: 8 },
        beliefs: ["The Senate is a vital part of Roman governance", "A just ruler must be merciful", "Peace through diplomacy is preferable to war"],
        secrets: ["Fears his mother's control is absolute", "Doubts his own ability to lead the legions"],
        skills: { oratory: 7, administration: 6, strategy: 3, intrigue: 4 },
        short_term_goals: ["Maintain Senate support", "Appease the military"], long_term_ambitions: ["Survive and secure his dynasty"],
        active_scheme: {
            name: "The Diplomat's Gambit",
            overall_goal: "Secure the dynasty by balancing the powers of the Senate and Military without open conflict.",
            steps: [
                { objective: "Solidify support within the Senate.", status: 'in_progress' },
                { objective: "Appease the Praetorian Guard with promises of donatives.", status: 'in_progress' },
                { objective: "Undermine military hardliners through political means.", status: 'pending' }
            ]
        },
        current_state_narrative: "Young, idealistic, and heavily influenced by his mother, Julia Mamaea. He is trapped in the palace, struggling to command respect as powerful factions circle.",
        relationships: {
            "julia_mamaea": { entity_id: "julia_mamaea", relationship_type: "family (mother)", trust_level: 9, respect_level: 6, perceived_threat: 1, ideological_alignment: 8, dependency_level: 9, recent_interactions: [] },
            "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "imminent threat", trust_level: -7, respect_level: 3, perceived_threat: 9, ideological_alignment: -8, dependency_level: 2, recent_interactions: [] },
            "praetorian_guard": { entity_id: "praetorian_guard", relationship_type: "subordinate", trust_level: 2, respect_level: 2, perceived_threat: 6, ideological_alignment: 2, dependency_level: 7, recent_interactions: [] },
            "roman_senate": { entity_id: "roman_senate", relationship_type: "ally", trust_level: 6, respect_level: 7, perceived_threat: 1, ideological_alignment: 7, dependency_level: 6, recent_interactions: [] }
        },
        memories: [{ turn: 0, event_description: "Ascended to the throne under the regency of his mother, Julia Mamaea.", emotional_impact: "Hopeful but pressured", involved_entities: ["julia_mamaea"] }],
        resources: { denarii: 50000, deep_analyses: 4, investigations: 1 },
        visibility_network: ["julia_mamaea", "maximinus_thrax", "praetorian_guard", "roman_senate", "senatorial_party", "military_cabal"]
    },
    {
        entity_id: "maximinus_thrax", name: "Maximinus Thrax", entity_type: "individual", status: "alive", position: "General of the Legions", location: "Praetorian Camp", faction_id: "military_cabal",
        // 4C.5: "Thrax" IS the epithet - the Thracian herdsman risen through
        // the ranks, and never allowed to forget it.
        voice: "clipped soldier's Latin, contempt for senatorial flourish",
        epithet: "the Thracian",
        personality: { ambition: 9, paranoia: 5, loyalty: 4, cunning: 6, honor: 3 },
        beliefs: ["Only the strong deserve to rule", "The Senate is a den of corrupt old fools", "The army is the heart of Rome"],
        secrets: ["Is illiterate and ashamed of it", "Fears being assassinated by his own men if he shows weakness"],
        skills: { oratory: 3, administration: 2, strategy: 9, intrigue: 5 },
        short_term_goals: ["Intimidate the Senate", "Secure Praetorian Guard loyalty"], long_term_ambitions: ["Become Emperor"],
        active_scheme: {
            name: "The Eagle's Rise",
            overall_goal: "Replace the weak Emperor Severus Alexander and rule Rome as a soldier.",
            steps: [
                { objective: "Turn the frontier legions against the Emperor.", status: 'completed' },
                { objective: "Secure the loyalty of the Praetorian Guard in Rome.", status: 'in_progress' },
                { objective: "Eliminate the Emperor and his mother.", status: 'pending' }
            ]
        },
        current_state_narrative: "A giant of a man, you have brought the loyalty of the frontier legions to the very heart of Rome. From the Praetorian Camp, you watch the city's elite with contempt, ready to seize power.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "rival", trust_level: -8, respect_level: -6, perceived_threat: 2, ideological_alignment: -8, dependency_level: 0, recent_interactions: [] },
            "roman_senate": { entity_id: "roman_senate", relationship_type: "antagonist", trust_level: -7, respect_level: -8, perceived_threat: 1, ideological_alignment: -9, dependency_level: 0, recent_interactions: [] }
        },
        memories: [{ turn: 0, event_description: "Was scorned by the Senate for his 'barbarian' origins despite his military victories.", emotional_impact: "Resentful", involved_entities: ["roman_senate"] }],
        resources: { denarii: 0, legion_support: 85, deep_analyses: 4, investigations: 1 },
        visibility_network: ["severus_alexander", "roman_senate", "senatorial_party"]
    },
    {
        entity_id: "praetorian_guard", name: "Praetorian Guard", entity_type: "group", status: "alive", location: "Praetorian Camp",
        // Group voice (4C.5): the Guard speaks as one restless barracks.
        voice: "barracks bark and grumbled oaths; every grievance priced in denarii",
        epithet: "the Kingmakers",
        short_term_goals: ["Assess loyalty of potential leaders", "Secure a massive pay bonus"], long_term_ambitions: ["Ensure their position as kingmakers"],
        current_state_narrative: "The elite guard grows restless. With Maximinus Thrax and his legions in their camp, their loyalty to the Emperor is weaker than ever. They sense an opportunity for immense profit and power.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "protector/antagonist", trust_level: -2, respect_level: 2, perceived_threat: 3, ideological_alignment: 2, dependency_level: 8, recent_interactions: [] },
            "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "potential commander", trust_level: 5, respect_level: 8, perceived_threat: 7, ideological_alignment: 8, dependency_level: 2, recent_interactions: [] },
        },
        memories: [], resources: { political_influence: 70 },
        visibility_network: ["severus_alexander", "roman_senate", "julia_mamaea", "senatorial_party", "military_cabal"]
    },
    {
        entity_id: "roman_senate", name: "Roman Senate", entity_type: "group", status: "alive", location: "The Curia", faction_id: "senatorial_party",
        // Group voice (4C.5). Epithet: patres conscripti, the Senate's
        // historical form of address.
        voice: "droning collective oratory; the ancestors recited to mask present fear",
        epithet: "the Conscript Fathers",
        short_term_goals: ["Preserve traditional power", "Denounce Maximinus Thrax"], long_term_ambitions: ["Restore the power and prestige of the Senate"],
        current_state_narrative: "A body of old, proud men who feel their influence waning. They are terrified by the military presence in the city and desperately seek a way to reassert their authority.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "ally", trust_level: 6, respect_level: 5, perceived_threat: 2, ideological_alignment: 7, dependency_level: 4, recent_interactions: [] },
            "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "antagonist", trust_level: -9, respect_level: -8, perceived_threat: 9, ideological_alignment: -9, dependency_level: 0, recent_interactions: [] }
        },
        memories: [], resources: { legitimacy: 90 },
        visibility_network: ["severus_alexander", "maximinus_thrax", "praetorian_guard", "julia_mamaea", "military_cabal"]
    },
    {
        entity_id: "julia_mamaea", name: "Julia Mamaea", entity_type: "individual", status: "alive", position: "Regent", location: "Palatine Hill",
        // 4C.5: from her historical title mater castrorum (mother of the camp).
        voice: "soft courtly diction with iron beneath; questions that are commands",
        epithet: "Mother of the Camp",
        personality: { ambition: 8, paranoia: 7, loyalty: 9, cunning: 8, honor: 4 },
        beliefs: ["My son is the rightful emperor", "Power is maintained through careful manipulation, not brute force", "No one can be trusted except family"],
        secrets: ["Has a private treasury unknown to the state", "Is actively seeking a diplomatic solution with the Germans, against the army's wishes"],
        skills: { oratory: 6, administration: 8, strategy: 4, intrigue: 9 },
        short_term_goals: ["Protect her son", "Negotiate with the military"], long_term_ambitions: ["Rule the empire through her son"],
        active_scheme: {
            name: "The Shadow Regency",
            overall_goal: "Rule the Empire from behind the throne, ensuring her son's survival and her own dominance.",
            steps: [
                { objective: "Control all access to the Emperor.", status: 'in_progress' },
                { objective: "Gather blackmail material on powerful senators and generals.", status: 'in_progress' },
                { objective: "Arrange for the 'accidental' removal of key threats.", status: 'pending' }
            ]
        },
        current_state_narrative: "The true power behind the throne. Cunning and ambitious, she is isolated in the palace, aware that her control is slipping as the military's influence grows.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "family (son)", trust_level: 9, respect_level: 8, perceived_threat: 0, ideological_alignment: 8, dependency_level: 10, recent_interactions: [] }
        },
        memories: [], resources: { personal_fortune: 100000 },
        visibility_network: ["severus_alexander", "praetorian_guard", "roman_senate", "senatorial_party", "military_cabal"]
    },
    {
        entity_id: "gaius_pontius_magnus", name: "Gaius Pontius Magnus", entity_type: "individual", status: "alive", position: "Senior Senator", location: "The Curia", faction_id: "senatorial_party",
        voice: "rolling Ciceronian periods; contempt dressed as courtesy",
        epithet: "the Voice of the Curia",
        personality: { ambition: 7, paranoia: 5, loyalty: 6, cunning: 7, honor: 7 },
        beliefs: ["The Senate is the only legitimate source of power", "Tradition and law must be upheld at all costs", "The 'new men' of the army are a cancer on the state"],
        secrets: ["Has bribed other senators for their loyalty", "Secretly despises the Emperor as a weak puppet"],
        skills: { oratory: 9, administration: 7, strategy: 2, intrigue: 6 },
        short_term_goals: ["Organize senatorial opposition to Maximinus", "Secure allies within the city"],
        long_term_ambitions: ["Become Princeps Senatus", "Restore Senatorial authority"],
        active_scheme: {
            name: "Restoration of the Republic",
            overall_goal: "Marginalize the Emperor and the military, making the Senate the true ruling body of Rome.",
            steps: [
                { objective: "Form a loyal voting bloc within the Senate.", status: 'in_progress' },
                { objective: "Use personal wealth to fund a city guard loyal to the Senate.", status: 'pending' },
                { objective: "Pass legislation stripping the Emperor of military command.", status: 'pending' }
            ]
        },
        current_state_narrative: "A respected and fabulously wealthy senator of an old family. You believe only the Senate, guided by a firm hand like your own, can save Rome from the barracks emperors now at their doorstep.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "uneasy ally", trust_level: 4, respect_level: 3, perceived_threat: 3, ideological_alignment: 6, dependency_level: 4, recent_interactions: [] },
            "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "political enemy", trust_level: -8, respect_level: -7, perceived_threat: 9, ideological_alignment: -9, dependency_level: 0, recent_interactions: [] },
            "roman_senate": { entity_id: "roman_senate", relationship_type: "leader", trust_level: 9, respect_level: 9, perceived_threat: 0, ideological_alignment: 9, dependency_level: 2, recent_interactions: [] },
            "praetorian_guard": { entity_id: "praetorian_guard", relationship_type: "tool", trust_level: -2, respect_level: -4, perceived_threat: 7, ideological_alignment: -5, dependency_level: 0, recent_interactions: [] },
            "julia_mamaea": { entity_id: "julia_mamaea", relationship_type: "rival", trust_level: -3, respect_level: 2, perceived_threat: 6, ideological_alignment: 3, dependency_level: 0, recent_interactions: [] }
        },
        memories: [],
        resources: { denarii: 250000, senatorial_support: 80, deep_analyses: 2, investigations: 2 },
        visibility_network: ["severus_alexander", "maximinus_thrax", "praetorian_guard", "roman_senate", "julia_mamaea", "military_cabal"]
    },
    {
        entity_id: "lycinia_stolo", name: "Lycinia Stolo", entity_type: "individual", status: "alive", position: "Informant Broker", location: "The Suburra",
        // 4C.5: epithet echoes her scheme, "The Vulture's Feast".
        voice: "low, quick trader's whisper; every fact weighed, priced, sold twice",
        epithet: "the Vulture of the Suburra",
        personality: { ambition: 6, paranoia: 8, loyalty: 2, cunning: 9, honor: 1 },
        beliefs: ["Information is the only true currency", "Loyalty is for fools; survival is everything", "Chaos is a ladder"],
        secrets: ["Knows the identity of a traitor in the Senate", "Has blackmail material on a Praetorian officer"],
        skills: { oratory: 5, administration: 6, strategy: 5, intrigue: 10 },
        short_term_goals: ["Profit from the current instability", "Sell information to all sides"],
        long_term_ambitions: ["Control the flow of information in Rome", "Achieve wealth and security"],
        active_scheme: {
            name: "The Vulture's Feast",
            overall_goal: "Amass a vast personal fortune by exploiting the political instability.",
            steps: [
                { objective: "Infiltrate agents into both the imperial court and military camps.", status: 'in_progress' },
                { objective: "Sell incriminating information on one faction to another.", status: 'in_progress' },
                { objective: "Acquire land and assets from disgraced officials at a low price.", status: 'pending' }
            ]
        },
        current_state_narrative: "From a dusty office in the Suburra, you command a network of spies, trading in the secrets that are the true currency of Rome. The current crisis is a golden opportunity. You are loyal only to yourself.",
        relationships: {
            "severus_alexander": { entity_id: "severus_alexander", relationship_type: "potential client", trust_level: 0, respect_level: 1, recent_interactions: [] },
            "maximinus_thrax": { entity_id: "maximinus_thrax", relationship_type: "potential client", trust_level: 0, respect_level: 2, recent_interactions: [] },
            "praetorian_guard": { entity_id: "praetorian_guard", relationship_type: "source/client", trust_level: 1, respect_level: 0, recent_interactions: [] },
            "julia_mamaea": { entity_id: "julia_mamaea", relationship_type: "wary client", trust_level: -1, respect_level: 4, recent_interactions: [] }
        },
        memories: [],
        resources: { denarii: 20000, deep_analyses: 6, investigations: 5 },
        visibility_network: ["severus_alexander", "maximinus_thrax", "praetorian_guard", "roman_senate", "julia_mamaea", "senatorial_party", "military_cabal"]
    }
];

export const ALL_INITIAL_ENTITIES: Entity[] = [...FACTIONS_INITIAL, ...ROME_INITIAL_STATE];

export const INITIAL_WORLD_STATE: WorldState = {
    year: 235, 
    week: 1, 
    economic_stability: 'Stable', 
    political_climate: 'Volatile',
    regions: {
        'Palatine Hill': { stability: 'Tense', controlling_faction: 'severus_alexander', current_events: ["The Emperor is isolated, protected by his personal guard."] },
        'The Curia': { stability: 'Unrest', controlling_faction: 'senatorial_party', current_events: ["The Senate is in a state of panic, debating how to respond to Maximinus Thrax."] },
        'Praetorian Camp': { stability: 'Wavering', controlling_faction: 'military_cabal', current_events: ["Maximinus Thrax courts the Praetorian Guard with promises of gold.", "The Guard's loyalty to the Emperor is near breaking point."] },
        'The Suburra': { stability: 'Stable', controlling_faction: null, current_events: ["The common people are wary, and whispers of change are everywhere."] },
    } 
};

export const INITIAL_SIMULATION_STATE: SimulationState = {
  imperial_status: 'Stable',
  senate_status: 'Functional',
  military_status: 'Divided',
  plebeian_mood: 'Uneasy',
  major_ongoing_crisis: null,
};