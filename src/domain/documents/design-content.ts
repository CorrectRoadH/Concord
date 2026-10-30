import { validateDesignContent as evaluateDesignContent } from "../../model/index.js";
import { documentMarkdown } from "./document-projection.js";

/** Cache wrapping is bound to the exact source bytes; policy stays in the model. */
export function validateDesignContent(...input: Parameters<typeof evaluateDesignContent>) {
  return evaluateDesignContent(input[0], input[1], input[2], input[3], documentMarkdown);
}
