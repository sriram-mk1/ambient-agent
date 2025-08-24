import { DynamicTool } from "@langchain/core/tools";
import { z } from "zod";
import { interrupt } from "@langchain/langgraph";

/**
 * Human Input Tool
 * Interrupts the workflow to ask the user for input and resumes with the answer.
 *
 * Usage guidance for the model:
 * - Call this when you need missing information, approval text, or disambiguation
 * - Provide a clear, concise prompt and optional context/examples
 * - The tool returns the user's input as a string which you should use to continue
 */

// Simple schema definition
const humanInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe(
      "A direct, concise question or instruction to the user. Ask exactly what you need.",
    ),
  context: z
    .string()
    .optional()
    .describe(
      "Optional context, constraints, or examples to guide the user's answer.",
    ),
  expected: z
    .enum(["text", "json", "email", "url", "number", "choice"])
    .optional()
    .describe("Expected answer format (advisory only). Default is text."),
  choices: z
    .array(z.string())
    .optional()
    .describe("Optional choices for the user if applicable."),
  initial_value: z
    .string()
    .optional()
    .describe("Optional default value to prefill for the user."),
  allow_empty: z
    .boolean()
    .optional()
    .describe("If true, user may submit an empty response. Defaults to false."),
});

export function createHumanInputTool() {
  return new DynamicTool({
    name: "human_input",
    description:
      "Interrupts execution to request user input (clarification/approval text) and resumes with the provided answer.",
    func: async (input: string) => {
      // Parse the input string as JSON
      let parsedInput: any;
      try {
        parsedInput = JSON.parse(input);
      } catch {
        // If not JSON, treat as simple prompt
        parsedInput = { prompt: input };
      }

      // Validate against schema
      const validatedInput = humanInputSchema.parse(parsedInput);

      // Build the interrupt payload
      const payload = {
        type: "human_input" as const,
        prompt: validatedInput.prompt,
        context: validatedInput.context,
        expected: validatedInput.expected ?? "text",
        choices: validatedInput.choices,
        initial_value: validatedInput.initial_value,
        allow_empty: validatedInput.allow_empty ?? false,
      };

      // Interrupt and wait for user response
      const resumeValue: any = interrupt(payload);

      // Handle resume value
      let value: unknown = resumeValue;
      if (
        resumeValue &&
        typeof resumeValue === "object" &&
        (resumeValue as any).type === "human_input"
      ) {
        value = (resumeValue as any).value;
      }

      const result =
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : JSON.stringify(value);

      return result;
    },
  });
}
