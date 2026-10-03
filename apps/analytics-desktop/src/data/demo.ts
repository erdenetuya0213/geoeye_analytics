export const projectMetrics = [
  { label: 'Drillholes', value: '18', detail: '3 active', trend: '+2 this week', tone: 'teal' },
  { label: 'Metres logged', value: '4,862', detail: 'of 5,240 m', trend: '92.8% coverage', tone: 'navy' },
  { label: 'Structures', value: '1,284', detail: '42 flagged', trend: '+186 projected', tone: 'amber' },
  { label: 'Data quality', value: '94.6%', detail: 'accepted', trend: '+1.8% this week', tone: 'green' },
] as const

export const datasets = [
  {
    name: 'Structural logging',
    source: 'GeoEye Field',
    kind: 'Orientation',
    records: '1,284',
    freshness: '8 min ago',
    quality: 95,
    color: '#1f7a6e',
  },
  {
    name: 'Drillhole surveys',
    source: 'Data Pool',
    kind: 'Point',
    records: '246',
    freshness: '2 hours ago',
    quality: 100,
    color: '#d18b3e',
  },
  {
    name: 'Gold assays',
    source: 'ALS Laboratory',
    kind: 'Interval',
    records: '3,612',
    freshness: 'Yesterday',
    quality: 92,
    color: '#715f91',
  },
  {
    name: 'Geotechnical logging',
    source: 'GeoEye Field',
    kind: 'Interval',
    records: '864',
    freshness: 'Yesterday',
    quality: 89,
    color: '#4c7085',
  },
] as const

export const drillholes = [
  { id: 'GOR-DD-018', depth: 412.6, logged: 412.6, structures: 148, collar: 'Validated', survey: 'Validated', status: 'Complete' },
  { id: 'GOR-DD-017', depth: 368.2, logged: 351.4, structures: 126, collar: 'Validated', survey: 'Review', status: 'In progress' },
  { id: 'GOR-DD-016', depth: 295.8, logged: 295.8, structures: 94, collar: 'Validated', survey: 'Validated', status: 'Complete' },
  { id: 'GOR-DD-015', depth: 524.1, logged: 487.5, structures: 173, collar: 'Validated', survey: 'Validated', status: 'In progress' },
  { id: 'GOR-DD-014', depth: 306.4, logged: 306.4, structures: 88, collar: 'Review', survey: 'Validated', status: 'Complete' },
  { id: 'GOR-DD-013', depth: 278.9, logged: 278.9, structures: 77, collar: 'Validated', survey: 'Validated', status: 'Complete' },
  { id: 'GOR-DD-012', depth: 445.3, logged: 445.3, structures: 139, collar: 'Validated', survey: 'Validated', status: 'Complete' },
] as const

export const activities = [
  { title: 'Structural projection updated', meta: '186 observations · 8 min ago', kind: 'sync' },
  { title: 'GOR-DD-018 logging accepted', meta: 'M. Enkhbayar · 34 min ago', kind: 'check' },
  { title: 'Survey QA requires review', meta: 'GOR-DD-017 · 2 hours ago', kind: 'alert' },
  { title: 'Assay dataset v4 registered', meta: 'ALS Laboratory · Yesterday', kind: 'data' },
] as const

export const jointSets = [
  { id: 'J1', label: 'NE steep', count: 428, dip: '74°', direction: '046°', color: '#d0783f' },
  { id: 'J2', label: 'NW moderate', count: 316, dip: '48°', direction: '314°', color: '#347f79' },
  { id: 'J3', label: 'E shallow', count: 194, dip: '24°', direction: '094°', color: '#76639a' },
  { id: 'U', label: 'Unassigned', count: 82, dip: '—', direction: '—', color: '#9ba39f' },
] as const

export const stereonetPoints = [
  [43, 20, 0], [48, 25, 0], [52, 21, 0], [46, 30, 0], [55, 27, 0], [40, 28, 0],
  [62, 68, 1], [67, 73, 1], [58, 76, 1], [72, 66, 1], [64, 80, 1], [76, 72, 1],
  [74, 42, 2], [80, 47, 2], [69, 48, 2], [76, 53, 2], [83, 39, 2], [71, 37, 2],
  [26, 62, 3], [34, 72, 3], [22, 45, 3], [50, 55, 3], [38, 48, 3], [57, 39, 3],
] as const
