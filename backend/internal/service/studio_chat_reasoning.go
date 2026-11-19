package service

import "strings"

// StudioChatReasoningEffort selects the highest inference effort from the
// existing model catalog. Ultra is a Codex agent workflow, not a wire effort.
// Unknown/non-reasoning models retain their upstream defaults. The regular
// gateway still applies group policy and upstream compatibility conversions.
func StudioChatReasoningEffort(model string) string {
	canonical := strings.ToLower(lastOpenAIModelSegment(model))
	// Older GPT-5 and o-series models predate the xhigh effort level.
	for _, prefix := range []string{"o1", "o3", "o4-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1"} {
		if canonical == prefix || strings.HasPrefix(canonical, prefix+"-20") {
			return "high"
		}
	}
	if strings.HasPrefix(canonical, "gpt-5.1-") {
		return "high"
	}
	if strings.HasPrefix(canonical, "gemini-") && !strings.Contains(canonical, "image") {
		return "high"
	}
	if strings.HasPrefix(canonical, "deepseek-") && !supportsOpenAIReasoningEffortMax(canonical) {
		if canonical == "deepseek-chat" {
			return ""
		}
		return "high"
	}
	if supportsOpenAIReasoningEffortMax(canonical) {
		return "max"
	}
	best, bestRank := "", 0
	for _, level := range newConfiguredCodexModelDescriptor(model).SupportedReasoningLevels {
		if rank, ok := reasoningEffortRank(level.Effort); ok && rank > bestRank {
			best, bestRank = level.Effort, rank
		}
	}
	return best
}
