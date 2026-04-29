export * from "./generated/api";
// NOTE: We intentionally do not re-export `./generated/types` here.
// orval generates a TypeScript-schema `XxxParams` type for query
// parameters that collides with the zod path-param schema of the same
// name (e.g. `ListInstitutionStudentsParams`). All current consumers
// import zod schemas from `./generated/api`, not the orphan TS types.
// If a downstream consumer needs the generated TS types, import them
// directly from `@workspace/api-zod/dist/generated/types` instead of
// re-exporting them through this barrel.
