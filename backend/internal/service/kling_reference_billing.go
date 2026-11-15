package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/tidwall/gjson"
)

// Reuse the DNS/IP-pinned public transport; ffprobe only opens the downloaded
// local file and cannot follow network URLs embedded in a media container.
var klingReferenceProbe = probeKlingReferenceVideo

func probeKlingReferenceVideo(ctx context.Context, raw string) (float64, error) {
	if err := ValidateVideoReferenceURL(raw); err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return 0, err
	}
	resp, err := klingMediaContentClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("unable to read reference video: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	const maxBytes = 100 * 1024 * 1024
	if resp.StatusCode != 200 || resp.ContentLength > maxBytes {
		return 0, fmt.Errorf("reference video must be accessible and at most 100 MiB")
	}
	file, err := os.CreateTemp("", "kling-reference-*.media")
	if err != nil {
		return 0, err
	}
	defer func() { _ = os.Remove(file.Name()) }()
	size, copyErr := io.Copy(file, io.LimitReader(resp.Body, maxBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || size > maxBytes {
		return 0, fmt.Errorf("reference video download failed or exceeded 100 MiB")
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
	defer probeCancel()
	data, err := exec.CommandContext(probeCtx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file.Name()).Output()
	if err != nil {
		return 0, fmt.Errorf("reference video duration could not be verified")
	}
	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			Type string `json:"codec_type"`
		} `json:"streams"`
	}
	if json.Unmarshal(data, &result) != nil {
		return 0, fmt.Errorf("invalid reference video metadata")
	}
	hasVideo := false
	for _, stream := range result.Streams {
		if stream.Type == "video" {
			hasVideo = true
		}
	}
	seconds, err := strconv.ParseFloat(result.Format.Duration, 64)
	if !hasVideo || err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds > 120 {
		return 0, fmt.Errorf("reference video has no valid video duration")
	}
	return seconds, nil
}

// Input video duration is billable in addition to generated output duration.
// Never accept caller-provided durations as the source for a charge.
func KlingReferenceDurationSeconds(ctx context.Context, body []byte) (int, error) {
	total := 0.0
	count := 0
	for _, item := range gjson.GetBytes(body, "reference_media").Array() {
		name, raw := item.Get("name").String(), item.Get("url").String()
		if len(name) < 6 || name[:6] != "video_" {
			continue
		}
		count++
		if count > 5 {
			return 0, fmt.Errorf("too many reference videos")
		}
		duration, err := klingReferenceProbe(ctx, raw)
		if err != nil {
			return 0, err
		}
		total += duration
	}
	return int(math.Ceil(total)), nil
}
