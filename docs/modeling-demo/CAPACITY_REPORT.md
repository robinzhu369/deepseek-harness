# Million Rows × 100 Columns Capacity Report

English | [中文](CAPACITY_REPORT.zh.md)

## Conclusion

T13 capacity validation is **PASS**. Using a fixed seed `20260921`, the system generated a CSV with 1,000,000 rows and 100 columns in batches of 5,000 without constructing an initial full DataFrame. The file size is 403,872,329 bytes, and the SHA-256 hash is `c88fbab70bb6061edf17962d60bac084291e8105041783ad9f424b936b737bfc`.

## Environment and Methodology

The environment is macOS 26.6.2 arm64, with 10 CPUs, 24 GiB RAM, Python 3.10.20, and Polars 1.0.0. Peak RSS was measured using `resource.getrusage(RUSAGE_SELF).ru_maxrss`; on macOS, this returns bytes in value. The service utilized the official `DatasetService` for chunked writing, CSV validation, SQLite registration, and a background full Profile. Cleaning/feature steps fitted medians and category vocabularies only to training shards before streaming export of train/validation/test Parquet files.

## Results

| Stage | Duration | Peak Process RSS at End of Stage |
|---|---:|---:|
| Batch CSV Generation | 0.779 s | 100,352,000 B |
| Chunked Upload, Registration, Full Profile | 20.541 s | 556,580,864 B |
| Cleaning, Category Encoding, prepared/manifest Export | 3.651 s | 2,865,119,232 B |
| Total | 24.971 s | 2,865,119,232 B (~2.67 GiB) |

The Profile returned 1,000,000 rows and 100 columns with `computation_scope = {kind: full_dataset, rows_scanned: 1000000, preview_rows: 20}`. The prepared dataset was split into train (800,000), validation (100,000), and test (100,000) with 105 output features. All three Parquet files totaled 189,683,020 bytes, each recording a SHA-256 hash. Full logistic regression training is marked `NOT_RUN` as this capacity gate does not mandate model training.

The initial prepared attempt exposed column offset issues with Polars 1.0 when combining projections and row indices; switching to stable `record_id` derived shards resulted in the final command exiting with code 0 for the same specification. Final structured evidence is located at `evidence/2026-09-21/t13-capacity.json`; failed attempts were not masqueraded as final results.
