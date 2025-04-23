import { readFile } from "fs/promises"
import { countToken } from "./count-token.js"
import { simpleGit } from "simple-git"
import path from "path"

function getEndline(startLine: number, lineTokens: number[], token: number) {
  let endLine = startLine
  let currentToken = 0
  while (currentToken < token) {
    currentToken += lineTokens[endLine]
    endLine++
  }
  return endLine
}

async function getFileContentByPath(root: string, filePath: string, isLastCommit?: boolean) {
  if (isLastCommit) {
    const git = simpleGit({
      baseDir: root,
    })
    const recentCommit = await git.log({
      file: filePath,
      maxCount: 1,
    })
    const commit = recentCommit.latest?.hash
    if (!commit) {
      throw new Error("No commit found")
    }
    const content = await git.show([`${commit}:${filePath}`])
    return content
  }
  return readFile(path.join(root, filePath), "utf-8")
}

export async function getFileContent(root: string, filePath: string, token: number, startLine?: number, isLastCommit?: boolean): Promise<{
  content: string
  endLine: number
  isEnded: boolean
}> {
  const content = await getFileContentByPath(root, filePath, isLastCommit)
  const lineTokens = countToken(content)
  const endLine = getEndline(startLine ?? 0, lineTokens, token)
  const isEnded = endLine === lineTokens.length
  const contentByLine = content.split("\n").slice(startLine, endLine)
  return {
    content: contentByLine.join("\n"),
    endLine,
    isEnded,
  }
}
