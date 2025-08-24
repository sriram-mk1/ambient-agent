/**
 * Lightweight response validator for AI email/document formatting
 * Simplified for performance - focuses on detection rather than heavy correction
 */

/**
 * Quick detection of email/document content without proper tags
 */
function containsEmailDocContent(content: string): boolean {
  const hasEmailKeywords = /\b(email|gmail|inbox|message)\b/i.test(content);
  const hasDocKeywords = /\b(document|doc|sheet)\b/i.test(content);
  const hasListPattern = /\d+\.\s|\*\*\w+:\*\*/i.test(content);

  return (hasEmailKeywords || hasDocKeywords) && hasListPattern;
}

/**
 * Lightweight validation function - just logs issues, no heavy correction
 */
export function validateAndCorrectResponse(aiResponse: string): string {
  // If already has custom tags, return as-is
  if (/<(gmail|docs|sheets|calendar|documents|emails)>/.test(aiResponse)) {
    return aiResponse;
  }

  // If doesn't contain email/doc content, return as-is
  if (!containsEmailDocContent(aiResponse)) {
    return aiResponse;
  }

  // Just log the issue - no heavy auto-correction
  console.warn("⚠️ AI response may need email/doc tag formatting");

  return aiResponse;
}

/**
 * Validate that a response has proper email/doc formatting
 */
export function isProperlyFormatted(content: string): boolean {
  // Check if it has custom tags when it should
  if (containsEmailDocContent(content)) {
    return /<(gmail|docs|sheets|calendar|documents|emails)>/.test(content);
  }

  return true; // No email/doc content, so formatting is fine
}
