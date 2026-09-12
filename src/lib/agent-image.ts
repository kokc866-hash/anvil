// Internal provenance survives object copies but is never serialized into
// provider API payloads. User attachments do not receive this marker.
export const ANVIL_RUN_FRAME = Symbol("anvilRunFrame");
