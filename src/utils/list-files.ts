import { glob } from "glob"
import { simpleGit } from "simple-git"
import binaryExtensions from "binary-extensions"
import path from "path"
import fs from "fs"
import ignore from "ignore"

export type ListFilesMode = "glob" | "changed" | "staged"

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

let ig: ReturnType<typeof ignore> | null = null
let igRoot: string | null = null
function getIgnoreInstance(root: string) {
  if (ig && igRoot === root) return ig
  const gitignorePath = path.join(root, ".gitignore")
  let patterns = ""
  try {
    patterns = fs.readFileSync(gitignorePath, "utf8")
  }
  catch (_e) {
    // no .gitignore, ignore nothing
  }
  ig = ignore().add(patterns)
  igRoot = root
  return ig
}

function normalizeFilePath(files: string[], root?: string) {
  let filtered = files
    .filter(filterBinaryFile)
    .filter(filterUnique)
    .filter(filterEmptyFile)
  if (root) {
    const ig = getIgnoreInstance(root)
    filtered = ig.filter(filtered)
  }
  return filtered
}

const listMethodMap: Record<ListFilesMode, (root: string, globPattern?: string) => Promise<string[]>> = {
  glob: async (root: string, globPattern?: string) => {
    if (!globPattern) {
      throw new Error("globPattern is required")
    }
    const globResult = await glob(
      globPattern,
      {
        cwd: root,
      },
    )
    return normalizeFilePath(globResult, root)
  },
  changed: async (root: string) => {
    const git = simpleGit({
      baseDir: root,
    })
    const status = await git.status()
    const changedFiles = status.modified
    const addedFiles = status.created
    const notAddedFiles = status.not_added
    return normalizeFilePath([...changedFiles, ...addedFiles, ...notAddedFiles], root)
  },
  staged: async (root: string) => {
    const git = simpleGit({
      baseDir: root,
    })
    const status = await git.status()
    const stagedFiles = status.staged
    return normalizeFilePath(stagedFiles, root)
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
