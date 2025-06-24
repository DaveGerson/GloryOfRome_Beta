# roman_crisis_simulation/src/tests/fixtures/turn_one_data.py
# This file contains functions to generate the initial game state for Turn 1.
# It can be used by both the unit tests and the main simulation to ensure consistency.

from ...models.entity import IndividualEntity, GroupEntity, LocationEntity
from ...models.edges import Relationship, Obligation
from ...models.supporting import PersonalityTrait, SocialRelationship


def _generate_individual_entities():
    """Creates and returns a dictionary of individual entities."""
    return {
        "player_character": IndividualEntity(
            id="char_player",
            name="Gaius Verres",
            description="Gaius Verres is a 'novus homo'—a new man—the first in his family to enter the Senate. This makes him an object of scorn for the old aristocratic families. He is driven by a burning ambition to establish a legacy and prove that he is the equal of any blue-blooded patrician. He is sharp-witted, silver-tongued in the Forum, and possesses a keen understanding of Roman law, but his relative lack of ancestral connections (dignitas) and wealth makes his position precarious. He must navigate the treacherous currents of Roman politics through sheer cunning and force of will.",
            personality=[
                PersonalityTrait(
                    name="Ambitious",
                    description="Verres possesses a relentless drive to ascend the Cursus Honorum. His ambition is not just for power, but for recognition and the establishment of a lasting family legacy. He is willing to take calculated risks and make powerful enemies to achieve his goals.",
                    reason="As a 'novus homo', he feels he has to work twice as hard to earn the respect that is given freely to patricians. His ambition is a direct response to the condescension he faces from the established elite."
                ),
                PersonalityTrait(
                    name="Pragmatic",
                    description="He is not bound by the rigid traditions that constrain many of his peers. Verres is a political realist who evaluates situations based on their potential outcomes rather than on ideology. This allows him to form unconventional alliances and consider solutions that others might dismiss as improper.",
                    reason="His family's background in commerce rather than land-owning aristocracy has instilled in him a practical, results-oriented worldview."
                )
            ],
            location="loc_rome"
        ),
        "rival_senator": IndividualEntity(
            id="char_rival",
            name="Marcus Porcius Cato",
            description="Often called Cato the Younger, he is the embodiment of traditional Roman virtues and the unofficial leader of the Optimates faction. He is a stern, unyielding defender of the 'Mos Maiorum' (the ways of the ancestors) and sees the Republic's salvation in a return to old-fashioned morality and discipline. He views ambitious new men like Gaius Verres with deep suspicion, seeing them as opportunists who threaten to corrupt the state for personal gain. While respected for his incorruptibility, his rigid principles and abrasive demeanor make him a difficult ally and a formidable foe.",
            personality=[
                PersonalityTrait(
                    name="Inflexible",
                    description="Cato's commitment to his principles is absolute and he is utterly unwilling to compromise. He views any deviation from traditional Roman virtue as a step towards tyranny. This makes him predictable, but also politically isolated at times.",
                    reason="He is the great-grandson of Cato the Elder, and feels the immense weight of his ancestry to be a bulwark against what he sees as the moral decay of the Republic."
                ),
                PersonalityTrait(
                    name="Austere",
                    description="He lives a life of stoic simplicity, shunning the luxury and decadence common among the Roman elite. This austerity is both a personal conviction and a public statement, reinforcing his image as an incorruptible guardian of the old ways.",
                    reason="His study of Stoic philosophy has profoundly shaped his belief that virtue, not pleasure or wealth, is the only true good."
                )
            ],
            location="loc_rome"
        ),
        "powerful_general": IndividualEntity(
            id="char_general",
            name="Pompeius Magnus",
            description="Pompey the Great. A military genius who has celebrated multiple triumphs and expanded Rome's borders. His successes have brought him immense wealth and, more importantly, the unwavering loyalty of his veteran legions, who depend on him for land grants and pensions. He exists outside the traditional political structure, a colossus whose power dwarfs that of any single senator. He is politically pragmatic, often aligning with whomever can best serve his interests. His presence in Gaul with a battle-hardened army is a constant, unspoken threat to the Senate's authority.",
            personality=[
                PersonalityTrait(
                    name="Vain",
                    description="Pompey has an immense appetite for public adulation and grand titles. He craves being seen as the first man in Rome and is sensitive to any perceived slight to his 'dignitas'. His political decisions are often influenced by how they will be perceived by the public and recorded by history.",
                    reason="Having achieved unparalleled military success at a young age, he has grown accustomed to being celebrated and believes in his own exceptionalism."
                ),
                PersonalityTrait(
                    name="Politically Adept",
                    description="Despite being a military man, Pompey is a shrewd political operator. He understands the importance of public image, patronage, and leveraging his military power for political ends without overtly threatening the Republic's institutions. He often appears to be above the fray, making him all the more effective.",
                    reason="Years of negotiating with the Senate for triumphs, land for his veterans, and provincial commands have taught him how to navigate the complexities of Roman politics."
                )
            ],
            location="loc_gaul"
        ),
    }


def _generate_group_entities():
    """Creates and returns a dictionary of group entities."""
    return {
        "senate": GroupEntity(
            id="group_senate",
            name="The Roman Senate",
            description="The venerable and powerful Roman Senate, the cornerstone of the Republic's political life. In theory, it is a council of the most experienced and respected men in Rome, guiding the state with wisdom. In practice, it is a viper's nest of competing factions, primarily the conservative 'Optimates' who seek to preserve the power of the aristocracy, and the 'Populares' who use the assemblies of the people to advance their own agendas. The Senate's authority, while immense, is increasingly challenged by powerful generals and the restless populace."
        ),
        "equestrians": GroupEntity(
            id="group_equestrians",
            name="The Equestrian Order",
            description="The Equestrian Order represents the burgeoning business class of Rome. They are the publicans, bankers, merchants, and tax collectors whose wealth often rivals that of the senatorial elite. Barred from holding the highest political offices, their influence is primarily economic. They are a pragmatic and ambitious group, often clashing with the Senate over provincial contracts and financial policies. They are a potent, if often overlooked, force in Roman politics, capable of bankrolling a candidate or causing a financial crisis."
        ),
        "plebeians": GroupEntity(
            id="group_plebeians",
            name="The Plebeian Council",
            description="The 'Concilium Plebis' or Plebeian Council is the principal assembly of the common people of Rome. While its legislative power has waxed and waned, it remains a volatile and powerful expression of the popular will. It can pass laws, elect tribunes, and hold trials. The urban plebs are a diverse group, from shopkeepers and artisans to the unemployed masses. Their mood is fickle; they can be swayed by cheap grain, grand games, or the fiery rhetoric of a charismatic leader, making them a dangerous and unpredictable element in the political landscape."
        ),
    }


def _generate_location_entities():
    """Creates and returns a dictionary of location entities."""
    return {
        "rome": LocationEntity(
            id="loc_rome",
            name="Rome",
            description="The magnificent and chaotic heart of the Roman Republic. A city of stark contrasts, where the marble temples of the Forum and the luxurious villas on the Palatine Hill stand in sharp contrast to the squalid, crowded tenements of the Subura. It is the center of all political, legal, and economic activity. The air itself seems thick with rumor, ambition, and the potential for both glorious advancement and sudden, brutal downfall."
        ),
        "gaul": LocationEntity(
            id="loc_gaul",
            name="Cisalpine Gaul",
            description="A vast and recently pacified province to the north of Italy. It is incredibly wealthy, a land of fertile fields, rich mines, and strategic trade routes. Crucially, it is the command center for Pompeius Magnus and his legions. The province serves as his personal power base, providing him with a nearly inexhaustible supply of resources and recruits, far from the direct oversight of the Senate in Rome."
        )
    }


def generate_turn_one_entities():
    """
    Creates and returns a dictionary of all entities for the start of the simulation.
    The descriptions are intentionally verbose to provide rich context for the AI.
    """
    entities = {}
    entities.update(_generate_individual_entities())
    entities.update(_generate_group_entities())
    entities.update(_generate_location_entities())
    return entities


def generate_turn_one_edges(entities):
    """
    Creates and returns a list of all edges (relationships, obligations) for Turn 1.
    Requires the entities dictionary to link edges correctly.
    """
    player_id = entities["player_character"].id
    rival_id = entities["rival_senator"].id
    general_id = entities["powerful_general"].id
    senate_id = entities["senate"].id

    edges = [
        # === Relationships between Individuals ===
        Relationship(
            source=player_id,
            target=rival_id,
            description=f"A deep and abiding political and ideological rivalry exists between {entities['player_character'].name} and {entities['rival_senator'].name}. Cato sees Verres as a dangerous upstart, while Verres views Cato as an obstacle to progress and his own ambition. Their clashes in the Senate are frequent and often personal, defining the central political conflict of the Optimates and Populares factions.",
            relationship_type="rivalry",
            social_relationship=SocialRelationship(familiarity=0.6, trust=-0.7, respect=0.4)
            # They know each other well, don't trust each other, but must respect the other's power.
        ),
        Relationship(
            source=player_id,
            target=general_id,
            description=f"{entities['player_character'].name} has a distant but significant relationship with {entities['powerful_general'].name}. Like many senators, Verres sees Pompey as a potential kingmaker and a necessary, if dangerous, political tool. He admires Pompey's military achievements but fears his ultimate ambition. Securing Pompey's favor could be the key to power, but it could also come at a terrible price to the Republic.",
            relationship_type="political_alliance_potential",
            social_relationship=SocialRelationship(familiarity=0.2, trust=0.1, respect=0.9)
            # They are not close, but the respect for Pompey's power is immense.
        ),

        # === Obligations ===
        Obligation(
            source=player_id,
            target=senate_id,
            description="As a senator of the Roman Republic, Gaius Verres has a sworn duty to participate in the governance of the state. This includes attending senate meetings, voting on legislation, respecting the veto of the Tribunes, and upholding the 'Mos Maiorum'. To neglect this duty is to risk being branded as a rogue or a tyrant by his political enemies.",
            obligation_type="sworn_duty",
            magnitude=0.8
        ),
        Obligation(
            source=rival_id,
            target=player_id,
            description=f"During a recent, contentious trial in the Forum, {entities['player_character'].name} delivered a stirring speech that swayed the jury to acquit a kinsman of {entities['rival_senator'].name}. While Cato would never admit it publicly, he owes Verres a significant political favor. This debt is a source of private shame for Cato and a potential political weapon for Verres.",
            obligation_type="political_favor",
            magnitude=-0.4  # A substantial favor owed by Cato TO Verres.
        )
    ]
    return edges
