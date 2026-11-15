package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

var klingVideoModelPattern = regexp.MustCompile(`^kling-(v[1-4]([.-][0-9]+)*(-flash|-omni)?|4\.0|o1)$`)

func IsKlingVideoModel(model string) bool {
	return klingVideoModelPattern.MatchString(strings.ToLower(strings.TrimSpace(model)))
}

// BuildKlingStudioRequest maps the workbench payload to Kling's native API.
func BuildKlingStudioRequest(body []byte) (KlingEndpoint, []byte, string, error) {
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return "", nil, "", errors.New("request body must be a JSON object")
	}
	if err := ValidateVideoReferences(body); err != nil {
		return "", nil, "", err
	}
	model := KlingRequestModel(body)
	prompt := strings.TrimSpace(gjson.GetBytes(body, "prompt").String())
	if !IsKlingVideoModel(model) || prompt == "" {
		return "", nil, "", errors.New("a Kling video model and prompt are required")
	}
	if duration := gjson.GetBytes(body, "duration"); duration.Exists() {
		if _, ok := positiveKlingDuration(duration); !ok {
			return "", nil, "", errors.New("kling duration must be a positive integer number of seconds")
		}
	}
	if gjson.GetBytes(body, "video_mode").Exists() || gjson.GetBytes(body, "reference_images").Exists() || gjson.GetBytes(body, "reference_media").Exists() {
		// Advanced references use the additive extension on the traditional route.
		// Its image task family also accepts media-only Omni references.
		endpoint := KlingEndpointImage2Video
		if VideoStudioRequestMode(body) == "t2v" {
			endpoint = KlingEndpointText2Video
		}
		payload := map[string]any{"model_name": model, "prompt": prompt, "duration": strconv.Itoa(KlingRequestDurationSeconds(body)), "mode": "std"}
		for _, field := range []string{"video_mode", "reference_images", "reference_media", "keep_original_sound", "prefer_multi_shots", "resolution", "sound", "negative_prompt", "cfg_scale", "mode", "aspect_ratio"} {
			if value := gjson.GetBytes(body, field); value.Exists() {
				payload[field] = value.Value()
			}
		}
		if !gjson.GetBytes(body, "resolution").Exists() {
			payload["resolution"] = VideoStudioCapabilities(model)[VideoStudioRequestMode(body)].DefaultResolution
		}
		out, err := json.Marshal(payload)
		return endpoint, out, model, err
	}
	aspect := gjson.GetBytes(body, "aspect_ratio").String()
	switch aspect {
	case "16:9", "9:16", "1:1", "21:9":
	default:
		aspect = "16:9"
	}
	payload := map[string]any{
		"model_name": model, "prompt": prompt, "mode": "std",
		"duration": strconv.Itoa(KlingRequestDurationSeconds(body)), "aspect_ratio": aspect,
	}
	endpoint := KlingEndpointText2Video
	if model == "kling-4.0" {
		endpoint = KlingEndpointKling4Text
	}
	image := gjson.GetBytes(body, "image")
	if image.IsObject() {
		image = image.Get("url")
	}
	if value := strings.TrimSpace(image.String()); value != "" && image.Type == gjson.String {
		payload["image"] = value
		if caps, known := VideoStudioCapabilities(model)["i2v"]; known && len(caps.Ratios) == 0 {
			delete(payload, "aspect_ratio")
		}
		endpoint = KlingEndpointImage2Video
		if model == "kling-4.0" {
			endpoint = KlingEndpointKling4Image
		}
	}
	var kling4Settings map[string]any
	if model == "kling-4.0" {
		kling4Settings = map[string]any{"duration": KlingRequestDurationSeconds(body), "aspect_ratio": aspect}
		payload = map[string]any{
			"prompt":   prompt,
			"settings": kling4Settings,
			"options":  map[string]any{},
		}
		if endpoint == KlingEndpointKling4Image {
			payload["contents"] = []map[string]string{{"type": "first_frame", "url": image.String()}}
			delete(kling4Settings, "aspect_ratio")
		}
	}
	if resolution := gjson.GetBytes(body, "resolution"); resolution.Exists() {
		if resolution.Type != gjson.String || (resolution.String() != "720p" && resolution.String() != "1080p" && resolution.String() != "4k") {
			return "", nil, "", errors.New("kling resolution must be 720p, 1080p or 4k")
		}
		if model == "kling-4.0" {
			kling4Settings["resolution"] = resolution.String()
		} else {
			payload["resolution"] = resolution.String()
		}
	}
	for _, field := range []string{"mode", "sound", "negative_prompt", "cfg_scale"} {
		value := gjson.GetBytes(body, field)
		if !value.Exists() {
			continue
		}
		if model == "kling-4.0" {
			return "", nil, "", fmt.Errorf("kling 4.0 dedicated API does not support %s", field)
		}
		switch field {
		case "mode":
			if value.Type != gjson.String || (value.String() != "std" && value.String() != "pro") {
				return "", nil, "", errors.New("kling mode must be std or pro")
			}
		case "sound":
			if value.Type != gjson.String || (value.String() != "on" && value.String() != "off") {
				return "", nil, "", errors.New("kling sound must be on or off")
			}
		case "negative_prompt":
			if value.Type != gjson.String || len([]rune(value.String())) > 2500 {
				return "", nil, "", errors.New("kling negative_prompt must be a string of at most 2500 characters")
			}
		case "cfg_scale":
			if value.Type != gjson.Number || value.Float() < 0 || value.Float() > 1 {
				return "", nil, "", errors.New("kling cfg_scale must be a number between 0 and 1")
			}
			payload[field] = value.Float()
			continue
		}
		payload[field] = value.String()
	}
	if !gjson.GetBytes(body, "resolution").Exists() {
		generationMode := "t2v"
		if endpoint == KlingEndpointImage2Video || endpoint == KlingEndpointKling4Image {
			generationMode = "i2v"
		}
		if resolution := VideoStudioCapabilities(model)[generationMode].DefaultResolution; resolution != "" {
			if model == "kling-4.0" {
				kling4Settings["resolution"] = resolution
			} else {
				payload["resolution"] = resolution
			}
		}
	}
	out, err := json.Marshal(payload)
	return endpoint, out, model, err
}

// The opaque workbench id carries the query family across polls and restarts;
// the native task id remains the account-binding and billing key.
func KlingStudioTaskID(endpoint KlingEndpoint, taskID string) string {
	switch endpoint {
	case KlingEndpointKling4Text, KlingEndpointKling4Image, KlingEndpointQueryKling4:
		return "kling4:" + taskID
	case KlingEndpointImage2Video, KlingEndpointQueryImage:
		return "klingi2v:" + taskID
	default:
		return taskID
	}
}

func ParseKlingStudioTaskID(id string) (KlingEndpoint, string, error) {
	endpoint := KlingEndpointQueryVideo
	if strings.HasPrefix(id, "kling4:") {
		endpoint, id = KlingEndpointQueryKling4, strings.TrimPrefix(id, "kling4:")
	} else if strings.HasPrefix(id, "klingi2v:") {
		endpoint, id = KlingEndpointQueryImage, strings.TrimPrefix(id, "klingi2v:")
	}
	if id == "" || strings.ContainsAny(id, "/\\?#&:% \t\r\n") || id == "." || id == ".." {
		return "", "", errors.New("invalid Kling task id")
	}
	return endpoint, id, nil
}

func KlingStudioResponse(endpoint KlingEndpoint, result *KlingTaskResult) gin.H {
	status, progress := "pending", 0
	switch NormalizeKlingStatus(result.Status) {
	case "processing":
		status, progress = "processing", 50
	case "succeed":
		status, progress = "completed", 100
	case "failed":
		status = "failed"
	}
	out := gin.H{"id": KlingStudioTaskID(endpoint, result.TaskID), "status": status, "progress": progress}
	if status == "failed" {
		out["error"] = gin.H{"message": firstNonEmpty(result.Message, "Kling video generation failed")}
	}
	return out
}

// Use the same public-IP-pinned transport as Grok's public content proxy. CDN
// requests carry no account credentials, client cookies, or header overrides.
var klingMediaContentClient = grokMediaPublicVideoClient

func (s *OpenAIGatewayService) ForwardKlingStudioContent(ctx context.Context, c *gin.Context, result *KlingTaskResult) error {
	if result == nil || NormalizeKlingStatus(result.Status) != "succeed" || result.URL == "" {
		return &KlingUpstreamError{StatusCode: http.StatusConflict, Message: "Kling task content is not ready"}
	}
	status, _ := json.Marshal(map[string]string{"status": "completed", "video_url": result.URL})
	contentURL, err := grokMediaPublicVideoContentURL(status, result.TaskID)
	if err != nil || contentURL == "" {
		return errors.New("kling task returned an unsupported content URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, contentURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "*/*")
	if value := c.GetHeader("Range"); value != "" {
		req.Header.Set("Range", value)
	}
	resp, err := klingMediaContentClient.Do(req)
	if err != nil {
		return fmt.Errorf("kling content download failed: %s", sanitizeStreamError(err))
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		return fmt.Errorf("kling content download returned status %d", resp.StatusCode)
	}
	return writeGrokMediaContentResponse(c, resp)
}
