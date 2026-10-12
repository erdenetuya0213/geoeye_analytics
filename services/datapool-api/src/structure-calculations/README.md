# Field structure calculations

These pure calculation modules are copied from GeoEye Field commit
`63497def` (`apps/field/features/logging/lib`) so the live logging adapter
uses the same named outputs and rules as completed structure exports.
`structure-observation-guides.ts` contains the aperture lookup excerpt;
`structure-rating-systems.ts` contains the rating system type only.

Changes from Field are relative ESM imports and explicit checked array access
for this repository's stricter TypeScript settings. When updating the Field
rules, update this copy and the parity fixtures together. The adapter consumes
current raw records, dictionary codes and template settings; it never reads a
completed CSV to populate a live calculation.
