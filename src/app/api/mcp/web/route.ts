// Web OAuth MCP endpoint. Identical behavior to /api/mcp, exposed at a second
// path that mirrors the working reference (Ovillo uses /api/mcp/web). Giving
// Claude.ai a URL it has never seen forces a clean Dynamic Client Registration,
// sidestepping any stale/corrupted per-account connector state cached against
// the /api/mcp URL.
export { GET, POST, DELETE, OPTIONS } from '../route';
