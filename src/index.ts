#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { listFiles, ListFilesMode } from "./utils/list-files.js"
import { getFileContent } from "./utils/file-content.js"

const server = new McpServer({
  name: "RepositoryCodeViewTool",
  description: "View the code of a repository.",
  version: "0.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
})

server.tool(
  "list-files",
  "List all files in the repository that match the given condition. We support glob pattern, all changed files, all staged files",
  {
    root: z.string().describe("The root directory of the repository"),
    mode: z.enum(["glob", "changed", "staged"]).describe("The mode for listing files: 'glob', 'changed', 'staged'"),
    glob: z.string().optional().describe("The glob pattern to match files against (required if mode is 'glob')"),
  },
  async ({ root, mode, glob }: { root: string, mode: ListFilesMode, glob?: string }) => {
    const files = await listFiles(root, mode, glob)
    return {
      content: [
        {
          type: "text",
          text: files.join("\n"),
        },
      ],
    }
  },
)

server.tool(
  "get-file-content",
  "Get the content of a file in the repository.",
  {
    root: z.string().describe("The root directory of the repository"),
    filePath: z.string().describe("The relative path to the file in the repository"),
    token: z.number().describe("The maximum number of tokens to return of the final content"),
    startLine: z.number().optional().describe("The start line of the content to return"),
  },
  async ({ root, filePath, token, startLine }: { root: string, filePath: string, token: number, startLine?: number }) => {
    const { content, endLine, isEnded } = await getFileContent(root, filePath, token, startLine)
    return {
      content: [
        {
          type: "text",
          text: content,
        },
        {
          type: "text",
          text: `End line: ${endLine}`,
        },
        {
          type: "text",
          text: `Is ended: ${isEnded}`,
        },
      ],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.log("RepositoryCodeViewTool MCP server is running on stdio")
}

main()
  .catch((error) => {
    console.error("Fatal error in main():", error)
    process.exit(1)
  })

// console.log("test list-files")
// const files = await listFiles("/Users/royng/Documents/GitHub/repository-code-view-tool-mcp", "changed")
// console.log("changed", files)
// const files2 = await listFiles("/Users/royng/Documents/GitHub/repository-code-view-tool-mcp", "staged")
// console.log("staged", files2)
// const files3 = await listFiles("/Users/royng/Documents/GitHub/repository-code-view-tool-mcp", "last-commit")
// console.log("last-commit", files3)
// const files4 = await listFiles("/Users/royng/Documents/GitHub/repository-code-view-tool-mcp", "glob", "**/*.ts")
// console.log("glob", files4)

// console.log("test getFileContent")
// const content = await getFileContent("/Users/royng/Documents/GitHub/repository-code-view-tool-mcp", "src/index.ts", 5000, 0, true)
// console.log(content)
