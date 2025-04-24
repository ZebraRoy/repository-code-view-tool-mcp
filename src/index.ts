#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { listFiles, ListFilesMode } from "./utils/list-files.js"
import {
  createSession,
  getSession,
  getSessionIdForProject,
  updateFileReview,
  getNextFileToReview,
  completeSession,
  resetSessionTokenCount,
  setSessionsDirectory,
  saveSessionReport,
} from "./utils/review-session.js"
import fs from "fs"
import path from "path"

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const parsedArgs: Record<string, string> = {}

  args.forEach((arg) => {
    if (arg.startsWith("--")) {
      const [key, value] = arg.substring(2).split("=")
      if (key && value) {
        parsedArgs[key] = value
      }
    }
  })

  return parsedArgs
}

const args = parseArgs()

// Set sessions directory if provided
if (args["session-dir"]) {
  setSessionsDirectory(args["session-dir"])
}

const server = new McpServer({
  name: "ReviewTool",
  description: "Provide tools to help agents review code.",
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
  "start-review-session",
  "Start a new code review session or resume an existing one. This should be the first tool called when starting or resuming a review process.",
  {
    projectRoot: z.string().describe("The root directory of the project"),
    files: z.array(z.string()).optional().describe("Array of file paths to review (optional)"),
    tokenLimit: z.number().optional().describe("Maximum token limit for the session (default: 10000)"),
    forceNew: z.boolean().optional().describe("Force creation of a new session even if one exists"),
  },
  async ({
    projectRoot,
    files,
    tokenLimit = 10000,
    forceNew = false,
  }: {
    projectRoot: string
    files?: string[]
    tokenLimit?: number
    forceNew?: boolean
  }) => {
    let session

    // Check for existing session unless forceNew is true
    if (!forceNew) {
      const existingSessionId = getSessionIdForProject(projectRoot)
      if (existingSessionId) {
        const existingSession = getSession(existingSessionId)
        if (existingSession && !existingSession.completed) {
          // Reset token count for the session when resuming
          // This is because resuming a session means a new chat session has been created
          // and token usage should be reset to 0 for the new chat context
          session = resetSessionTokenCount(existingSessionId)

          if (session) {
            const reviewedFiles = session.files.filter(f => f.reviewed)

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "resumed",
                    sessionId: session.id,
                    projectFolder: session.projectFolder,
                    filesCount: session.files.length,
                    reviewedCount: reviewedFiles.length,
                    pendingCount: session.files.length - reviewedFiles.length,
                    tokenCount: session.currentSessionTokenCount,
                    tokenLimit: session.tokenLimit,
                    completed: session.completed,
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt,
                  }, null, 2),
                },
              ],
            }
          }
          else {
            // Handle the rare case where the session couldn't be reset
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "error",
                    message: "Failed to reset session token count",
                  }, null, 2),
                },
              ],
            }
          }
        }
      }
    }

    // If no existing session or forceNew is true, create a new session
    if (!files || files.length === 0) {
      // If no files provided, list all files in the project
      try {
        files = await listFiles(projectRoot, "glob", "**/*.*")
      }
      catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing files: ${error}`,
            },
          ],
        }
      }
    }

    session = createSession(projectRoot, files, tokenLimit)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "created",
            sessionId: session.id,
            projectFolder: session.projectFolder,
            filesCount: session.files.length,
            tokenLimit: session.tokenLimit,
          }, null, 2),
        },
      ],
    }
  },
)

server.tool(
  "get-next-review-file",
  "Get the next file that needs to be reviewed",
  {
    key: z.string().describe("Session ID or project root path"),
  },
  async ({ key }: { key: string }) => {
    let sessionId = key

    // Check if key is a project root path
    if (!getSession(key)) {
      const existingSessionId = getSessionIdForProject(key)
      if (existingSessionId) {
        sessionId = existingSessionId
      }
      else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No session found for the provided key",
              }, null, 2),
            },
          ],
        }
      }
    }

    const nextFile = getNextFileToReview(sessionId)

    if (!nextFile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "completed",
              message: "All files have been reviewed",
            }, null, 2),
          },
        ],
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            filePath: nextFile.path,
          }, null, 2),
        },
      ],
    }
  },
)

server.tool(
  "submit-file-review",
  "Submit a review for a file",
  {
    key: z.string().describe("Session ID or project root path"),
    filePath: z.string().describe("The file path that was reviewed"),
    feedback: z.string().describe("The review feedback for the file"),
    agentReview: z.string().describe("The AI agent's review of the file"),
    projectRoot: z.string().optional().describe("The project root directory (if different from key)"),
  },
  async ({
    key,
    filePath,
    feedback,
    agentReview,
    projectRoot,
  }: {
    key: string
    filePath: string
    feedback: string
    agentReview: string
    projectRoot?: string
  }) => {
    let sessionId = key
    const root = projectRoot || key

    // Check if key is a project root path
    if (!getSession(key)) {
      const existingSessionId = getSessionIdForProject(key)
      if (existingSessionId) {
        sessionId = existingSessionId
      }
      else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No session found for the provided key",
              }, null, 2),
            },
          ],
        }
      }
    }

    // Get file content to count tokens
    let fileContent = ""
    try {
      const fullPath = path.join(root, filePath)
      if (fs.existsSync(fullPath)) {
        fileContent = fs.readFileSync(fullPath, "utf8")
      }
    }
    catch (error) {
      console.error(`Error reading file ${filePath}:`, error)
    }

    const updatedSession = updateFileReview(sessionId, filePath, fileContent, true, feedback, agentReview)

    if (!updatedSession) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Failed to update file review. Session or file not found.",
            }, null, 2),
          },
        ],
      }
    }

    const exceedsTokenLimit = updatedSession.currentSessionTokenCount > updatedSession.tokenLimit

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            sessionId: updatedSession.id,
            filePath,
            reviewedCount: updatedSession.files.filter(f => f.reviewed).length,
            pendingCount: updatedSession.files.filter(f => !f.reviewed).length,
            tokenCount: updatedSession.currentSessionTokenCount,
            tokenLimit: updatedSession.tokenLimit,
            exceedsTokenLimit,
          }, null, 2),
        },
      ],
    }
  },
)

server.tool(
  "complete-review-session",
  "Mark a review session as completed",
  {
    key: z.string().describe("Session ID or project root path"),
  },
  async ({ key }: { key: string }) => {
    let sessionId = key

    // Check if key is a project root path
    if (!getSession(key)) {
      const existingSessionId = getSessionIdForProject(key)
      if (existingSessionId) {
        sessionId = existingSessionId
      }
      else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No session found for the provided key",
              }, null, 2),
            },
          ],
        }
      }
    }

    const session = completeSession(sessionId)

    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Session not found",
            }, null, 2),
          },
        ],
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            sessionId: session.id,
            completed: true,
            reviewedCount: session.files.filter(f => f.reviewed).length,
            pendingCount: session.files.filter(f => !f.reviewed).length,
            tokenCount: session.currentSessionTokenCount,
          }, null, 2),
        },
      ],
    }
  },
)

server.tool(
  "generate-review-report",
  "Generate a report for a review session",
  {
    key: z.string().describe("Session ID or project root path"),
  },
  async ({ key }: { key: string }) => {
    let sessionId = key

    // Check if key is a project root path
    if (!getSession(key)) {
      const existingSessionId = getSessionIdForProject(key)
      if (existingSessionId) {
        sessionId = existingSessionId
      }
      else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No session found for the provided key",
              }, null, 2),
            },
          ],
        }
      }
    }

    try {
      const reportPath = saveSessionReport(sessionId)

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              reportPath,
              message: "Report generated successfully",
            }, null, 2),
          },
        ],
      }
    }
    catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Failed to generate report: ${errorMessage}`,
            }, null, 2),
          },
        ],
      }
    }
  },
)

server.tool(
  "get-file-review",
  "Get the saved review for a specific file",
  {
    key: z.string().describe("Session ID or project root path"),
    filePath: z.string().describe("The file path to get the review for"),
  },
  async ({ key, filePath }: { key: string, filePath: string }) => {
    let sessionId = key

    // Check if key is a project root path
    if (!getSession(key)) {
      const existingSessionId = getSessionIdForProject(key)
      if (existingSessionId) {
        sessionId = existingSessionId
      }
      else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No session found for the provided key",
              }, null, 2),
            },
          ],
        }
      }
    }

    const session = getSession(sessionId)

    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Session not found",
            }, null, 2),
          },
        ],
      }
    }

    const fileInfo = session.files.find(f => f.path === filePath)

    if (!fileInfo) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "File not found in session",
            }, null, 2),
          },
        ],
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            filePath: fileInfo.path,
            reviewed: fileInfo.reviewed,
            feedback: fileInfo.feedback || "",
            agentReview: fileInfo.agentReview || "",
          }, null, 2),
        },
      ],
    }
  },
)

server.tool(
  "get-agent-instructions",
  "Get detailed instructions for how agents should use the review toolkit MCP tools",
  {},
  async () => {
    // Return the instructions for how agents should use the toolkit
    return {
      content: [
        {
          type: "text",
          text: `# Instructions for AI Agents Using Review Toolkit

## Workflow

When asked to perform a code review, follow these steps:

1. Get files to review using \`list-files\`.
2. Start a review session using \`start-review-session\` to initialize a new review session or resume an existing one. Always use this tool first when starting or resuming a review.
3. Request the next file to review using \`get-next-review-file\`.
4. Read and analyze the file. Remember to use existing rules and guidelines of the project.
5. Submit your review using \`submit-file-review\`, including both your detailed review and the user's feedback.
6. Repeat steps 3-5 until all files have been reviewed.
7. Complete the review session using \`complete-review-session\`.
8. Generate a final report using \`generate-review-report\`.

## Available Tools

1. \`list-files\` - List files matching specific criteria (glob patterns, changed files, staged files).
2. \`start-review-session\` - Initialize a new review session or resume an existing one. This should always be the first tool used when starting or resuming a review.
3. \`get-next-review-file\` - Get the next file that needs to be reviewed.
4. \`submit-file-review\` - Submit a review for a specific file.
5. \`get-file-review\` - Retrieve the saved review for a specific file that has already been reviewed.
6. \`complete-review-session\` - Mark a review session as completed.
7. \`generate-review-report\` - Generate a comprehensive report of the review session.

## Best Practices

1. Always provide both your detailed review analysis and a summary of the user's feedback when submitting reviews.
2. When analyzing files, consider:
   - Code quality and structure
   - Potential bugs or issues
   - Performance considerations
   - Security vulnerabilities
   - Adherence to best practices
   - Documentation completeness
3. Format your reviews in a clear, readable way using Markdown when appropriate.
4. When the review is complete, provide a comprehensive summary with high-level observations.
5. If you are unable to review a file, provide a clear explanation for why you cannot review it.
6. Suggest the user to open new chat when token limit is reached.`,
        },
      ],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.log("ReviewTool MCP server is running on stdio")
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
