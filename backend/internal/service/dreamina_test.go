package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

const (
	dreaminaTestTask  = "6cd59163-77b2-39a7-a79f-0cd45ac8d0d7"
	dreaminaTestAsset = "ac126bab-20ca-4dc8-9e24-fefd8ed07672"
)

type dreaminaTransportStub struct {
	HTTPUpstream
	do func(*http.Request, int64) (*http.Response, error)
}

func (s dreaminaTransportStub) Do(req *http.Request, _ string, accountID int64, _ int) (*http.Response, error) {
	return s.do(req, accountID)
}

func TestDreaminaTransportLifecycle(t *testing.T) {
	const prefix = "/relay/dreamina/v1"
	const idempotencyKey = "studio:session:draft"
	const model = "seedance_2.0_mini"
	const plan = `{"model":"seedance_2.0_mini","content":[{"type":"text","text":"paper boat"}],"resolution":"720p","duration":4,"ratio":"16:9"}`
	const video = "video-data"
	account := &Account{
		ID: 5, Platform: PlatformKling,
		Credentials: map[string]any{"api_key": "access|secret", "base_url": "https://relay.example/relay/v1/models"},
	}
	var operations []string
	upstream := dreaminaTransportStub{do: func(req *http.Request, id int64) (*http.Response, error) {
		require.Equal(t, account.ID, id)
		require.Equal(t, "relay.example", req.URL.Host)
		require.True(t, HTTPUpstreamRedirectsDisabled(req.Context()))
		token, err := jwt.Parse(strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer "), func(token *jwt.Token) (any, error) {
			require.Equal(t, "HS256", token.Method.Alg())
			return []byte("secret"), nil
		})
		require.NoError(t, err)
		require.True(t, token.Valid)
		claims, ok := token.Claims.(jwt.MapClaims)
		require.True(t, ok)
		require.Equal(t, "access", claims["iss"])

		path := strings.TrimPrefix(req.URL.Path, prefix)
		require.NotEqual(t, req.URL.Path, path)
		reply, contentType := "", "application/json"
		switch path {
		case "/models":
			operations = append(operations, "models")
			require.Equal(t, http.MethodGet, req.Method)
			require.Equal(t, "type=video", req.URL.RawQuery)
			reply = `{"data":[{"id":"seedance_2.0_mini","displayName":"Seedance 2.0 Mini"}]}`
		case "/assets":
			operations = append(operations, "asset")
			require.Equal(t, http.MethodPost, req.Method)
			require.Equal(t, "image/png", req.Header.Get("Content-Type"))
			require.Equal(t, int64(5), req.ContentLength)
			raw, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			require.Equal(t, "image", string(raw))
			reply = fmt.Sprintf(`{"id":%q,"mediaType":"image"}`, dreaminaTestAsset)
		case "/videos":
			require.Equal(t, http.MethodPost, req.Method)
			require.Nil(t, req.GetBody)
			require.Equal(t, idempotencyKey, req.Header.Get("Idempotency-Key"))
			var body map[string]any
			require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
			if quoteID := body["quote_id"]; quoteID != nil {
				operations = append(operations, "approve")
				require.Equal(t, dreaminaTestTask, quoteID)
				require.Equal(t, float64(52), body["approved_credit_ceiling"])
				delete(body, "quote_id")
				delete(body, "approved_credit_ceiling")
				reply = fmt.Sprintf(`{"id":%q,"status":"running","relay":{"phase":"observing"}}`, dreaminaTestTask)
			} else {
				operations = append(operations, "quote")
				require.NotContains(t, body, "approved_credit_ceiling")
				reply = fmt.Sprintf(`{"id":%q,"status":"queued","relay":{"phase":"awaiting_approval","max_credits":52}}`, dreaminaTestTask)
			}
			frozen, err := json.Marshal(body)
			require.NoError(t, err)
			require.JSONEq(t, plan, string(frozen))
		case "/videos/" + dreaminaTestTask:
			operations = append(operations, "status")
			require.Equal(t, http.MethodGet, req.Method)
			reply = fmt.Sprintf(`{"id":%q,"status":"succeeded","relay":{"phase":"succeeded"}}`, dreaminaTestTask)
		case "/videos/" + dreaminaTestTask + "/content":
			operations = append(operations, "video")
			require.Equal(t, http.MethodGet, req.Method)
			require.Equal(t, "video/mp4", req.Header.Get("Accept"))
			reply, contentType = video, "video/mp4"
		default:
			t.Fatalf("unexpected path %q", path)
		}
		return &http.Response{
			StatusCode: http.StatusOK, ContentLength: int64(len(reply)),
			Header: http.Header{"Content-Type": {contentType}}, Body: io.NopCloser(strings.NewReader(reply)),
		}, nil
	}}
	service := &OpenAIGatewayService{httpUpstream: upstream}
	ctx := context.Background()

	models, err := service.DreaminaModels(ctx, account)
	require.NoError(t, err)
	require.Equal(t, model, models[0].ID)

	asset, err := service.DreaminaUploadAsset(ctx, account, strings.NewReader("image"), 5, "image/png")
	require.NoError(t, err)
	require.Equal(t, dreaminaTestAsset, asset.ID)

	quote, err := service.DreaminaVideoQuote(ctx, account, []byte(plan), idempotencyKey)
	require.NoError(t, err)
	require.Equal(t, "awaiting_approval", quote.Relay.Phase)
	require.NotNil(t, quote.Relay.MaxCredits)
	require.Equal(t, 52, *quote.Relay.MaxCredits)

	task, err := service.DreaminaVideoApprove(ctx, account, []byte(plan), idempotencyKey, quote.ID, *quote.Relay.MaxCredits)
	require.NoError(t, err)
	require.Equal(t, "observing", task.Relay.Phase)
	task, err = service.DreaminaVideoStatus(ctx, account, task.ID)
	require.NoError(t, err)
	require.Equal(t, "succeeded", task.Status)

	content, err := service.DreaminaVideoContent(ctx, account, task.ID)
	require.NoError(t, err)
	defer func() { require.NoError(t, content.Body.Close()) }()
	raw, err := io.ReadAll(content.Body)
	require.NoError(t, err)
	require.Equal(t, video, string(raw))
	require.Equal(t, []string{"models", "asset", "quote", "approve", "status", "video"}, operations)
}

func TestDreaminaRejectsUnapprovedCreditAndInvalidContent(t *testing.T) {
	account := &Account{
		Platform:    PlatformKling,
		Credentials: map[string]any{"api_key": "access|secret", "base_url": "https://relay.example"},
	}
	calls := 0
	service := &OpenAIGatewayService{httpUpstream: dreaminaTransportStub{do: func(req *http.Request, _ int64) (*http.Response, error) {
		calls++
		require.True(t, strings.HasSuffix(req.URL.Path, "/content"))
		const payload = `{"error":{"message":"Video is not ready"}}`
		return &http.Response{StatusCode: http.StatusConflict, Body: io.NopCloser(strings.NewReader(payload))}, nil
	}}}
	ctx := context.Background()
	_, err := service.DreaminaVideoQuote(ctx, account, []byte(`{"approved_credit_ceiling":90,"quote_id":"anything"}`), "secure-draft")
	require.ErrorContains(t, err, "approval is forbidden")
	_, err = service.DreaminaVideoContent(ctx, account, "../video")
	require.ErrorContains(t, err, "invalid Dreamina task ID")
	_, err = service.DreaminaVideoContent(ctx, account, dreaminaTestTask)
	var upstreamErr *DreaminaUpstreamError
	require.True(t, errors.As(err, &upstreamErr))
	require.Equal(t, http.StatusConflict, upstreamErr.StatusCode)
	require.Equal(t, "Video is not ready", upstreamErr.Message)
	require.Equal(t, 1, calls)
}

func TestDreaminaCatalogCapabilitiesAndValidation(t *testing.T) {
	flags := []DreaminaModeFlag{
		{Flag: "--duration", Min: 4, Max: 15, Step: 1},
		{Flag: "--resolution", Values: []string{"720p"}},
		{Flag: "--ratio", Values: []string{"16:9"}},
		{Flag: "--prompt", MaxLength: 4000},
	}
	model := DreaminaModel{
		ID: "seedance_2.0_mini",
		Modes: []DreaminaModelMode{
			{Name: "t2v", Flags: flags},
			{Name: "first_last_frame", Flags: flags, References: DreaminaReferences{Min: 2, Max: 2, Types: []DreaminaMediaLimit{{MediaType: "image", Min: 2, Max: 2}}}},
			{Name: "first_last_frame", Flags: flags, References: DreaminaReferences{Min: 1, Max: 1, Types: []DreaminaMediaLimit{{MediaType: "image", Min: 1, Max: 1}}}},
			{Name: "m2v", Flags: flags, References: DreaminaReferences{Min: 1, Max: 12, RequireAnyOfTypes: []string{"image", "video"}, Types: []DreaminaMediaLimit{{MediaType: "image", Max: 9}, {MediaType: "video", Max: 3}, {MediaType: "audio", Max: 3}}}},
		},
	}
	capabilities := model.VideoStudioCapabilities()
	require.Equal(t, []int{1, 2}, capabilities["i2v"].ReferenceCounts)
	require.Equal(t, []string{"input", "tail_image"}, capabilities["i2v"].References.ImageSlots)
	require.Equal(t, 12, capabilities["reference"].References.MaxTotal)
	require.True(t, capabilities["reference"].RequiresImageOrVideo)
	require.Equal(t, 3, capabilities["reference"].MaxVideos)
	require.Equal(t, 3, capabilities["reference"].MaxAudios)

	plan := DreaminaVideoPlan{Model: model.ID, Mode: "t2v", Duration: 4, Resolution: "720p", Ratio: "16:9", Content: []DreaminaTextPart{{Type: "text", Text: "paper boat"}}}
	require.NoError(t, model.ValidateVideo(plan))
	plan.Duration = 16
	require.Error(t, model.ValidateVideo(plan))
	plan.Mode, plan.Duration = "m2v", 4
	plan.References = []DreaminaAsset{{ID: dreaminaTestAsset, MediaType: "audio"}}
	require.Error(t, model.ValidateVideo(plan))
	plan.References[0].MediaType = "video"
	require.NoError(t, model.ValidateVideo(plan))
	plan.Mode, plan.Ratio = "first_last_frame", ""
	plan.Content[0].Text = ""
	plan.References[0].MediaType = "image"
	require.NoError(t, model.ValidateVideo(plan))
	plan.Ratio = "16:9"
	require.Error(t, model.ValidateVideo(plan))

	defaultPrice := 0.2
	group := &Group{
		VideoPrice720P: &defaultPrice, VideoRateIndependent: true, VideoRateMultiplier: 2,
		VideoModelPrices: map[string]map[string]float64{model.ID: {"720p": 0.05}},
	}
	require.Equal(t, map[string]float64{"720p": 0.1}, DreaminaVideoStudioUnitPrices(model.ID, group))
	require.Empty(t, DreaminaVideoStudioUnitPrices("seedance_2.5_flash", group))
}
