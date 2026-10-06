export const MINERAL_RULE_VERSION = 'geoeye-mineral-systems-1.0.0'
export const MINERAL_COMPONENTS = ['Source', 'Driver', 'Pathway', 'Focusing', 'Trap', 'Preservation'] as const
export type MineralComponent = typeof MINERAL_COMPONENTS[number]

export interface MineralCriterion {
  id: string
  label: string
  component: MineralComponent
  group: string
  element?: string
  threshold?: number
  tokens?: string[]
  work: string
  cost: number
}

const chemical = (id: string, label: string, element: string, threshold: number): MineralCriterion => ({
  id, label, element, threshold, component: 'Trap', group: 'geochemistry',
  work: `Confirm ${element} enrichment with QA/QC laboratory assays and local background populations.`, cost: 2,
})
const geological = (id: string, label: string, component: MineralComponent, group: string, tokens: string[], work: string, cost = 3): MineralCriterion => ({ id, label, component, group, tokens, work, cost })

/** Starter signatures, not calibrated classifiers. Thresholds are user-reviewable screening values in ppm. */
export const MINERAL_CRITERIA: readonly MineralCriterion[] = [
  chemical('cu', 'Copper enrichment', 'Cu', 1000), chemical('mo', 'Molybdenum enrichment', 'Mo', 50),
  chemical('au', 'Gold enrichment', 'Au', 0.1), chemical('ag', 'Silver enrichment', 'Ag', 5),
  chemical('as', 'Arsenic enrichment', 'As', 100), chemical('sb', 'Antimony enrichment', 'Sb', 10),
  chemical('pb', 'Lead enrichment', 'Pb', 1000), chemical('zn', 'Zinc enrichment', 'Zn', 1000),
  chemical('ni', 'Nickel enrichment', 'Ni', 1000), chemical('co', 'Cobalt enrichment', 'Co', 100),
  chemical('li', 'Lithium enrichment', 'Li', 100), chemical('ta', 'Tantalum enrichment', 'Ta', 20),
  chemical('u', 'Uranium enrichment', 'U', 50), chemical('pge', 'Platinum enrichment', 'Pt', 0.1),
  geological('felsic', 'Felsic / intermediate intrusion', 'Source', 'host', ['granite', 'granodiorite', 'diorite', 'felsic intrusion', 'porphyry'], 'Map intrusive contacts; verify petrography and timing.'),
  geological('mafic', 'Mafic / ultramafic host', 'Source', 'host', ['gabbro', 'peridotite', 'ultramafic', 'mafic intrusion'], 'Verify mafic host, intrusive geometry, and sulfide textures.'),
  geological('komatiite', 'Komatiitic host', 'Source', 'host', ['komatiite', 'komatiitic'], 'Verify volcanic facies and basal sulfide geometry.'),
  geological('volcanic', 'Volcanic host', 'Source', 'host', ['volcanic', 'rhyolite', 'andesite', 'dacite', 'tuff'], 'Map volcanic stratigraphy and hydrothermal timing.'),
  geological('sediment', 'Sedimentary basin host', 'Source', 'host', ['sandstone', 'siltstone', 'shale', 'sedimentary'], 'Map stratigraphy, basin history, and redox boundaries.'),
  geological('carbonate', 'Carbonate host', 'Source', 'host', ['limestone', 'dolomite', 'carbonate', 'marble'], 'Map carbonate horizons and replacement fronts.'),
  geological('metamorphic', 'Metamorphic host', 'Source', 'host', ['schist', 'gneiss', 'metamorphic', 'greenstone'], 'Map metamorphic grade and deformation history.'),
  geological('pegmatite', 'Pegmatite host', 'Source', 'host', ['pegmatite', 'pegmatitic'], 'Map zonation and verify lithium-bearing mineralogy.'),
  geological('heat', 'Magmatic heat / fluid evidence', 'Driver', 'timing', ['magmatic fluid', 'magmatic heat', 'magmatic-hydrothermal'], 'Test geochronology, fluid inclusions, and isotope constraints.', 4),
  geological('basin-fluid', 'Basinal fluid evidence', 'Driver', 'timing', ['basinal fluid', 'basinal brine'], 'Test fluid salinity and basin-fluid timing.', 4),
  geological('metamorphic-fluid', 'Metamorphic fluid evidence', 'Driver', 'timing', ['metamorphic fluid'], 'Test fluid inclusions and deformation / mineralization timing.', 4),
  geological('fault', 'Fault / shear pathway', 'Pathway', 'structure', ['fault', 'shear', 'fracture zone'], 'Map continuity and permeability of faults and shears.', 2),
  geological('stockwork', 'Quartz stockwork', 'Focusing', 'veining', ['stockwork', 'quartz veinlet'], 'Log vein density, crosscutting relations, and mineral assemblages.', 2),
  geological('intersection', 'Structural intersection', 'Focusing', 'structure', ['structural intersection', 'fault intersection'], 'Validate fault intersections in sections and oriented core.', 2),
  geological('replacement', 'Replacement texture', 'Focusing', 'texture', ['replacement', 'replaced'], 'Verify replacement fronts in core and thin sections.', 2),
  geological('stratiform', 'Stratiform / stratabound geometry', 'Focusing', 'geometry', ['stratiform', 'stratabound'], 'Test continuity against stratigraphy in sections.', 3),
  geological('potassic', 'Potassic alteration', 'Trap', 'alteration', ['potassic', 'k-feldspar', 'potassium feldspar', 'secondary biotite'], 'Verify potassic assemblages with petrography and mineral identification.', 2),
  geological('adularia', 'Adularia assemblage', 'Trap', 'alteration', ['adularia'], 'Confirm adularia with XRD / petrography and spectral context.', 2),
  geological('alunite', 'Alunite / advanced argillic assemblage', 'Trap', 'alteration', ['alunite', 'pyrophyllite', 'advanced argillic'], 'Validate spectral mineral identification and acid alteration paragenesis.', 2),
  geological('illite', 'Illite / sericite assemblage', 'Trap', 'alteration', ['illite', 'sericite', 'muscovite'], 'Validate mineral identification and alteration zonation.', 2),
  geological('iron-oxide', 'Hydrothermal iron oxides', 'Trap', 'alteration', ['hydrothermal magnetite', 'hydrothermal hematite', 'iron oxide alteration'], 'Verify hydrothermal origin and timing of iron oxides.', 2),
  geological('calc-silicate', 'Calc-silicate assemblage', 'Trap', 'alteration', ['garnet', 'pyroxene', 'wollastonite', 'skarn'], 'Verify calc-silicate mineralogy and intrusive contact relations.', 2),
  geological('chlorite', 'Chlorite assemblage', 'Trap', 'alteration', ['chlorite', 'chloritic'], 'Validate spectral mineral identification and alteration zonation.', 2),
  geological('redox', 'Redox boundary / reduced trap', 'Trap', 'redox', ['redox boundary', 'reduced horizon', 'carbonaceous', 'graphitic'], 'Map oxidation state and reduced horizons.', 2),
  geological('boiling', 'Boiling / open-space textures', 'Trap', 'texture', ['boiling', 'bladed calcite', 'crustiform', 'colloform'], 'Test textures and fluid inclusions for boiling.', 3),
  geological('unconformity', 'Unconformity relationship', 'Focusing', 'geometry', ['unconformity', 'unconformable'], 'Validate unconformity geometry and mineralization timing.', 3),
  geological('preserved', 'Preserved mineralized level', 'Preservation', 'preservation', ['preserved mineralized level', 'preserved ore horizon'], 'Constrain erosion level, cover, and post-mineral deformation.', 3),
]

export interface MineralSystemModel { id: string; label: string; criteria: Array<{ id: string; weight: number }>; reference: string }
const general = 'https://pubs.usgs.gov/bul/b1693/'
const porphyry = 'https://pubs.usgs.gov/sir/2010/5070/b/pdf/SIR10-5070B.pdf'
const epithermal = 'https://pubs.usgs.gov/sir/2010/5070/q/sir20105070q.pdf'
const model = (id: string, label: string, criteria: string[], reference = general): MineralSystemModel => ({
  id, label, reference, criteria: [...criteria, 'preserved'].map(key => ({ id: key, weight: MINERAL_CRITERIA.find(c => c.id === key)?.component === 'Trap' ? 1.5 : key === 'preserved' ? 0.4 : 0.8 })),
})
export const MINERAL_SYSTEM_MODELS: readonly MineralSystemModel[] = [
  model('porphyry', 'Porphyry Cu–Au–Mo', ['felsic', 'heat', 'fault', 'stockwork', 'intersection', 'potassic', 'cu', 'mo', 'au'], porphyry),
  model('epithermal-ls', 'Epithermal LS', ['volcanic', 'heat', 'fault', 'adularia', 'illite', 'boiling', 'au', 'ag'], epithermal),
  model('epithermal-hs', 'Epithermal HS', ['volcanic', 'heat', 'fault', 'alunite', 'au', 'cu', 'as'], epithermal),
  model('epithermal-is', 'Epithermal IS', ['volcanic', 'heat', 'fault', 'illite', 'au', 'ag', 'pb', 'zn'], epithermal),
  model('iocg', 'IOCG', ['felsic', 'heat', 'fault', 'intersection', 'iron-oxide', 'cu', 'au']),
  model('intrusion-au', 'Intrusion-related Au', ['felsic', 'heat', 'fault', 'stockwork', 'au', 'as']),
  model('orogenic-au', 'Orogenic Au', ['metamorphic', 'metamorphic-fluid', 'fault', 'intersection', 'au', 'as', 'sb']),
  model('sediment-cu', 'Sediment-hosted Cu', ['sediment', 'basin-fluid', 'fault', 'stratiform', 'redox', 'cu']),
  model('skarn', 'Skarn', ['felsic', 'carbonate', 'heat', 'replacement', 'calc-silicate', 'cu', 'au']),
  model('vms', 'VMS', ['volcanic', 'heat', 'fault', 'stratiform', 'chlorite', 'cu', 'zn', 'pb']),
  model('lct', 'LCT pegmatite', ['pegmatite', 'heat', 'fault', 'li', 'ta']),
  model('magmatic-ni', 'Ni–Cu–PGE magmatic', ['mafic', 'heat', 'fault', 'ni', 'cu', 'co', 'pge']),
  model('mvt', 'MVT', ['carbonate', 'basin-fluid', 'fault', 'replacement', 'pb', 'zn']),
  model('sedex', 'SEDEX', ['sediment', 'basin-fluid', 'fault', 'stratiform', 'redox', 'pb', 'zn']),
  model('uranium', 'Uranium unconformity', ['sediment', 'basin-fluid', 'fault', 'unconformity', 'redox', 'u']),
  model('komatiite-ni', 'Komatiite Ni', ['komatiite', 'heat', 'stratiform', 'ni', 'cu', 'co']),
]
