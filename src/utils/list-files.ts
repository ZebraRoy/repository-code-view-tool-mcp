import { glob } from "glob"
import { simpleGit } from "simple-git"
import binaryExtensions from "binary-extensions"
import path from "path"

export type ListFilesMode = "glob" | "changed" | "staged" | "last-commit"

function filterUnique(file: string, index: number, self: string[]) {
  return self.indexOf(file) === index
}

// filter out binary files using https://github.com/sindresorhus/binary-extensions
function filterBinaryFile(file: string) {
  const extension = path.extname(file).slice(1)
  return !binaryExtensions.includes(extension)
}

function filterEmptyFile(file: string) {
  return file.trim() !== ""
}

function normalizeFilePath(files: string[]) {
  return files.filter(filterBinaryFile).filter(filterUnique).filter(filterEmptyFile)
}

const listMethodMap: Record<ListFilesMode, (root: string, globPattern?: string) => Promise<string[]>> = {
  "glob": async (root: string, globPattern?: string) => {
    if (!globPattern) {
      throw new Error("globPattern is required")
    }
    const globResult = await glob(
      globPattern,
      {
        cwd: root,
      },
    )
    return normalizeFilePath(globResult)
  },
  "changed": async (root: string) => {
    const git = simpleGit({
      baseDir: root,
    })
    const status = await git.status()
    const changedFiles = status.modified
    const addedFiles = status.created
    const notAddedFiles = status.not_added
    return normalizeFilePath([...changedFiles, ...addedFiles, ...notAddedFiles])
  },
  "staged": async (root: string) => {
    const git = simpleGit({
      baseDir: root,
    })
    const status = await git.status()
    const stagedFiles = status.staged
    return normalizeFilePath(stagedFiles)
  },
  "last-commit": async (root: string) => {
    const git = simpleGit({
      baseDir: root,
    })
    const lastCommitFileList = await git.show(["--name-only", "--pretty=format:"])
    return normalizeFilePath(lastCommitFileList.split("\n"))
  },
}

export async function listFiles(root: string, mode: ListFilesMode, glob?: string) {
  const listMethod = listMethodMap[mode]
  if (!listMethod) {
    throw new Error(`Invalid mode: ${mode}`)
  }
  const files = await listMethod(root, glob)
  return files
}
