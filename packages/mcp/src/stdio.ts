import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RelayClient } from "./relay-client.js";
import { createOvertableMcpServer } from "./server.js";

export async function startStdioServer(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<void> {
  const client = new RelayClient(options);
  const server = createOvertableMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
