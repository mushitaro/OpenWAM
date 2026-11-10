# Repository storage boundary (2026-11-10)

Code, tests, analysis scripts and scientific reports are versioned. The exact directories listed in repository_storage_20261110.json are retained locally, with explicit .gitignore entries. They are not discarded or claimed reproducible solely from Git.

The source-validation worktree contains unique input/checkpoint history; the validation worktree holds the verified 99-part final archive. Their absolute paths are referenced by restoration tools and scientific evidence. Neither worktree is redundant, so neither is removed in this curation. Recreating a Git checkout alone does not recreate these datasets.

The 2026-11-07 storage report and restoration scripts are in C:/Users/kazuh/Documents/Codex/2026-10-29/test-data-storage-cleanup/outputs/cleanup_20261107/REPORT.md. Large archives remain outside Git. Scientific strict/grid gates and current-model VE accuracy remain incomplete; clean Git status is not scientific acceptance.
