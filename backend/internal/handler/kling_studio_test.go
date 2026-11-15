//go:build unit

package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

type klingStudioUsageRepo struct {
	service.UsageLogRepository
	logs []*service.UsageLog
}

func (r *klingStudioUsageRepo) Create(_ context.Context, log *service.UsageLog) (bool, error) {
	r.logs = append(r.logs, log)
	return true, nil
}

func TestKlingStudioHandlerDispatchAndBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, model := range []string{"kling-v3", "kling-4.0"} {
		t.Run(model, func(t *testing.T) {
			calls, reject := 0, false
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if reject {
					_, _ = w.Write([]byte(`{"code":1102,"message":"balance insufficient"}`))
					return
				}
				if r.Method == http.MethodPost {
					body, err := io.ReadAll(r.Body)
					require.NoError(t, err)
					if model == "kling-4.0" {
						require.Equal(t, "/text-to-video/kling-4.0", r.URL.Path)
						require.Equal(t, "10", gjson.GetBytes(body, "settings.duration").String())
						_, _ = w.Write([]byte(`{"code":0,"data":{"id":"task","status":"submitted"}}`))
					} else {
						require.Equal(t, "/v1/videos/text2video", r.URL.Path)
						require.Equal(t, "std", gjson.GetBytes(body, "mode").String())
						_, _ = w.Write([]byte(`{"code":0,"data":{"task_id":"task","task_status":"submitted"}}`))
					}
					return
				}
				if model == "kling-4.0" {
					require.Equal(t, "/tasks?task_ids=task", r.URL.String())
					_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"task","status":"succeeded","outputs":[{"type":"video","url":"https://s15-kling.klingai.com/video.mp4"}]}]}`))
				} else {
					require.Equal(t, "/v1/videos/text2video/task", r.URL.Path)
					_, _ = w.Write([]byte(`{"code":0,"data":{"task_id":"task","task_status":"succeed","task_result":{"videos":[{"url":"https://s15-kling.klingai.com/video.mp4"}]}}}`))
				}
			}))
			defer upstream.Close()
			cfg := &config.Config{RunMode: config.RunModeSimple}
			cfg.Default.RateMultiplier = 1
			cfg.Security.URLAllowlist.AllowInsecureHTTP = true
			repo := grokMediaSlotRepo{openAIImagesFailoverAccountRepo: openAIImagesFailoverAccountRepo{accounts: []service.Account{{
				ID: 1, Platform: service.PlatformKling, Type: service.AccountTypeAPIKey, Status: service.StatusActive,
				Schedulable: true, Concurrency: 50, GroupIDs: []int64{24},
				Credentials: map[string]any{"api_key": "ak|sk", "base_url": upstream.URL},
			}}}}
			slots := &grokMediaSlotsCache{accounts: map[string]int64{}, users: map[string]int64{}}
			concurrency := service.NewConcurrencyService(slots)
			bindings := &grokMediaSlotBindings{}
			usage := &klingStudioUsageRepo{}
			transport := &grokMediaSlotUpstream{call: func(req *http.Request, _ int64) (*http.Response, error) { return http.DefaultClient.Do(req) }}
			gateway := service.NewOpenAIGatewayService(repo, usage, nil, nil, nil, nil, bindings, cfg, nil, concurrency, service.NewBillingService(cfg, nil), nil, nil, transport, nil, nil, nil, nil, nil, nil, nil, nil)
			h := NewOpenAIGatewayHandler(gateway, concurrency, nil, nil, nil, nil, nil, nil, cfg)
			newContext := func(body string) (*gin.Context, *httptest.ResponseRecorder) {
				c, w := grokMediaSlotContext(context.Background(), false)
				key, _ := middleware.GetAPIKeyFromContext(c)
				key.Group.Platform = service.PlatformKling
				key.Group.RateMultiplier = 1
				price := 0.1
				key.Group.VideoPrice480P, key.Group.VideoPrice720P = &price, &price
				if body != "" {
					c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/video-studio/generations", strings.NewReader(body))
				}
				return c, w
			}
			c, w := newContext(`{"model":"` + model + `","prompt":"cat","duration":10}`)
			h.KlingStudioGeneration(c)
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			id := gjson.GetBytes(w.Body.Bytes(), "id").String()
			require.NotEmpty(t, id)
			require.Equal(t, "pending", gjson.GetBytes(w.Body.Bytes(), "status").String())
			require.Len(t, usage.logs, 1, "accepted submission must record usage")
			require.Equal(t, 1, usage.logs[0].VideoCount)
			require.Equal(t, 10, *usage.logs[0].VideoDurationSeconds)
			require.Positive(t, usage.logs[0].ActualCost)
			for range 2 {
				c, w = newContext("")
				c.Params = gin.Params{{Key: "request_id", Value: id}}
				h.KlingStudioStatus(c)
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				require.Equal(t, "completed", gjson.GetBytes(w.Body.Bytes(), "status").String())
			}
			for _, content := range []bool{false, true} {
				other, denied := newContext("")
				// Use the same context key as real API-key authentication.
				other.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 99, Concurrency: 5})
				other.Params = gin.Params{{Key: "request_id", Value: id}}
				if content {
					h.KlingStudioContent(other)
				} else {
					h.KlingStudioStatus(other)
				}
				require.Equal(t, http.StatusNotFound, denied.Code)
			}
			// Composite lookups must resolve the provider from the owner's binding,
			// including old text-to-video IDs that carry no Kling prefix.
			composite, compositeResponse := newContext("")
			compositeKey, _ := middleware.GetAPIKeyFromContext(composite)
			compositeKey.Group.Platform = service.PlatformComposite
			composite.Params = gin.Params{{Key: "request_id", Value: id}}
			h.VideoStudioCompositeQuery(composite, false)
			require.Equal(t, http.StatusOK, compositeResponse.Code, compositeResponse.Body.String())
			require.Len(t, usage.logs, 1, "polls must not charge again")
			reject = true
			c, w = newContext(`{"model":"` + model + `","prompt":"cat"}`)
			h.KlingStudioGeneration(c)
			require.Equal(t, http.StatusPaymentRequired, w.Code, w.Body.String())
			require.Len(t, usage.logs, 1, "rejected submissions must not charge")
			require.Equal(t, 5, calls)
			slots.assertReleased(t)
		})
	}
}

func TestKlingStudioHandlersRejectMalformedRequests(t *testing.T) {
	h := &OpenAIGatewayHandler{}
	for _, body := range []string{`null`, `{"model":"kling-image","prompt":"x"}`, `{"model":"kling-v3"}`} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		h.KlingStudioGeneration(c)
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}
