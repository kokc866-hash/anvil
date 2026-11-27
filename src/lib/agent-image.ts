// Internal provenance survives object copies but is never serialized into
// provider API payloads. User attachments do not receive this marker.
export const ANVIL_RUN_FRAME = Symbol("anvilRunFrame");

// User attachments, MCP results and preview frames share this per-request limit.
export const MODEL_IMAGE_LIMIT = 4;
