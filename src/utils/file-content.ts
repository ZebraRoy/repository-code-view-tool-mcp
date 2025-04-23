import { readFile } from "fs/promises"
import { countToken } from "./count-token.js"
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

async function getFileContentByPath(root: string, filePath: string) {
  return readFile(path.join(root, filePath), "utf-8")
}

export async function getFileContent(root: string, filePath: string, token: number, startLine?: number): Promise<{
  content: string
  endLine: number
  isEnded: boolean
}> {
  const content = await getFileContentByPath(root, filePath)
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
