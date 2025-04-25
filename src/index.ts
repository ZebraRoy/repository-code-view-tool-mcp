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
  "start-review-session",
  "Start a new code review session or resume an existing one. This should be the first tool called when starting or resuming a review process.",
  {
    projectRoot: z.string().describe("The absolute path to the root directory of the project"),
    mode: z.enum(["glob", "changed", "staged", "resume"]).describe("The mode for listing files: 'glob', 'changed', 'staged', or 'resume' to resume existing session"),
    glob: z.string().optional().describe("The glob pattern to match files against (required if mode is 'glob')"),
    files: z.array(z.string()).optional().describe("Array of file paths to review (optional, overrides mode if provided)"),
    tokenLimit: z.number().optional().describe("Maximum token limit for the session (default: 10000)"),
    forceNew: z.boolean().optional().describe("Force creation of a new session even if one exists"),
  },
  async ({
    projectRoot,
    mode,
    glob,
    files,
    tokenLimit = 10000,
    forceNew = false,
  }: {
    projectRoot: string
    mode: ListFilesMode | "resume"
    glob?: string
    files?: string[]
    tokenLimit?: number
    forceNew?: boolean
  }) => {
    let session

    // Handle resume mode
    if (mode === "resume" && !forceNew) {
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

    // Check for existing session unless forceNew is true or we're in a mode other than resume
    if (!forceNew && mode !== "resume") {
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
      // If no files provided, list files according to the specified mode
      try {
        if (mode === "glob") {
          if (!glob) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "error",
                    message: "Glob pattern is required when mode is 'glob'",
                  }, null, 2),
                },
              ],
            }
          }
          files = await listFiles(projectRoot, "glob", glob)
        }
        else if (mode === "changed") {
          files = await listFiles(projectRoot, "changed")
        }
        else if (mode === "staged") {
          files = await listFiles(projectRoot, "staged")
        }
        else if (mode === "resume") {
          // If we're here, it means no session was found to resume
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "error",
                  message: "No session found to resume for the provided project root",
                }, null, 2),
              },
            ],
          }
        }
      }
      catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: `Error listing files: ${error}`,
              }, null, 2),
            },
          ],
        }
      }

      // Ensure files is never undefined
      if (!files || files.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "error",
                message: "No files found to review. Please check your glob pattern or repository state.",
              }, null, 2),
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

    // Get the session to check token count
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

    // Check if token limit is exceeded
    if (session.currentSessionTokenCount > session.tokenLimit) {
      // Check if there are any unreviewed files
      const pendingFiles = session.files.filter(file => !file.reviewed).length

      if (pendingFiles === 0) {
        // All files have been reviewed
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "token_limit_exceeded_all_reviewed",
                message: "Token limit exceeded but all files have been reviewed. Please generate a final report.",
                tokenCount: session.currentSessionTokenCount,
                tokenLimit: session.tokenLimit,
                pendingFiles: 0,
              }, null, 2),
            },
          ],
        }
      }
      else {
        // Still have files to review
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "token_limit_exceeded",
                message: "Token limit exceeded with files still pending review. Please start a new CHAT session to continue.",
                tokenCount: session.currentSessionTokenCount,
                tokenLimit: session.tokenLimit,
                pendingFiles: pendingFiles,
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
    agentReview: z.string().describe("The AI agent's review of the file"),
    projectRoot: z.string().optional().describe("The project root directory (if different from key)"),
  },
  async ({
    key,
    filePath,
    agentReview,
    projectRoot,
  }: {
    key: string
    filePath: string
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

    const updatedSession = updateFileReview(sessionId, filePath, fileContent, true, agentReview)

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
  "Mark a review session as completed. This should ONLY be called when all files have been properly reviewed, NOT when token limit is exceeded.",
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

    // Get session to check if all files are reviewed
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

    // Check if all files have been reviewed
    const pendingFiles = session.files.filter(f => !f.reviewed).length
    if (pendingFiles > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Cannot complete session: ${pendingFiles} files still need to be reviewed`,
              reviewedCount: session.files.filter(f => f.reviewed).length,
              pendingCount: pendingFiles,
              totalFiles: session.files.length,
            }, null, 2),
          },
        ],
      }
    }

    const completedSession = completeSession(sessionId)

    if (!completedSession) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "Failed to complete session",
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
            sessionId: completedSession.id,
            completed: true,
            reviewedCount: completedSession.files.filter(f => f.reviewed).length,
            pendingCount: completedSession.files.filter(f => !f.reviewed).length,
            tokenCount: completedSession.currentSessionTokenCount,
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

1. Start a review session using \`start-review-session\` with the appropriate mode to initialize a new review session or resume an existing one.
2. Request the next file to review using \`get-next-review-file\`.
3. Read and analyze the file. Remember to use existing rules and guidelines of the project.
4. Submit your review using \`submit-file-review\`, providing your detailed analysis.
5. Repeat steps 2-4 until all files have been reviewed.
6. Complete the review session using \`complete-review-session\` ONLY when all files have been reviewed.
7. Generate a final report using \`generate-review-report\`.

## Available Tools

1. \`start-review-session\` - Initialize a new review session or resume an existing one. Use this as the first tool when starting a code review.
   - Modes:
     - \`glob\`: Review files matching a glob pattern (requires glob parameter)
     - \`changed\`: Review all changed files in the repository
     - \`staged\`: Review all staged files in the repository
     - \`resume\`: Resume an existing review session
2. \`get-review-status\` - Check the current status of a review session.
3. \`get-next-review-file\` - Get the next file that needs to be reviewed.
4. \`submit-file-review\` - Submit a review for a specific file.
5. \`get-file-review\` - Retrieve the saved review for a specific file that has already been reviewed.
6. \`complete-review-session\` - Mark a review session as completed. ONLY call this when all files have been reviewed.
7. \`generate-review-report\` - Generate a comprehensive report of the review session.

## Best Practices

1. Provide a detailed and thorough review analysis when submitting reviews.
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
6. When token limit is exceeded:
   - DO NOT call 'complete-review-session' - this should only be used when all files are reviewed
   - Instead, inform the user that the token limit has been reached
   - Suggest the user to start a new chat session and resume the review there
   - Explain that this will reset the token count for the current session while preserving progress

## Handling Token Limit Exceeded

When calling \`get-next-review-file\`, check for the status in the response:

- If status is "token_limit_exceeded", you MUST:
  1. Stop the review process immediately
  2. Display a clear warning to the user that the token limit has been exceeded but there are still files to review
  3. Advise the user to start a new CHAT session (not a new review session) to continue reviewing the remaining files
  4. Explain that starting a new chat session will reset the token count while preserving review progress
  5. Do NOT attempt to review any more files in the current session
  6. Do NOT call \`complete-review-session\` as the review is not actually complete

- If status is "token_limit_exceeded_all_reviewed", you MUST:
  1. Inform the user that all files have been reviewed but the token limit has been exceeded
  2. Suggest generating a final report using \`generate-review-report\` to summarize all reviews
  3. Proceed to generate the report if the user agrees

Example warning for unfinished reviews:
"⚠️ WARNING: Token limit exceeded for this review session with files still pending review. Please start a new CHAT session (not a new review session) to continue reviewing the remaining files. This will reset the token count while preserving your review progress."

Example message for completed reviews:
"✅ All files have been reviewed, but the token limit has been exceeded. Would you like me to generate a final report summarizing all the reviews?"`,
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
