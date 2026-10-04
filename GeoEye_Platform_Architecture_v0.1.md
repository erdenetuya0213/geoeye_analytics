# GeoEye Platform Architecture

**Document version:** v0.1  
**Status:** Architecture baseline for implementation  
**Primary scope:** GeoEye Data Pool, GeoEye Field, GeoEye Analytics, CaptorStudio, external integrations, cloud/on-prem deployment

---

## 1. Purpose

GeoEye should operate as a shared geological data platform composed of specialized applications, rather than as one application owning all project data.

The platform has four main roles:

- **CaptorStudio** — acquire
- **GeoEye Field** — observe and log
- **GeoEye Analytics** — analyse and derive
- **External modelling tools** — model

All applications interact through the **GeoEye Data Pool**.

The Data Pool is **not another database**. It is the central data authority built around the existing PostgreSQL/PostGIS environment, object storage, shared definitions, integration rules, provenance, synchronization, and stable APIs.

---

## 2. Core Architecture Principle

```text
                       GEOEYE DATA POOL
                  Central Data Authority
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
       CAPTORSTUDIO   GEOEYE FIELD   GEOEYE ANALYTICS
       acquisition       logging         analysis
```

Applications do not own the whole database.

Instead:

```text
Data Pool        owns shared project/data definitions
Field            owns primary geological observations
Analytics        owns derived analytical information
External systems own their source processing
```

---

## 3. System Context

```text
                                      ┌─────────────────────┐
                                      │ Vulcan / Leapfrog   │
                                      │ Datamine / etc.     │
                                      └──────────▲──────────┘
                                                 │
                                           model inputs
                                                 │
┌──────────────┐      ┌──────────────────────────┴───────────┐
│ CaptorStudio │      │          GEOEYE ANALYTICS           │
│              │      │                                     │
│ acquisition  │      │ EDA / Domain / Grade / Variography  │
│ camera       │      │ Structure / Geotech / Multivariate  │
└──────┬───────┘      │ 2D / 3D                             │
       │              └──────────────────▲──────────────────┘
       │                                 │
       ▼                                 │
┌─────────────────────┐                  │
│    GEOEYE FIELD     │                  │
│                     │                  │
│ Vision auto logging │                  │
│ Core strip          │                  │
│ DataLab             │                  │
│ Data integration    │                  │
└──────────┬──────────┘                  │
           │                             │
           └──────────────┬──────────────┘
                          ▼
              ╔═══════════════════════╗
              ║   GEOEYE DATA POOL   ║
              ║                       ║
              ║ PostgreSQL/PostGIS    ║
              ║ Object Storage        ║
              ║ Dataset Registry      ║
              ║ Variable Registry     ║
              ║ Rules / Dictionaries  ║
              ║ Provenance            ║
              ║ Sync                  ║
              ╚═══════════════════════╝
```

---

## 4. Application Responsibilities

### 4.1 CaptorStudio

CaptorStudio is the acquisition application.

Responsibilities:

- Camera connection
- Lighting
- Encoder
- Scanner control
- Image capture
- Raw file management
- Capture metadata
- Local host filesystem management

Its authoritative raw capture files remain on the host filesystem.

GeoEye Field consumes CaptorStudio output.

CaptorStudio does not perform geological interpretation.

---

### 4.2 GeoEye Field

GeoEye Field remains the **vision-based objective logging application**.

The existing PWA UI should remain intact.

Responsibilities:

- Image Registry
- Core row processing
- Clean rock-strip generation
- Vision-based logging
- Lithology
- Alteration
- Mineralisation
- Structure
- Geotechnical observations
- RQD and fractures
- Human review
- Strip log
- DataLab
- External data ingestion and visualization

Field primarily produces **primary observations**.

Examples:

```text
Feature depth
Alpha
Beta
Aperture
Persistence
Roughness
Weathering
Lithology
RQD
Alteration
```

Field should not be responsible for producing higher-level analytical results merely because Analytics requires them.

---

## 5. DataLab Position

The current GeoEye Field **DataLab UI remains as-is**.

Its database-backed configuration — including templates, dictionaries, rules, catalog, and integration configuration — should be treated as **shared GeoEye configuration**, even though Field currently provides the editing UI.

```text
Field DataLab UI
       │
       │ edits
       ▼
Shared Data Pool configuration
       │
       ├────────► Field
       └────────► Analytics
```

### Architecture rule

> **Editable from GeoEye Field does not mean owned by GeoEye Field.**

---

## 6. GeoEye Data Pool

### Definition

> **GeoEye Data Pool is the central project data authority governing common definitions, integration, relationships, provenance, synchronization, and access across GeoEye applications.**

It consists of:

```text
Existing PostgreSQL/PostGIS
+
Object storage
+
Dataset registry
+
Variable registry
+
Shared configuration
+
Integration contracts
+
Provenance
+
Synchronization
+
Stable APIs
```

It is not a second PostgreSQL database.

---

## 7. Data Ownership Model

Use three principal information classes.

### A. Primary / Observed

Normally produced by GeoEye Field or external measurements.

Examples:

```text
Alpha
Beta
Aperture
Roughness
Lithology
RQD
Assay Au
XRF Cu
UCS
LAS Gamma
```

### B. Derived

Produced algorithmically by GeoEye Analytics.

Examples:

```text
True dip
True dip direction
J1 / J2 / J3 membership
RMR76
RMR89
Composites
Declustering weights
PCA scores
Clusters
Variogram parameters
```

### C. Interpreted / Accepted

Professional analytical decisions.

Examples:

```text
Structural domain
Rock mass domain
Estimation domain
Accepted top cut
Accepted variogram model
Selected modelling parameters
```

Conceptually:

```text
OBSERVE             DERIVE             INTERPRET
Field/Integration → Analytics → Geologist/Engineer
```

Primary data must never be overwritten by derived interpretation.

---

## 8. Existing PostgreSQL Strategy

Do **not** perform a large physical schema migration immediately.

Keep the existing `public.*` tables and foreign-key structure.

The first separation should be **logical**, implemented through services, contracts, data ownership rules, and APIs.

Physical PostgreSQL schemas such as `field.*` and `analytics.*` can be considered later if there is a clear migration benefit.

---

## 9. Logical Data Domains

Classify existing and new tables logically as follows.

### Shared

```text
projects
drill_holes
templates
dictionaries
rules
users
organizations
coordinate systems
variable definitions
datasets
dataset versions
```

### Field

```text
core_boxes
core_images
core_rows
logging_intervals
logging_structures
annotations
corrections
row selections
logging workspaces
```

### Integration

```text
LAS
laboratory results
XRF
spectral outputs
external datasets
```

### Analytics

```text
analysis runs
derived values
joint sets
variograms
composites
declustering
domains
RMR results
clusters
model input packages
```

The application code should respect these ownership boundaries even if the physical tables remain in `public`.

---

## 10. Analytical Projection Layer

The current dynamic template system stores significant information in JSONB, for example logging selections.

This is appropriate for a flexible Field logging UI.

It is less suitable as the direct analytical interface for large-scale statistical analysis.

Introduce a normalized analytical projection without replacing the current Field write model.

Example:

```text
observation_values

id
project_id
dataset_id

source_type
source_id

hole_id
depth_from
depth_to

variable_id

numeric_value
text_value
category_value

unit
quality
created_at
```

Example projection:

```text
DISC-001 → structure.alpha      = 38°
DISC-001 → structure.beta       = 126°
DISC-001 → joint.aperture       = 0.2 mm
DISC-001 → joint.roughness      = Rough
```

Architecture:

```text
FIELD WRITE MODEL

logging_structures
selections_json
       │
       ▼
projection/indexing
       │
       ▼
DATA POOL READ MODEL

observation_values
       │
       ▼
Analytics
```

GeoEye Field remains unaffected.

---

## 11. Variable Registry

Introduce a global semantic variable registry.

Examples:

```text
structure.alpha
structure.beta
structure.true_dip
structure.true_dip_direction
structure.joint_set

geotech.rqd
geotech.ucs
geotech.rmr76

assay.au
assay.cu

xrf.fe
xrf.cu

spectral.chlorite_abundance
spectral.white_mica_wavelength
```

Each variable should define:

```text
key
display name
data type
canonical unit

origin:
    primary
    integrated
    derived
    interpreted

spatial support:
    point
    interval
    orientation
    raster
    none

compatible analyses
```

This gives Field and Analytics a common data language without sharing hard-coded table assumptions.

---

## 12. Dataset Registry

Any Field output or external integration can be registered as a dataset.

Example:

```text
Dataset
────────────────────────────

ALS Assays — September 2026

Project:
DMP

Producer:
Laboratory integration

Variables:
Au
Cu
As
Ag

Records:
18,420

Support:
interval

Depth registered:
Yes

XYZ:
Available

Version:
17
```

GeoEye Analytics discovers data through this registry.

It should not need to know how GeoEye Field parsed the original source.

---

## 13. GeoEye Analytics Framework

GeoEye Analytics should be a **desktop-first analytical application**.

Recommended framework:

| Layer | Framework |
|---|---|
| Desktop shell | Electron (sandboxed renderer and narrow preload bridge) |
| Frontend | React + TypeScript |
| Build | Vite |
| Local project DB | SQLite (durable normalized working replica) |
| Analytical file format | Regular JSON/PNG files today; Parquet/Arrow for large columnar workloads |
| Data interchange | Apache Arrow |
| Scientific engine | Python |
| Spatial database | PostgreSQL/PostGIS centrally |
| 2D charts | Apache ECharts 6 through the shared Canvas-first GeoEyeChart wrapper and GeoEye theme |
| 3D | deck.gl + Three.js |
| Maps | MapLibre |
| State | Zustand |
| Server data/cache state | TanStack Query |

### Why desktop-first

Analytics should use:

```text
local CPU
local RAM
GPU
local files
large 3D datasets
durable local project databases and analytical outputs
local laboratory outputs
```

---

## 14. Analytics Navigation

Navigation should be **analysis-driven**, not source-data-driven.

```text
PROJECT
  Data Pool
  Drillholes
      Collars
      Surveys
      Trace QA
  Spatial Reference

ANALYSE
  Explore
  Domain
  Grade
  Spatial Continuity
  Structure
  Geotechnical
  Multivariate

DELIVER
  Model Inputs
  Reports
```

Do not create top-level sections such as:

```text
Assay
SWIR
XRF
RQD
```

Those are variables and sources available to analyses.

---

## 15. Collar and Survey Data

Collar and downhole survey entry should live primarily in the **GeoEye Analytics UI** because these data are essential for spatial interpretation.

However, collar and survey data themselves belong to the shared Data Pool.

Recommended shared entities:

```text
drillhole_collars

id
project_id
hole_id

easting
northing
elevation

latitude
longitude

crs_id

survey_method
accuracy
source

created_at
updated_at
```

```text
drillhole_surveys

id
project_id
hole_id

measured_depth
azimuth
dip

survey_method
tool
accuracy

source
surveyed_at

created_at
updated_at
```

GeoEye Analytics performs desurveying locally.

```text
Collar
+
Survey
+
Measured depth
      │
      ▼
Minimum curvature
      │
      ▼
XYZ
```

---

## 16. Structural Workflow Example

This should be the first end-to-end architecture validation workflow.

GeoEye Field produces:

```text
Hole        UDD-103
Depth       27.73 m
Alpha       38°
Beta        126°
```

Data Pool also contains:

```text
Collar
Downhole survey
```

GeoEye Analytics performs:

```text
Alpha/Beta
    +
Hole orientation
       │
       ▼
True orientation
       │
       ▼
Population analysis
       │
       ▼
Joint set clustering
       │
       ▼
J1 / J2 / J3
```

Analytics writes derived results back without modifying the original Field structure observation.

---

## 17. Analytics Result Model

Introduce a minimum set of analytical result entities.

### `analysis_runs`

```text
id
project_id
analysis_type
algorithm_version
dataset_snapshot
parameters_json
created_by
created_at
status
```

### `derived_values`

```text
id
analysis_run_id
variable_id

source_entity_type
source_entity_id

hole_id
depth_from
depth_to

numeric_value
text_value
category_value

confidence
status
```

### `derivation_inputs`

```text
derived_value_id
source_type
source_id
```

Every result should have explicit lineage.

---

## 18. Result Lifecycle

Analytics results should support:

```text
DRAFT
SAVED
ACCEPTED
SUPERSEDED
```

A geologist can test multiple analytical interpretations without changing primary data.

Only accepted interpretations need to become published Data Pool results or modelling inputs.

---

## 19. Local Analytics Execution

GeoEye Analytics should use local computing resources.

```text
Data Pool
    │
    │ project snapshot
    ▼
LOCAL ANALYTICS WORKSPACE

DuckDB
Parquet
Arrow
    │
    ▼
Python
    │
    ├─ EDA
    ├─ compositing
    ├─ declustering
    ├─ variography
    ├─ structural analysis
    ├─ geotechnical analysis
    ├─ domain analysis
    └─ multivariate analysis
```

Do not transfer very large tables through JSON.

Prefer:

```text
PostgreSQL → Parquet / Arrow → DuckDB → Python
```

---

## 20. Local Analytics Workspace

The Windows application uses two deliberately separate roots:

```text
%LOCALAPPDATA%/GeoEye/Analytics/       application-private root
├── settings.json                     endpoint, UI, and workspace registry
├── secrets/database-session.bin      Windows-encrypted session material
└── Cache/WebData/                    disposable embedded-browser data

<user-selected folder>/GeoEye/        durable, user-owned data root
├── workspace.json
├── tenants/<tenant>/projects/<project>/
│   ├── project.sqlite                normalized synced data and local work
│   └── objects/                      analysis JSON, PNG, and future large files
├── imports/
├── exports/
└── sync/
```

The selected workspace is not browser cache. It is the durable local working copy and the initial
authority for unpublished local edits and generated analysis results. Shared primary observations remain
authoritative in the Data Pool after synchronization; accepted derived results become shared through the
Data Pool publication workflow.

`project.sqlite` mirrors domain concepts with explicit tables for projects, variables, datasets,
drillholes, collars, surveys, observations, logging, drafts, sync state, analysis runs, lineage, result
packages, and artifact metadata. Pending offline changes are recorded in `sync_journal`. Generated files
are stored as normal files and linked by relative path and SHA-256 checksum.

Only the application-private root may contain credentials. The user-selected workspace must remain
portable and must never contain bearer tokens or database passwords.

---

## 21. Execution Backend Abstraction

Do not hard-wire GeoEye Analytics to local Python only.

Create an execution interface so remote or organization compute can be added later.

Conceptually:

```ts
interface ExecutionBackend {
  submit(job: AnalysisJob): Promise<JobId>
  status(jobId: JobId): Promise<JobStatus>
  cancel(jobId: JobId): Promise<void>
  result(jobId: JobId): Promise<AnalysisResult>
}
```

Initial implementation:

```text
LocalExecutionBackend
```

Future implementations:

```text
RemoteExecutionBackend
ClusterExecutionBackend
```

---

## 22. GeoEye Data Pool Node

Cloud/on-prem portability should be based on a deployable:

# GeoEye Data Pool Node

Components:

```text
PostgreSQL/PostGIS
GeoEye Data API
Object-storage adapter
Synchronization service
Background workers
Schema migrations
```

The same node can run as:

```text
GeoEye Cloud
Mine server
Lab workstation/server
Local development
```

---

## 23. Cloud Deployment

```text
GeoEye Cloud

PostgreSQL/PostGIS
S3-compatible object storage
GeoEye Data API
Sync service
```

---

## 24. On-Prem Deployment

```text
GeoEye Site Node

PostgreSQL/PostGIS
MinIO
GeoEye Data API
Sync service
```

Applications connect to a Data Pool endpoint rather than embedding database topology.

Example:

```text
Cloud:
https://data.geoeye.example

On-prem:
https://geoeye.mine.local

Development:
http://localhost:8080
```

---

## 25. Hybrid Deployment

This is likely the main Astro Geo operating pattern.

```text
             DRILL SITE

CaptorStudio
     │
GeoEye Field
     │
     ▼
 GEOEYE CLOUD
     ▲
     │ sync
     ▼
 GEOEYE SITE NODE
 Lab / Office
     │
     ├── XRF
     ├── Insight Pro outputs
     └── GeoEye Analytics
```

GeoEye Field sends logging information from the drill site.

The laboratory/site node receives synchronized Field information and locally generated XRF/spectral result data.

GeoEye Analytics primarily works against the local node.

---

## 26. XRF Workflow

```text
XRF instrument/software
        │
        ▼
export/result
        │
        ▼
GeoEye Connector
        │
        ▼
LOCAL DATA POOL
        │
        ├──── Field
        └──── Analytics
```

Normalized elemental measurements become Data Pool variables.

Raw instrument files may remain in local or object storage.

---

## 27. Hyperspectral Workflow

GeoEye should **not process hyperspectral cubes**.

Hyperspectral cube processing remains the responsibility of:

**Specim Insight Pro**

Architecture:

```text
Specim FX10 / FX25
        │
        ▼
Raw hyperspectral cube
        │
        ▼
Specim Insight Pro
        │
        ▼
Processed outputs
        │
        ├── mineral classes
        ├── mineral abundance
        ├── spectral indices
        ├── wavelength parameters
        └── processed mineral imagery
                 │
                 ▼
          GeoEye Connector
                 │
                 ▼
              Data Pool
                 │
         ┌───────┴───────┐
         ▼               ▼
       Field          Analytics
```

GeoEye may retain a provenance/reference to the raw cube, but Analytics should normally operate on **Insight Pro outputs**.

---

## 28. Object Storage

Large binaries should not live directly inside PostgreSQL.

Use object storage for:

```text
Core images
Processed strips
LAS source files
Assay certificates
XRF files
Spectral outputs
Mineral maps
Reports
Meshes
Point clouds
```

Cloud:

```text
S3-compatible object storage
```

On-prem:

```text
MinIO
```

Database records should store stable object keys and metadata rather than provider-specific URLs.

---

## 29. Synchronization Strategy

Use three synchronization/storage classes.

### Class A — Always synchronize

```text
Projects
Drillholes
Collars
Surveys
Logging
Assays
XRF numerical outputs
Insight Pro derived results
Templates
Dictionaries
Rules
Accepted Analytics results
```

### Class B — Normal object synchronization

```text
Processed strip imagery
Mineral maps
Reports
Thumbnails
```

### Class C — Policy-controlled

```text
Huge raw imagery
Raw hyperspectral cubes
Point clouds
Large acquisition files
```

---

## 30. API Boundary

Neither application should depend directly on another application's table layout.

Avoid:

```text
Analytics
   ↓
SELECT * FROM logging_structures
```

Prefer:

```text
Analytics
   ↓
Data Pool API
   ↓
Canonical observation/query layer
```

Conceptually:

```ts
dataPool.query({
  projectId,
  variables: [
    "structure.alpha",
    "structure.beta",
    "assay.au",
    "geotech.rqd"
  ]
})
```

This allows Field and Analytics to evolve independently.

---

## 31. Shared vs Application-Specific Data

| Information | Logical owner | Main editing UI |
|---|---|---|
| Project | Data Pool | Field / Analytics |
| Drillhole identity | Data Pool | Analytics / Field |
| Templates | Data Pool | Field DataLab |
| Dictionaries | Data Pool | Field DataLab |
| Rules | Data Pool | Field DataLab |
| Collar | Data Pool | Analytics |
| Survey | Data Pool | Analytics |
| Integrated assay/XRF/LAS | Data Pool | Field Integration |
| Core logging | Field | Field |
| Structural observations | Field | Field |
| True orientation | Analytics | Analytics |
| J1/J2/J3 | Analytics | Analytics |
| RMR | Analytics | Analytics |
| Composite | Analytics | Analytics |
| Variogram | Analytics | Analytics |
| Domains | Analytics | Analytics |
| Modelling inputs | Analytics | Analytics |

---

## 32. Analytics Modules

Initial analytical registry:

### Explore

```text
Summary Statistics
Histogram
CDF
Probability Plot
Scatter
Correlation
Swath
```

### Grade

```text
Compositing
Declustering
Top-Cut Analysis
High-Grade Analysis
Grade-Tonnage
Cutoff Scenarios
```

### Spatial Continuity

```text
Variogram Cloud
Downhole Variogram
Directional Variogram
Variogram Map
Variogram Model
Anisotropy
```

### Structure

```text
Alpha/Beta Conversion
Stereonet
Pole Density
Joint Sets
Orientation Statistics
Structural Domains
```

### Geotechnical

```text
RMR76
RMR89
MRMR
Q System
RQD Analysis
Fracture Frequency
Rock Mass Domains
```

### Multivariate

```text
PCA
Correlation Matrix
Clustering
Feature Relationships
```

### Domain

```text
Population Comparison
Contact Analysis
Boundary Analysis
Stationarity
Domain Statistics
```

---

## 33. Visualization Architecture

Analysis and visualization should be independent.

A single result may support:

```text
Histogram
Probability plot
Scatter
Downhole plot
Stereonet
Rose diagram
Map
3D points
3D drillhole intervals
3D structural discs
Variogram ellipsoid
```

All views should share a common selection state.

```text
Histogram
    ↕
Scatter
    ↕
3D
    ↕
Strip/core
    ↕
Structure
```

Selecting a population or interval in one view should highlight the same observations everywhere.

---

## 34. Analytics 3D

XYZ comes from:

```text
Collar
+
Downhole survey
+
Measured depth
       │
       ▼
Desurvey
       │
       ▼
XYZ
```

3D can visualize:

```text
Drillhole traces
Assays
Lithology
RQD
RMR
Joint sets
Structural observations
Domains
XRF
Spectral-derived minerals
Variogram ellipsoids
```

3D should be an analytical visualization, not only a viewer.

---

## 35. Modelling Boundary

GeoEye Analytics should stop at:

> **Modelling-ready evidence and parameters**

Examples:

```text
Composite length
Top-cut
Declustering
Contact behaviour
Domain statistics

Variogram model
Nugget
Sill
Major range
Semi-major range
Minor range
Orientation

Joint sets
Structural trends

Geotechnical domains
RMR

Spatial data spacing
```

Actual wireframing, geological modelling, block modelling, and resource estimation remain in external modelling packages such as Vulcan, Leapfrog, Datamine, Micromine, and equivalent systems.

---

## 36. Deployment-Neutral Principle

PostgreSQL location must be deployment configuration, not application logic.

```text
                   DATA POOL API

           ┌───────────┼───────────┐
           ▼           ▼           ▼
         CLOUD       ON-PREM     LOCAL DEV

       PostgreSQL   PostgreSQL   PostgreSQL
       S3           MinIO        MinIO/files
```

The following must remain the same everywhere:

```text
schema
migrations
API
variable registry
dataset model
integration contracts
```

---

## 37. Recommended Repository Structure

```text
geoeye/
│
├── apps/
│   ├── field/                       # existing PWA
│   │
│   └── analytics-desktop/
│       ├── src/
│       │   ├── project/
│       │   ├── datapool/
│       │   ├── analyses/
│       │   ├── canvas/
│       │   ├── charts/
│       │   ├── spatial/
│       │   └── three-d/
│       │
│       └── src-tauri/
│
├── packages/
│   ├── geoeye-ui/
│   ├── datapool-client/
│   ├── geoeye-types/
│   ├── variable-registry/
│   └── analysis-contracts/
│
├── services/
│   ├── datapool-api/
│   ├── sync-service/
│   └── integration-connectors/
│
├── analytics-engine/
│   └── geoeye_analytics/
│       ├── statistics/
│       ├── compositing/
│       ├── declustering/
│       ├── variography/
│       ├── structure/
│       ├── geotechnical/
│       ├── domains/
│       ├── multivariate/
│       └── spatial/
│
└── database/
    └── migrations/
```

---

## 38. Development Sequence

```text
PHASE 1
Define Data Pool contracts
Variable Registry
Dataset Registry
Analytical observation projection

        ↓

PHASE 2
Preserve existing Field/DataLab behavior
Expose Field observations through Data Pool API

        ↓

PHASE 3
Add collar + downhole survey model
CRS
Desurvey engine

        ↓

PHASE 4
Build Analytics desktop shell
Tauri + React/Vite
Connect to Data Pool

        ↓

PHASE 5
Local analytical workspace
DuckDB + Parquet + Arrow

        ↓

PHASE 6
Python execution engine
Analysis-run framework

        ↓

PHASE 7
First vertical workflow

Alpha/Beta
→ desurvey
→ true orientation
→ stereonet
→ J1/J2/J3
→ derived_values
→ publish to Data Pool

        ↓

PHASE 8
EDA + Grade

        ↓

PHASE 9
RMR / Geotechnical

        ↓

PHASE 10
Variography / Domain analysis / 3D

        ↓

PHASE 11
Data Pool Site Node
Cloud ↔ on-prem synchronization
XRF / Insight Pro connectors
```

---

## 39. Architecture Rules / ADR Baseline

These should be treated as non-negotiable architecture decisions unless formally revised.

1. **Data Pool is not a second database.**
2. **Do not break or redesign the existing GeoEye Field/DataLab UI.**
3. **Templates, dictionaries, and rules are shared configuration even though Field currently edits them.**
4. **Field owns primary logging observations, not the entire GeoEye database.**
5. **Analytics owns derived analytical results.**
6. **Never overwrite primary observations with derived values.**
7. **Every derived result must have provenance and analysis-run lineage.**
8. **Analytics must consume Data Pool contracts, not Field table internals.**
9. **Use an analytical projection for dynamic JSON-based Field observations.**
10. **Collar/survey are shared Data Pool data; Analytics provides their main editing UI.**
11. **Analytics performs heavy computation locally.**
12. **The user-selected local workspace is durable filesystem storage, never browser cache; server-synced primary data remains authoritative in the Data Pool.**
13. **PostgreSQL/PostGIS remains authoritative structured storage.**
14. **Large objects use S3-compatible storage/MinIO, not PostgreSQL blobs.**
15. **Cloud and on-prem must use the same database model and API contract.**
16. **Hyperspectral cube processing remains in Specim Insight Pro.**
17. **GeoEye consumes Insight Pro outputs rather than duplicating hyperspectral processing.**
18. **Temporary analyses remain local; accepted results can be published to Data Pool.**
19. **2D/3D visualizations must link back to original observations and depth/XYZ.**
20. **GeoEye Analytics ends at modelling-ready evidence and parameters, not geological modelling itself.**
21. **Applications should connect to the Data Pool API rather than depend directly on database topology.**
22. **Cloud/on-prem PostgreSQL selection must be configuration-driven.**
23. **External integrations must register normalized datasets and preserve original source provenance.**
24. **GeoEye Field remains the primary geological observation producer for Analytics, while Data Pool also accepts legitimate external producers such as laboratories, XRF systems, and Specim Insight Pro outputs.**

---

## 40. First Architecture Validation Milestone

The first implementation milestone should prove the complete architecture with one end-to-end workflow:

```text
GeoEye Field
Alpha/Beta observations
        │
        ▼
Data Pool analytical projection
        │
        +
Collar + Survey
        │
        ▼
GeoEye Analytics local workspace
        │
        ▼
Desurvey
        │
        ▼
True orientation
        │
        ▼
Stereonet
        │
        ▼
J1 / J2 / J3
        │
        ▼
Derived result
        │
        ▼
Publish accepted result to Data Pool
        │
        ├────► GeoEye Analytics
        └────► GeoEye Field display if required
```

If this works cleanly while the existing GeoEye Field PWA remains unchanged, the core GeoEye platform architecture is validated.

---

## 41. Product Boundary Summary

```text
CaptorStudio
    ACQUIRE
        │
        ▼
GeoEye Field
    OBSERVE / LOG
        │
        ▼
GeoEye Data Pool
    GOVERN / INTEGRATE / SHARE
        │
        ▼
GeoEye Analytics
    ANALYSE / DERIVE / INTERPRET
        │
        ▼
External Modelling Software
    MODEL / ESTIMATE
```

This separation should remain the guiding principle for future GeoEye development.
