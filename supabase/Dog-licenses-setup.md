# Dog license tracker

`/dog-licenses.html` is linked from the sidebar. It uses the existing Paws HQ shell and compact training table styles, with three working fields: pet name, renewal or registration, and initials. Rows are newest first by their immutable insertion order. Cells save on blur; choosing a request type saves immediately. Partial rows are allowed. Completely empty rows stay local until filled or removed.

Deleting an entry is reversible from **Deleted entries**, or through the five-second Undo notice. Names can be changed directly in the pet-name cell. Deleted entries retain their original fields and source metadata.

## Storage and access

Run `dog-licenses-setup.sql` in the existing project. It is safe to rerun and creates `public.hq_dog_licenses` with row-level security. Only active members of the existing administrator-managed `hq_tour_staff` allowlist can select, insert, or update records. It adds no accounts and grants no permanent deletion permission.

The browser sends changed cells with the last known revision. The server stamps audit fields and revisions. Original source metadata and insertion order cannot be changed. Late responses after sign-out are ignored; competing changes to the same cell retain the local draft and show a conflict.

Source records must be imported privately, with stable UUIDs and `ON CONFLICT DO NOTHING`, so repeating an import cannot duplicate records or overwrite later edits. Do not commit PDF entries, private import scripts, credentials, or fixture databases to this public repository. Source metadata contains the original three cell values and is retained when working fields change.

The source document’s renewal and registration checklists are displayed in the collapsible reference section. Its link labels did not include target URLs; add verified destinations when supplied.

## Validation

Run `node --test tests/*.test.cjs`. The license tests cover partial entries, literal values, select controls, Tab saving, pending and concurrent edits, retry recovery, reversible deletion, five-second notices, auth changes, pagination, and escaping.

Run `dog-licenses-rls-check.sql` after setup to validate approved-account operations, revision conflicts, immutable metadata, and anonymous/nonstaff/inactive isolation. The check uses synthetic records in a transaction and rolls back all changes. The temporary context table is session-local.

The initial rollout passed 72 application checks, local PostgreSQL-compatible schema/import checks, and the live rollback-only access checks. The private import preserved all three original values in the source row and passed rerun checks. Browser validation covered inline entry, saving across Tab navigation, deletion/restoration, light/dark styles, and a 390px mobile viewport.
