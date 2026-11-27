import { assertServiceRequest } from "../lib/mcp-service-policy";
import { assertMcpPackageRequest } from "../lib/mcp-packages";
import type { McpServer } from "../lib/mcp";
export { mcpArguments, localMcpFiles, workspaceMcpArguments } from "../lib/mcp-schema";
export { unwrapMcp } from "../lib/mcp-parse";
export { prepared } from "../lib/test-wrap";
export {capabilityPage} from '../lib/capability-search';

export function assertConnectionRequest(server: McpServer, method: string, params: unknown = {}) {
  if (!server.enabled) throw new Error("Dienst nicht aktiviert.");
  assertServiceRequest(server, server, method, params);
  assertMcpPackageRequest(server, method, params);
}
