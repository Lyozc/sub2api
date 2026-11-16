package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func referenceTestBody(model, mode string, images, media []map[string]string, extra map[string]any) []byte {
	body := map[string]any{"model": model, "prompt": "movement", "duration": 5, "video_mode": mode, "reference_images": images, "reference_media": media}
	if images == nil {
		body["reference_images"] = []any{}
	}
	if media == nil {
		body["reference_media"] = []any{}
	}
	for k, v := range extra {
		body[k] = v
	}
	out, _ := json.Marshal(body)
	return out
}
func referenceTestImages(prefix string, count int) []map[string]string {
	out := []map[string]string{}
	for i := 1; i <= count; i++ {
		out = append(out, map[string]string{"name": fmt.Sprintf("%s_%d", prefix, i), "url": fmt.Sprintf("https://example.com/%d.png", i)})
	}
	return out
}
func TestVideoStudioReferenceModelLimits(t *testing.T) {
	video := []map[string]string{{"name": "video_1", "url": "https://example.com/v.mp4"}}
	audio := []map[string]string{{"name": "audio_1", "url": "https://example.com/a.mp3"}}
	for _, model := range []string{"kling-v4", "kling-4.0", "kling-v4-flash"} {
		require.NoError(t, ValidateVideoStudioRequest(referenceTestBody(model, "reference", referenceTestImages("image", 10), video, nil)))
		require.Error(t, ValidateVideoStudioRequest(referenceTestBody(model, "reference", referenceTestImages("image", 11), video, nil)))
	}
	for _, model := range []string{"kling-o1", "kling-v3-omni"} {
		require.NoError(t, ValidateVideoStudioRequest(referenceTestBody(model, "reference", referenceTestImages("image", 7), nil, nil)))
		require.NoError(t, ValidateVideoStudioRequest(referenceTestBody(model, "reference", referenceTestImages("image", 4), video, nil)))
		require.Error(t, ValidateVideoStudioRequest(referenceTestBody(model, "reference", referenceTestImages("image", 5), video, nil)))
	}
	require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4-flash", "reference", nil, audio, nil)))
	require.NoError(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4", "reference", nil, audio, nil)))
	frames := referenceTestImages("keyframe", 8)
	frames = append(frames, map[string]string{"name": "input", "url": "https://example.com/first.png"}, map[string]string{"name": "tail_image", "url": "https://example.com/tail.png"})
	require.NoError(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4", "frames", frames, nil, nil)))
	require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4", "frames", append(frames, referenceTestImages("keyframe", 9)[8]), nil, nil)))
	require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4-flash", "frames", frames[:1], nil, nil)))
	require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v3-omni", "reference", nil, video, map[string]any{"sound": "on"})))
	require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4", "reference", nil, video, map[string]any{"sound": "on", "keep_original_sound": true})))
}

func TestVideoStudioReferenceMappingAndStrictValidation(t *testing.T) {
	images := referenceTestImages("image", 2)
	for _, model := range []string{"kling-v4", "kling-4.0", "kling-o1"} {
		body := referenceTestBody(model, "reference", images, nil, nil)
		endpoint, payload, _, err := BuildKlingStudioRequest(body)
		require.NoError(t, err)
		require.Equal(t, KlingEndpointImage2Video, endpoint)
		require.Equal(t, "reference", gjson.GetBytes(payload, "video_mode").String())
		require.Equal(t, "image_2", gjson.GetBytes(payload, "reference_images.1.name").String())
		require.Equal(t, KlingStudioTaskID(endpoint, "job"), "klingi2v:job")
	}
	for _, extra := range []map[string]any{
		{"reference_images": nil}, {"reference_images": map[string]any{}}, {"keep_original_sound": "true"}, {"prefer_multi_shots": "true"}, {"image": map[string]string{"url": "https://example.com/a.png"}},
		{"reference_images": append(images, images[0])},
		{"reference_media": []map[string]any{{"name": "video_1", "url": "https://example.com/v.mp4", "duration": 1}}},
	} {
		require.Error(t, ValidateVideoStudioRequest(referenceTestBody("kling-v4", "reference", images, nil, extra)), extra)
	}
	for _, raw := range []string{"file:///etc/passwd", "http://localhost/a", "http://127.0.0.1/a", "http://10.0.0.1/a", "http://[::ffff:127.0.0.1]/a", "https://user:pass@example.com/a"} {
		require.Error(t, ValidateVideoReferenceURL(raw), raw)
	}
}

func TestVideoStudioOriginalSoundRequiresReferenceVideo(t *testing.T) {
	images := referenceTestImages("image", 4)
	for _, tc := range []struct {
		name  string
		media []map[string]string
		keep  bool
		valid bool
	}{
		{name: "images without original sound", keep: false, valid: true},
		{name: "images cannot retain sound", keep: true},
		{name: "audio cannot retain video sound", media: []map[string]string{{"name": "audio_1", "url": "https://example.com/a.mp3"}}, keep: true},
		{name: "video can retain sound", media: []map[string]string{{"name": "video_1", "url": "https://example.com/v.mp4"}}, keep: true, valid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateVideoStudioRequest(referenceTestBody("kling-v4", "reference", images, tc.media, map[string]any{"keep_original_sound": tc.keep}))
			if tc.valid {
				require.NoError(t, err)
			} else {
				require.ErrorContains(t, err, "requires a reference video")
			}
		})
	}
}

func TestKlingReferenceVideoDurationBillingUsesVerifiedMedia(t *testing.T) {
	original := klingReferenceProbe
	t.Cleanup(func() { klingReferenceProbe = original })
	count := 0
	klingReferenceProbe = func(ctx context.Context, raw string) (float64, error) {
		count++
		require.Equal(t, "https://example.com/v.mp4", raw)
		return 3.2, nil
	}
	media := []map[string]string{{"name": "video_1", "url": "https://example.com/v.mp4"}, {"name": "video_2", "url": "https://example.com/v.mp4"}, {"name": "audio_1", "url": "https://example.com/a.mp3"}}
	seconds, err := KlingReferenceDurationSeconds(context.Background(), referenceTestBody("kling-v4", "reference", nil, media, map[string]any{"reference_duration": 0}))
	require.NoError(t, err)
	require.Equal(t, 7, seconds)
	require.Equal(t, 2, count)
	klingReferenceProbe = func(context.Context, string) (float64, error) { return 0, errors.New("unavailable media") }
	_, err = KlingReferenceDurationSeconds(context.Background(), referenceTestBody("kling-v4", "reference", nil, media, nil))
	require.ErrorContains(t, err, "unavailable")
}

func TestKlingReferenceProbeRealMedia(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("runtime media tools are required")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("runtime media tools are required")
	}
	path := filepath.Join(t.TempDir(), "clip.mp4")
	data, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x320:r=10", "-t", "3.2", "-c:v", "mpeg4", path).CombinedOutput()
	require.NoError(t, err, string(data))
	bytes, err := os.ReadFile(path)
	require.NoError(t, err)
	original := klingMediaContentClient
	t.Cleanup(func() { klingMediaContentClient = original })
	calls := 0
	klingMediaContentClient = &http.Client{Transport: klingRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		require.Empty(t, req.Header.Get("Authorization"))
		require.Empty(t, req.Header.Get("Cookie"))
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(bytes))), ContentLength: int64(len(bytes)), Header: make(http.Header)}, nil
	})}
	_, err = probeKlingReferenceVideo(context.Background(), "http://127.0.0.1/private.mp4")
	require.Error(t, err)
	require.Zero(t, calls)
	seconds, err := probeKlingReferenceVideo(context.Background(), "https://example.com/clip.mp4")
	require.NoError(t, err)
	require.InDelta(t, 3.2, seconds, 0.05)
	media := []map[string]string{{"name": "video_1", "url": "https://example.com/clip.mp4"}, {"name": "video_2", "url": "https://example.com/clip.mp4"}}
	billed, err := KlingReferenceDurationSeconds(context.Background(), referenceTestBody("kling-v4", "reference", nil, media, nil))
	require.NoError(t, err)
	require.Equal(t, 7, billed)
}
