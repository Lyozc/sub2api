package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"image"
	"image/png"
	"testing"
)

func TestVideoStudioDurationLimits(t *testing.T) {
	for _, tc := range []struct {
		model    string
		min, max int
		discrete bool
	}{
		{"grok-imagine-video", 1, 15, false},
		{"grok-imagine-video-1.5", 1, 15, false},
		{"grok-imagine-video-1.5-preview", 1, 15, false},
		{"grok-imagine-video-1.5-lite", 1, 15, false},
		{"kling-v2-5-turbo", 5, 10, true},
		{"kling-video-v2_6", 5, 10, true},
		{"kling-video-o1", 3, 10, false},
		{"kling-v3", 3, 15, false},
		{"kling-v3.0-omni", 3, 15, false},
		{"kling-video-v3_0_turbo", 3, 15, false},
		{"kling-v4", 3, 30, false},
		{"kling-v4-0", 3, 30, false},
		{"kling-4.0", 3, 30, false},
		{"kling-v4-flash", 3, 20, false},
		{"kling-v4.0-flash", 3, 20, false},
		{"kling-video-v4_0_flash", 3, 20, false},
	} {
		t.Run(tc.model, func(t *testing.T) {
			for _, mode := range []string{"t2v", "i2v"} {
				var frame bytes.Buffer
				require.NoError(t, png.Encode(&frame, image.NewRGBA(image.Rect(0, 0, 300, 300))))
				for seconds := 0; seconds <= 31; seconds++ {
					payload := map[string]any{"model": tc.model, "duration": seconds, "prompt": "ocean"}
					if mode == "i2v" {
						payload["image"] = map[string]string{"url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(frame.Bytes())}
					}
					body, err := json.Marshal(payload)
					require.NoError(t, err)
					valid := seconds >= tc.min && seconds <= tc.max
					if tc.discrete {
						valid = seconds == 5 || seconds == 10
					}
					err = ValidateVideoStudioRequest(body)
					if valid {
						require.NoError(t, err, "%s %ds", mode, seconds)
					} else {
						require.Error(t, err, "%s %ds", mode, seconds)
					}
				}
			}
			for _, value := range []string{"-1", "1.5", `"5"`, "null", "true", "1e100"} {
				body := fmt.Sprintf(`{"model":%q,"duration":%s,"prompt":"ocean"}`, tc.model, value)
				require.Error(t, ValidateVideoStudioRequest([]byte(body)), value)
			}
		})
	}
}

func TestVideoStudioRequestCapabilities(t *testing.T) {
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{"model":"kling-v2-6","duration":5,"prompt":"ocean","resolution":"720p","sound":"off"}`, true},
		{`{"model":"kling-v2-6","duration":7,"prompt":"ocean"}`, false},
		{`{"model":"kling-v2-6","duration":5,"prompt":"ocean","resolution":"720p","sound":"on"}`, false},
		{`{"model":"kling-v2-6","duration":5,"prompt":"ocean","resolution":"1080p","sound":"on"}`, true},
		{`{"model":"kling-v4","duration":23,"prompt":"ocean","aspect_ratio":"21:9"}`, true},
		{`{"model":"kling-v4-flash","duration":23,"prompt":"ocean"}`, false},
		{`{"model":"kling-v4","duration":5,"prompt":"ocean","mode":"pro"}`, false},
		{`{"model":"kling-v4","duration":5,"prompt":"ocean","sound":"on"}`, false},
		{`{"model":"kling-v4","duration":5,"prompt":"ocean","cfg_scale":0.5}`, false},
		{`{"model":"kling-v4","duration":5,"prompt":"ocean","negative_prompt":"blur"}`, false},
		{`{"model":"kling-v4","duration":5,"prompt":"ocean","resolution":"4k"}`, false},
		{`{"model":"kling-v3","duration":15,"prompt":"ocean","resolution":"4k"}`, true},
	} {
		t.Run(tc.body, func(t *testing.T) {
			err := ValidateVideoStudioRequest([]byte(tc.body))
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestVideoStudioFirstFrameValidation(t *testing.T) {
	request := func(width, height int, ratio string) []byte {
		var buf bytes.Buffer
		require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, width, height))))
		payload := map[string]any{"model": "kling-v2-6", "duration": 5, "prompt": "ocean", "image": map[string]string{"url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())}}
		if ratio != "" {
			payload["aspect_ratio"] = ratio
		}
		body, err := json.Marshal(payload)
		require.NoError(t, err)
		return body
	}
	require.NoError(t, ValidateVideoStudioRequest(request(600, 400, "")))
	require.Error(t, ValidateVideoStudioRequest(request(600, 400, "16:9")))
	require.Error(t, ValidateVideoStudioRequest(request(100, 100, "")))
	require.Error(t, ValidateVideoStudioRequest(request(1000, 300, "")))
	require.Error(t, ValidateVideoStudioRequest([]byte(`{"model":"kling-v4","duration":5,"prompt":"ocean","image":{"url":"data:image/png;base64,aW52YWxpZA=="}}`)))
}

func TestVideoStudioEstimateUsesBillingMultiplier(t *testing.T) {
	price := 0.1
	group := &Group{RateMultiplier: 3, VideoPrice720P: &price, VideoRateIndependent: true, VideoRateMultiplier: 0.5}
	require.InDelta(t, 0.05, VideoStudioUnitPrices("kling-v4", group)["720p"], 1e-9)
	group.VideoRateIndependent = false
	require.InDelta(t, 0.3, VideoStudioUnitPrices("kling-v4", group)["720p"], 1e-9)
	// The caller resolves a user-specific rate before quoting the group.
	group.RateMultiplier = 0.25
	require.InDelta(t, 0.025, VideoStudioUnitPrices("kling-v4", group)["720p"], 1e-9)
	group.RateMultiplier = -1
	require.Zero(t, VideoStudioUnitPrices("kling-v4", group)["720p"])
	require.Nil(t, VideoStudioUnitPrices("kling-v4", nil))
}

func TestVideoStudioKlingImageDoesNotInjectUnsupportedRatio(t *testing.T) {
	endpoint, body, _, err := BuildKlingStudioRequest([]byte(`{"model":"kling-v2-6","duration":5,"prompt":"ocean","image":{"url":"data:image/png;base64,xyz"}}`))
	require.NoError(t, err)
	require.Equal(t, KlingEndpointImage2Video, endpoint)
	var request map[string]any
	require.NoError(t, json.Unmarshal(body, &request))
	require.NotContains(t, request, "aspect_ratio")
}

func TestVideoStudioEstimatesMatchConfiguredModelBilling(t *testing.T) {
	flat, zero := 0.08, 0.0
	group := &Group{RateMultiplier: 1.5, VideoPrice1080P: &flat, VideoModelPrices: map[string]map[string]float64{
		"kling-v4": {"720p": 0.2}, "kling-v4-pro": {"720p": 0.3}, "kling-v4-flash": {"720p": zero},
	}}
	for _, tc := range []struct{ model, resolution string }{
		{"kling-v4", "720p"}, {"kling-4.0", "720p"}, {"kling-v4-pro", "720p"},
		{"kling-v4", "1080p"}, {"kling-v4-flash", "720p"}, {"grok-imagine-video", "720p"},
	} {
		t.Run(tc.model+tc.resolution, func(t *testing.T) {
			price, ok := VideoStudioUnitPrices(tc.model, group)[tc.resolution]
			require.True(t, ok)
			actual := (&BillingService{}).CalculateVideoCost(tc.model, tc.resolution, 2, 10, group.VideoPriceConfig(), group.RateMultiplier)
			require.InDelta(t, actual.ActualCost, price*10*2, 1e-9)
		})
	}
	require.Empty(t, VideoStudioUnitPrices("unknown-model", &Group{RateMultiplier: 1}))
	// A 480p fallback must not be presented as a configured 4K price.
	quote := VideoStudioUnitPrices("kling-v4", &Group{RateMultiplier: 1, VideoPrice480P: &flat})
	require.NotContains(t, quote, "4k")
}
