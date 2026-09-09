# WO9951190A1 claims fixture

Public Japanese claims retrieved from EPO OPS on 2026-09-09 at `/3.2/rest-services/published-data/publication/docdb/WO.9951190.A1/claims` using `Accept: application/fulltext+xml`. Normalized by the companion backend's `xmlToJson(..., { preserveClaimOrder: true })`, `extractNumberedClaims`, and `patentDocumentReference` functions into the get_claims facade data shape. Backend HTTP-facade regression tests independently assert this shape and all eleven returned anchors.

The raw XML is committed in the companion backend at `tests/fixtures/ops/wo-9951190-a1-claims.xml`, SHA-256 `a364fbdffc9d6b8ab9ebb80f9eaf0f00273a1fbba8b19a8f1899e710cfb493e9`. It has one unnumbered XML claim/paragraph containing eleven printed claims, with OCR-spaced numbers 5–11. Source text and the Japanese heading are preserved; only navigation numbers are normalized. No credentials or private chat/session content is included.

This fixture exercises each recovered number through tool output and reader retrieval/rendering. The companion backend regression owns extraction, source-language/kind checks, cache invalidation, and conservative fallback when numbering is uncertain.
