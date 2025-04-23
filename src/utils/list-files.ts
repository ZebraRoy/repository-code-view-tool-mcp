import { glob } from "glob"

export type ListFilesMode = "glob" | "changed" | "staged" | "last-commit"

const listMethodMap: Record<ListFilesMode, (root: string, globPattern?: string) => Promise<string[]>> = {
  "glob": async (root: string, globPattern?: string) => {
    if (!globPattern) {
      throw new Error("globPattern is required")
    }
    const globResult = await glob(
      globPattern,
      {
        cwd: root,
        absolute: true,
      },
    )
    return globResult
  },
  "changed": async (root: string) => {
    return []
  },
  "staged": async (root: string) => {
    return []
  },
  "last-commit": async (root: string) => {
    return []
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
