import fs from "fs"
import path from "path"
import os from "os"
import { countToken } from "./count-token.js"

export interface ReviewFile {
  path: string
  reviewed: boolean
  feedback: string
  agentReview?: string
  tokenCount?: number
}

export interface ReviewSession {
  id: string
  projectFolder: string
  files: ReviewFile[]
  createdAt: string
  updatedAt: string
  totalTokenCount: number
  currentSessionTokenCount: number
  tokenLimit: number
  completed: boolean
}

// Default sessions directory path
let SESSIONS_DIR = path.join(os.homedir(), ".review-toolkit-sessions")

// Function to set the sessions directory path
export function setSessionsDirectory(dirPath: string) {
  SESSIONS_DIR = dirPath
  // Ensure the directory exists
  ensureSessionsDir()
}

// Ensure sessions directory exists
function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  }
}

// Get session file path
function getSessionFilePath(sessionId: string): string {
  ensureSessionsDir()
  return path.join(SESSIONS_DIR, `${sessionId}.json`)
}

// Get project session index file
function getProjectIndexPath(): string {
  ensureSessionsDir()
  return path.join(SESSIONS_DIR, "project-index.json")
}

// Save project to session index
function saveProjectSessionIndex(projectFolder: string, sessionId: string) {
  const indexPath = getProjectIndexPath()
  let index: Record<string, string> = {}

  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    }
    catch (e) {
      console.error("Error reading project index:", e)
    }
  }

  index[projectFolder] = sessionId
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
}

// Get session ID for project folder
export function getSessionIdForProject(projectFolder: string): string | null {
  const indexPath = getProjectIndexPath()

  if (!fs.existsSync(indexPath)) {
    return null
  }

  try {
    const index: Record<string, string> = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    return index[projectFolder] || null
  }
  catch (e) {
    console.error("Error reading project index:", e)
    return null
  }
}

// Create new session
export function createSession(
  projectFolder: string,
  files: string[],
  tokenLimit: number = 10000,
): ReviewSession {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

  const reviewFiles: ReviewFile[] = files.map(file => ({
    path: file,
    reviewed: false,
    feedback: "",
  }))

  const session: ReviewSession = {
    id: sessionId,
    projectFolder,
    files: reviewFiles,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalTokenCount: 0,
    currentSessionTokenCount: 0,
    tokenLimit,
    completed: false,
  }

  saveSession(session)
  saveProjectSessionIndex(projectFolder, sessionId)

  return session
}

// Save session
export function saveSession(session: ReviewSession): void {
  ensureSessionsDir()
  session.updatedAt = new Date().toISOString()
  const filePath = getSessionFilePath(session.id)
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
}

// Get session
export function getSession(sessionId: string): ReviewSession | null {
  const filePath = getSessionFilePath(sessionId)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  }
  catch (e) {
    console.error("Error reading session:", e)
    return null
  }
}

// Update file review status and feedback
export function updateFileReview(
  sessionId: string,
  filePath: string,
  fileContent: string,
  reviewed: boolean,
  feedback: string,
  agentReview?: string,
): ReviewSession | null {
  const session = getSession(sessionId)

  if (!session) {
    return null
  }

  const fileIndex = session.files.findIndex(f => f.path === filePath)

  if (fileIndex === -1) {
    return null
  }

  session.files[fileIndex].reviewed = reviewed
  session.files[fileIndex].feedback = feedback

  if (agentReview) {
    session.files[fileIndex].agentReview = agentReview
  }

  // Calculate token count for the file content and feedback
  const fileTokens = countToken(fileContent)
  const feedbackTokens = countToken(feedback)
  const agentReviewTokens = agentReview ? countToken(agentReview) : 0
  const currentFileTokens = fileTokens + feedbackTokens + agentReviewTokens
  session.files[fileIndex].tokenCount = currentFileTokens

  // Update total token count for all files
  session.totalTokenCount = session.files.reduce((sum, file) => sum + (file.tokenCount || 0), 0)

  // Add current file's tokens to the current session token count
  session.currentSessionTokenCount += currentFileTokens

  saveSession(session)
  return session
}

// Get next file to review
export function getNextFileToReview(sessionId: string): ReviewFile | null {
  const session = getSession(sessionId)

  if (!session) {
    return null
  }

  const nextFile = session.files.find(file => !file.reviewed)
  return nextFile || null
}

// End session
export function completeSession(sessionId: string): ReviewSession | null {
  const session = getSession(sessionId)

  if (!session) {
    return null
  }

  session.completed = true
  saveSession(session)
  return session
}

// Generate report
export function generateSessionReport(sessionId: string): string {
  const session = getSession(sessionId)

  if (!session) {
    return "Session not found"
  }

  const reviewedFiles = session.files.filter(file => file.reviewed)
  const pendingFiles = session.files.filter(file => !file.reviewed)

  let report = `# Code Review Report\n\n`
  report += `Session ID: ${session.id}\n`
  report += `Project: ${session.projectFolder}\n`
  report += `Created: ${session.createdAt}\n`
  report += `Last Updated: ${session.updatedAt}\n\n`

  report += `## Summary\n\n`
  report += `- Total Files: ${session.files.length}\n`
  report += `- Reviewed Files: ${reviewedFiles.length}\n`
  report += `- Pending Files: ${pendingFiles.length}\n`
  report += `- Current Session Token Count: ${session.currentSessionTokenCount}/${session.tokenLimit}\n`
  report += `- Total Token Count (across all sessions): ${session.totalTokenCount}\n\n`

  report += `## Reviewed Files\n\n`

  for (const file of reviewedFiles) {
    report += `### ${file.path}\n\n`

    if (file.agentReview) {
      report += `#### AI Agent Review\n\n`
      report += `${file.agentReview}\n\n`
    }

    report += `#### Feedback\n\n`
    report += `${file.feedback || "No feedback provided"}\n\n`
  }

  if (pendingFiles.length > 0) {
    report += `## Pending Files\n\n`
    for (const file of pendingFiles) {
      report += `- ${file.path}\n`
    }
  }

  return report
}

// Reset token count when resuming a session
// This function should be called when a session is resumed in a new chat session
// as it resets the token usage counter back to 0
export function resetSessionTokenCount(sessionId: string): ReviewSession | null {
  const session = getSession(sessionId)

  if (!session) {
    return null
  }

  // Only reset the current session token count
  // The total token count is preserved as it tracks usage across all sessions
  session.currentSessionTokenCount = 0

  saveSession(session)
  return session
}
