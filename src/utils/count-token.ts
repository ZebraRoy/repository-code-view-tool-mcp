import { encoding_for_model } from "tiktoken"

export function countToken(text: string) {
  // return the number of tokens in the text for each line
  const lines = text.split("\n")
  const encoding = encoding_for_model("gpt-4o")
  const lineTokens = lines.map(line => encoding.encode(line).length)
  encoding.free()
  return lineTokens
}
