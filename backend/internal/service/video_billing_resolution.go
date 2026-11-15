package service

import "strings"

const (
	VideoBillingResolution480P  = "480p"
	VideoBillingResolution720P  = "720p"
	VideoBillingResolution1080P = "1080p"
	VideoBillingResolution4K    = "4k"
)

// Billing preserves positive consumed seconds. Model-specific request limits belong
// to validation, never to accounting (which also handles custom upstream models).
const (
	VideoBillingMinDurationSeconds     = 1
	VideoBillingDefaultDurationSeconds = 8
)

// NormalizeVideoBillingDurationSecondsOrDefault 归一化计费用视频时长：
// 未指定（<=0）按默认 8 秒计，已知消耗不截断。
func NormalizeVideoBillingDurationSecondsOrDefault(durationSeconds int) int {
	if durationSeconds <= 0 {
		return VideoBillingDefaultDurationSeconds
	}
	if durationSeconds < VideoBillingMinDurationSeconds {
		return VideoBillingMinDurationSeconds
	}
	return durationSeconds
}

// LookupVideoBillingResolution 归一化分辨率并报告是否为已知档位。
// 配置解析路径必须用它而不是 OrDefault：把无法识别的档位（如 "4k"、拼错的
// "1080i"）静默折算成 480p，会让管理员配的高分辨率单价被挂到低分辨率档上。
func LookupVideoBillingResolution(resolution string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(resolution)) {
	case "480", "480p", "sd":
		return VideoBillingResolution480P, true
	case "720", "720p", "hd":
		return VideoBillingResolution720P, true
	case "1080", "1080p", "full_hd", "full-hd", "fhd":
		return VideoBillingResolution1080P, true
	case "4k", "2160", "2160p", "uhd":
		return VideoBillingResolution4K, true
	default:
		return "", false
	}
}

// NormalizeVideoBillingResolutionOrDefault 用于运行时计费：上游回传的分辨率
// 缺失或无法识别时按最低档兜底，保证请求仍可计费。
func NormalizeVideoBillingResolutionOrDefault(resolution string) string {
	if normalized, ok := LookupVideoBillingResolution(resolution); ok {
		return normalized
	}
	return VideoBillingResolution480P
}
