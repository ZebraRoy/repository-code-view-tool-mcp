import { encoding_for_model } from "tiktoken"

export function countToken(text: string): number {
  const encoding = encoding_for_model("gpt-4o")
  const count = encoding.encode(text).length
  encoding.free()
  return count
}
