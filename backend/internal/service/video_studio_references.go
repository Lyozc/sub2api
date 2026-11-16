package service

import (
	"fmt"
	"net/netip"
	"net/url"
	"slices"
	"strings"

	"github.com/tidwall/gjson"
)

type VideoReferenceLimits struct {
	MultiShotsRequired             bool     `json:"multi_shots_required"`
	ImageSlots                     []string `json:"image_slots"`
	VideoSlots                     []string `json:"video_slots"`
	AudioSlots                     []string `json:"audio_slots"`
	RequiredSlots                  []string `json:"required_slots"`
	MaxImages                      int      `json:"max_images"`
	MaxTotal                       int      `json:"max_total"`
	MaxImagesWithVideo             int      `json:"max_images_with_video"`
	KeepOriginalSound              bool     `json:"keep_original_sound"`
	PreferMultiShots               bool     `json:"prefer_multi_shots"`
	DisableGeneratedAudioWithVideo bool     `json:"disable_generated_audio_with_video"`
}

func VideoStudioRequestMode(body []byte) string {
	if gjson.GetBytes(body, "video_mode").String() == "reference" {
		return "reference"
	}
	if image := gjson.GetBytes(body, "image"); image.Exists() && image.Type != gjson.Null {
		return "i2v"
	}
	if len(gjson.GetBytes(body, "reference_images").Array()) > 0 {
		return "i2v"
	}
	return "t2v"
}

func ValidateVideoReferenceURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return fmt.Errorf("reference media requires a public HTTP(S) URL")
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return fmt.Errorf("reference URL must be public")
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return fmt.Errorf("reference URL must be public")
		}
	}
	return nil
}

// Validate before reserving a submission key or sending any billable request.
func ValidateVideoReferences(body []byte) error {
	advanced := gjson.GetBytes(body, "video_mode").Exists() || gjson.GetBytes(body, "reference_images").Exists() || gjson.GetBytes(body, "reference_media").Exists() || gjson.GetBytes(body, "keep_original_sound").Exists() || gjson.GetBytes(body, "prefer_multi_shots").Exists()
	if !advanced {
		return nil
	}
	model := gjson.GetBytes(body, "model").String()
	if model == "" {
		model = gjson.GetBytes(body, "model_name").String()
	}
	if !IsKlingVideoModel(model) {
		return fmt.Errorf("advanced references require a supported Kling model")
	}
	mode := gjson.GetBytes(body, "video_mode")
	if mode.Type != gjson.String || (mode.String() != "frames" && mode.String() != "reference") {
		return fmt.Errorf("video_mode must be frames or reference")
	}
	if gjson.GetBytes(body, "image").Exists() || gjson.GetBytes(body, "image_tail").Exists() {
		return fmt.Errorf("use reference_images or image/image_tail, not both")
	}
	caps, ok := VideoStudioCapabilities(model)[VideoStudioRequestMode(body)]
	if !ok {
		return fmt.Errorf("reference mode is unsupported by %s", model)
	}
	// A frame request without material remains ordinary text-to-video.
	if VideoStudioRequestMode(body) == "t2v" {
		caps = VideoStudioCapabilities(model)["i2v"]
	}
	limits := caps.References
	if limits == nil {
		return fmt.Errorf("reference slots are unavailable for %s", model)
	}
	seen := map[string]bool{}
	images, videos, total := 0, 0, 0
	for _, field := range []string{"reference_images", "reference_media"} {
		list := gjson.GetBytes(body, field)
		if list.Exists() && !list.IsArray() {
			return fmt.Errorf("%s must be an array", field)
		}
		if len(list.Array()) > 15 {
			return fmt.Errorf("too many reference materials")
		}
		for _, entry := range list.Array() {
			if !entry.IsObject() {
				return fmt.Errorf("invalid reference material")
			}
			validFields := true
			entry.ForEach(func(k, v gjson.Result) bool {
				if k.String() != "name" && k.String() != "url" {
					validFields = false
				}
				return true
			})
			name, raw := entry.Get("name"), entry.Get("url")
			if !validFields || name.Type != gjson.String || raw.Type != gjson.String || strings.TrimSpace(raw.String()) == "" || seen[name.String()] {
				return fmt.Errorf("invalid or duplicate reference slot")
			}
			seen[name.String()] = true
			if field == "reference_images" {
				if !slices.Contains(limits.ImageSlots, name.String()) {
					return fmt.Errorf("image slot %s is unsupported by %s", name.String(), model)
				}
				images++
				if strings.HasPrefix(raw.String(), "data:") {
					if err := validateVideoFirstFrame(raw.String(), caps); err != nil {
						return err
					}
				} else if err := ValidateVideoReferenceURL(raw.String()); err != nil {
					return err
				}
			} else {
				if mode.String() != "reference" || (!slices.Contains(limits.VideoSlots, name.String()) && !slices.Contains(limits.AudioSlots, name.String())) {
					return fmt.Errorf("media slot %s is unsupported by %s", name.String(), model)
				}
				if err := ValidateVideoReferenceURL(raw.String()); err != nil {
					return err
				}
				if slices.Contains(limits.VideoSlots, name.String()) {
					videos++
				}
			}
			total++
		}
	}
	maxImages := limits.MaxImages
	if videos > 0 && limits.MaxImagesWithVideo > 0 {
		maxImages = min(maxImages, limits.MaxImagesWithVideo)
	}
	if images > maxImages || total > limits.MaxTotal {
		return fmt.Errorf("reference limit exceeded: at most %d images and %d materials for this combination", maxImages, limits.MaxTotal)
	}
	if total > 0 {
		for _, name := range limits.RequiredSlots {
			if !seen[name] {
				return fmt.Errorf("reference slot %s is required", name)
			}
		}
	}
	keep := gjson.GetBytes(body, "keep_original_sound")
	if keep.Exists() && keep.Type != gjson.True && keep.Type != gjson.False {
		return fmt.Errorf("keep_original_sound must be boolean")
	}
	if keep.Bool() && !limits.KeepOriginalSound {
		return fmt.Errorf("original sound is unsupported by this model")
	}
	if keep.Bool() && videos == 0 {
		return fmt.Errorf("keep_original_sound requires a reference video")
	}
	sound := gjson.GetBytes(body, "sound").String() == "on"
	if sound && (keep.Bool() || (videos > 0 && limits.DisableGeneratedAudioWithVideo)) {
		return fmt.Errorf("generated audio conflicts with the selected reference settings")
	}
	shots := gjson.GetBytes(body, "prefer_multi_shots")
	if shots.Exists() && (mode.String() != "reference" || !limits.PreferMultiShots || (shots.Type != gjson.True && shots.Type != gjson.False)) {
		return fmt.Errorf("prefer_multi_shots must be boolean in reference mode")
	}
	if limits.MultiShotsRequired && shots.Exists() && !shots.Bool() {
		return fmt.Errorf("this model requires prefer_multi_shots=true")
	}
	return nil
}
