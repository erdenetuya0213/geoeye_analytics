# Analysis save contract

GeoEye analysis workspaces use one persistence contract for Structure, Geotechnical, Multivariate, and Domain results.

## User actions

- **Save** overwrites the current feature result in the active logging-template version.
- **Save As...** creates the next shared logging-template version and keeps every prior version unchanged.
- Either action persists all outputs together:
  1. GeoEye-owned derived fields or memberships projected onto the logging template.
  2. A feature-specific JSON analysis file containing run configuration, provenance, lineage, timestamps, and graph references.
  3. The graphs produced by the analysis as PNG images stored in private blob storage.
- Source observations are immutable. Analysis saves only write GeoEye-owned derived data and artifacts.
- There is no second "save to dataset" or publish button. The user finishes the analysis and clicks Save or Save As once.

## Feature outputs

| Feature | Logging-template projection | Analysis file and graph examples |
| --- | --- | --- |
| Structure | `structure.joint_set` | Set definitions and assignments; stereonet or joint-set counts |
| Geotechnical | `geotech.rmr76`, `geotech.rmr76_class`, optional component ratings | RMR76 method, scope, and lineage; downhole RMR76 and class distribution |
| Multivariate | Selected PCA scores, cluster ID, distance, and confidence | PCA/k-means configuration and lineage; explained variance, cluster counts, and PCA scores |
| Domain | Domain membership field for the selected domain type | Class scheme, evidence, and provenance; membership counts and class means |

## Names and storage hierarchy

Every artifact name begins with the original source-file stem, then the analysis input, artifact name, and template version:

```text
<source>__<input>__<chart>__v<version>.png
<source>__<input>__<feature>-analysis__v<version>.json
```

Private object storage follows the same tenant -> project -> borehole hierarchy as the PostgreSQL catalog:

```text
tenants/<tenant>/projects/<project>/boreholes/<borehole>/analytics/<feature>/v<version>/<file>
```

Project-wide outputs use `_all-boreholes` in the borehole segment. PNG bytes live in the private `geoeye-analysis-results` blob bucket. PostgreSQL stores only the object key, media type, optional borehole, byte size, checksum, analysis run, source filename, input name, and derived field keys.

## Version and transaction rules

The result catalog is unique by `(tenant, project, logging_template, feature, template_version)`, while the version sequence is shared by every feature writing to the same logging template.

- Re-saving with **Save** replaces the current feature package and its artifact catalog at the active version.
- **Save As...** resolves `max(template_version) + 1`, writes a new package, and preserves all older packages for 3D reuse, audit, and rollback.
- The analysis run must already be saved, and every borehole-scoped artifact must belong to the selected project.
- Exactly one `analysis_file` artifact must match the package's `analysisFileKey`.
- PostgreSQL updates the package and its artifact catalog in one transaction. Object upload must finish before catalog publication; a failed catalog write should trigger object cleanup.

The 3D Analysis screen discovers saved packages through the template, source-observation lineage, and borehole scope. The production client uses `GET /v1/analysis-result-packages` with tenant/project plus optional dataset, borehole, and feature filters. Selecting a result restores its derived field and linked observations and exposes the saved graph count.
