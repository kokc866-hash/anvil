declare module "js-yaml" {
  export const FAILSAFE_SCHEMA: unknown;
  export function load(source: string, options?: { schema?: unknown }): unknown;
  export function dump(value: unknown, options?: { schema?: unknown; lineWidth?: number }): string;
}
