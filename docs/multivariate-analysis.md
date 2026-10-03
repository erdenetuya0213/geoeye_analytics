# Multivariate analysis

The Multivariate workspace is a population-discovery tool over an immutable analytical dataset snapshot. It does not create, publish, or approve geological domains.

## Run contract

A run records the dataset and snapshot, selected numeric variables, categorical comparison field, filters, correlation display method, scaling, missing-data policy, cluster count, deterministic seed, engine version, and source observation IDs.

- Correlation is pairwise complete and reports the sample count for every pair. Pearson and Spearman matrices are both retained.
- Pair-specific scatter, regression, and population facets belong to Statistics → Relationships. Q–Q remains a Distribution/population-comparison diagnostic for the same variable across populations. Multivariate keeps only its many-variable matrix diagnostic.
- PCA and k-means use either complete cases or visible median imputation.
- PCA standardizes variables by default. Robust scaling and raw units are explicit alternatives.
- K-means operates on the same scaled analysis matrix used by PCA and uses a deterministic seed.
- Scores and memberships preserve all source observation IDs attached to the analytical support for shared selection in Statistics, 2D, 3D, and strip-log views.

The browser adapter executes in a Web Worker so React components only configure and render analyses. The production numerical boundary is `geoeye_analytics.MultivariateEngine`, backed by Polars, NumPy/SciPy, and scikit-learn.

## Derived results

Users may save PCA scores and cluster memberships as derived variables. Saved values include run ID/number, algorithm version, dataset snapshot, scaling, missing-data policy, source variables, and source observation IDs. Saving never overwrites primary or integrated observations, and cluster membership remains a statistical class rather than a geological domain.
