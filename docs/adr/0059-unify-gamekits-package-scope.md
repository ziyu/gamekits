# ADR 0059: Unify GameKits Package Scope

Status: Accepted on 2026-09-07.

## Context

The project and GitHub repository are named `gamekits`. The workspace previously
used a singular package scope, while release staging mapped those manifests to
the public npm scope `@gamekits/*`. That split made repository code, package
manifests, type names, lockfile aliases, and release scripts disagree about the
framework's public identity.

The split also made the release verifier treat `@gamekits` as an internal-only
scope that had to be removed before publish. Once the workspace scope became the
public scope, that assertion was no longer meaningful.

## Decision

Use `@gamekits/*` as the single workspace and npm scope. Public runtime class and
type names use the `GameKits` prefix. The repository keeps the short slug name
`gamekits` for directory, app, and command naming.

Release staging must not map a second internal scope. It continues to rewrite
workspace dependency ranges to the lockstep release version. Release verification
must reject the legacy singular scope instead of rejecting the current
`@gamekits/` scope.

## Consequences

- All workspace dependencies and consumer imports use `@gamekits/*`.
- Published package names stay aligned with the GitHub repository and project brand.
- The release pipeline has one less namespace transformation to reason about.
- Consumers and internal code that referenced the legacy singular scope must
  migrate once.

## References

- Architecture: `docs/architecture.md`
- Release runbook: `docs/release.md`
- Package publication decision: `docs/adr/0008-package-publication-and-build-toolchain.md`
