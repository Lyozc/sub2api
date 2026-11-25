package service

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"slices"
	"strings"

	"github.com/tidwall/gjson"
	_ "golang.org/x/image/webp"
)

// Verified model schemas, shared with the frontend. Keep mode-specific limits:
// image-to-video may inherit its aspect ratio from the first frame.
//
//go:embed video_capabilities.json
var videoCapabilitiesJSON []byte

type VideoCapabilities struct {
	Durations            []int                 `json:"durations"`
	Resolutions          []string              `json:"resolutions"`
	DefaultResolution    string                `json:"default_resolution"`
	Ratios               []string              `json:"ratios"`
	Modes                []string              `json:"modes"`
	Sound                bool                  `json:"sound"`
	AudioResolutions     []string              `json:"audio_resolutions"`
	NegativePrompt       bool                  `json:"negative_prompt"`
	CFGScale             bool                  `json:"cfg_scale"`
	PromptMax            int                   `json:"prompt_max"`
	ImageMaxBytes        int                   `json:"image_max_bytes"`
	ImageMinEdge         int                   `json:"image_min_edge"`
	ImageMinAspect       float64               `json:"image_min_aspect,omitempty"`
	ImageMaxAspect       float64               `json:"image_max_aspect,omitempty"`
	ImageMaxEdge         int                   `json:"image_max_edge,omitempty"`
	References           *VideoReferenceLimits `json:"references,omitempty"`
	MinReferences        int                   `json:"min_references,omitempty"`
	MaxVideos            int                   `json:"max_videos,omitempty"`
	MaxAudios            int                   `json:"max_audios,omitempty"`
	RequiresImageOrVideo bool                  `json:"requires_image_or_video,omitempty"`
	ReferenceCounts      []int                 `json:"reference_counts,omitempty"`
}

var videoCapabilities = func() map[string]map[string]VideoCapabilities {
	var result map[string]map[string]VideoCapabilities
	if err := json.Unmarshal(videoCapabilitiesJSON, &result); err != nil {
		panic(err)
	}
	return result
}()

func VideoCapabilityModelID(model string) string {
	id := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(model), "_", "-"))
	if strings.HasPrefix(id, "kling-") {
		id = strings.TrimPrefix(id, "kling-video-")
		id = strings.TrimPrefix(id, "kling-")
		id = strings.TrimPrefix(id, "v")
		id = strings.ReplaceAll(id, ".", "-")
		if id == "3" || id == "4" {
			id += "-0"
		}
		if id == "4-flash" {
			id = "4-0-flash"
		}
		if id == "3-omni" {
			id = "3-0-omni"
		}
		if id == "2-5-turbo" {
			id = "2-5"
		}
		return "kling-video-" + func() string {
			if id == "o1" {
				return id
			}
			return "v" + id
		}()
	}
	return id
}

func VideoStudioCapabilities(model string) map[string]VideoCapabilities {
	return videoCapabilities[VideoCapabilityModelID(model)]
}

// Only quote prices with a verified billing source. Do not invent a default
// for models whose account-specific pricing is not exposed to the workbench.
func VideoStudioUnitPrices(model string, group *Group) map[string]float64 {
	if group == nil {
		return nil
	}
	// Estimates follow the same multiplier selection as actual video billing.
	// RateMultiplier may already contain the user's override, resolved by the caller.
	multiplier := resolveVideoRateMultiplier(&APIKey{Group: group}, group.RateMultiplier)
	prices := map[string]float64{}
	for _, resolution := range []string{"480p", "720p", "1080p", "4k"} {
		price := LookupVideoModelPrice(group.VideoModelPrices, model, resolution)
		if price == nil && resolution != VideoBillingResolution4K {
			price = group.GetVideoPrice(resolution)
		}
		if price != nil {
			prices[resolution] = *price * math.Max(0, multiplier)
		} else if price, ok := getDefaultGrokImagineVideoPrice(model, resolution); ok {
			prices[resolution] = price * math.Max(0, multiplier)
		}
	}
	return prices
}

func ValidateVideoStudioRequest(body []byte) error {
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return fmt.Errorf("invalid video request")
	}
	model := gjson.GetBytes(body, "model").String()
	mode := VideoStudioRequestMode(body)
	if err := ValidateVideoReferences(body); err != nil {
		return err
	}
	caps, known := VideoStudioCapabilities(model)[mode]
	if !known {
		return nil
	} // Custom models are validated by their upstream.
	d := gjson.GetBytes(body, "duration")
	if d.Type != gjson.Number || d.Float() != float64(d.Int()) || !slices.Contains(caps.Durations, int(d.Int())) {
		return fmt.Errorf("duration is not supported by %s; allowed whole seconds: %v", model, caps.Durations)
	}
	res := gjson.GetBytes(body, "resolution").String()
	if res != "" && !slices.Contains(caps.Resolutions, res) {
		return fmt.Errorf("resolution is not supported by %s", model)
	}
	if ratio := gjson.GetBytes(body, "aspect_ratio").String(); ratio != "" && !slices.Contains(caps.Ratios, ratio) {
		return fmt.Errorf("aspect ratio is inherited from the image or unsupported by %s", model)
	}
	if p := gjson.GetBytes(body, "prompt").String(); strings.TrimSpace(p) == "" || len([]rune(p)) > caps.PromptMax {
		return fmt.Errorf("prompt must contain 1–%d characters", caps.PromptMax)
	}
	if v := gjson.GetBytes(body, "mode"); v.Exists() && v.String() != "std" && !slices.Contains(caps.Modes, v.String()) {
		return fmt.Errorf("generation mode is not supported by %s", model)
	}
	if v := gjson.GetBytes(body, "sound"); v.Exists() {
		if !caps.Sound || (v.String() != "on" && v.String() != "off") {
			return fmt.Errorf("sound is not supported by %s", model)
		}
		if res == "" {
			res = caps.DefaultResolution
		}
		if v.String() == "on" && !slices.Contains(caps.AudioResolutions, res) {
			return fmt.Errorf("sound is not supported at %s", res)
		}
	}
	if gjson.GetBytes(body, "negative_prompt").String() != "" && !caps.NegativePrompt {
		return fmt.Errorf("negative prompt is not supported by %s", model)
	}
	if gjson.GetBytes(body, "cfg_scale").Exists() && !caps.CFGScale {
		return fmt.Errorf("cfg scale is not supported by %s", model)
	}
	if mode == "i2v" && gjson.GetBytes(body, "image").Exists() {
		return validateVideoFirstFrame(gjson.GetBytes(body, "image.url").String(), caps)
	}
	return nil
}

// Workbench uploads are inline images: inspect their actual bytes before any
// upstream submission. Remote image URLs remain an upstream API feature.
func validateVideoFirstFrame(url string, caps VideoCapabilities) error {
	parts := strings.SplitN(url, ",", 2)
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "data:image/") || !strings.HasSuffix(parts[0], ";base64") {
		return fmt.Errorf("first frame must be an uploaded PNG, JPEG or WebP image")
	}
	if len(parts[1]) > base64.StdEncoding.EncodedLen(caps.ImageMaxBytes) {
		return fmt.Errorf("first frame exceeds the model size limit")
	}
	data, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil || len(data) > caps.ImageMaxBytes {
		return fmt.Errorf("invalid first frame or image size exceeded")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") {
		return fmt.Errorf("first frame must be a valid PNG, JPEG or WebP image")
	}
	if min(config.Width, config.Height) < caps.ImageMinEdge || (caps.ImageMaxEdge > 0 && max(config.Width, config.Height) > caps.ImageMaxEdge) {
		return fmt.Errorf("first frame dimensions are unsupported; minimum edge is %d pixels", caps.ImageMinEdge)
	}
	ratio := float64(config.Width) / float64(config.Height)
	if (caps.ImageMinAspect > 0 && ratio < caps.ImageMinAspect) || (caps.ImageMaxAspect > 0 && ratio > caps.ImageMaxAspect) {
		return fmt.Errorf("first frame aspect ratio is unsupported by this model")
	}
	return nil
}
