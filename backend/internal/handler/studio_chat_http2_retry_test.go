//go:build unit

package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type studioChatResetUpstream struct {
	service.HTTPUpstream
	t       *testing.T
	streams []string
	calls   int
}

func (u *studioChatResetUpstream) Do(req *http.Request, _ string, accountID int64, _ int) (*http.Response, error) {
	u.t.Helper()
	require.Equal(u.t, int64(1), accountID)
	require.Equal(u.t, "/v1/responses", req.URL.Path)
	require.Less(u.t, u.calls, len(u.streams), "unexpected replay")
	body := u.streams[u.calls]
	u.calls++
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}, nil
}

func TestStudioChatHTTP2RetryThroughGateway(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const role = "data: " + `{"type":"response.created","response":{"id":"attempt","status":"in_progress","output":[]}}` + "\n\n"
	const reset = "data: " + `{"type":"error","code":"upstream_http2_stream_error","message":"Upstream HTTP/2 stream failed","sequence_number":0,"param":null}` + "\n\n"
	const text = "data: " + `{"type":"response.output_text.delta","delta":"answer fragment"}` + "\n\n"
	const reasoning = "data: " + `{"type":"response.reasoning_text.delta","delta":"reasoning fragment"}` + "\n\n"
	const completed = "data: " + `{"type":"response.completed","response":{"id":"attempt","status":"completed","output":[]}}` + "\n\n"
	const studioPath = "/api/v1/studio/chat"
	const apiPath = "/v1/chat/completions"

	for _, tc := range []struct {
		name, path   string
		streams      []string
		wantError    bool
		wantFragment string
	}{
		{"recovery on second attempt", studioPath, []string{role + reset, role + text + completed}, false, "answer fragment"},
		{"second reset is final", studioPath, []string{role + reset, role + reset}, true, ""},
		{"partial answer is preserved", studioPath, []string{role + text + reset}, true, "answer fragment"},
		{"reasoning commits the attempt", studioPath, []string{role + reasoning + reset}, true, "reasoning fragment"},
		{"ordinary chat endpoint", apiPath, []string{role + reset}, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := &studioChatResetUpstream{t: t, streams: tc.streams}
			account := service.Account{
				ID: 1, Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey,
				Status: service.StatusActive, Schedulable: true,
				Credentials: map[string]any{"api_key": "test-key", "pool_mode": true, "pool_mode_retry_count": 3},
				Extra:       map[string]any{"openai_responses_supported": true},
			}
			h := newOpenAIImagesSizeRoutingTestHandler(t, []service.Account{account}, upstream)
			router := gin.New()
			router.POST(tc.path, func(c *gin.Context) {
				groupID := int64(2)
				c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
					ID: 99, GroupID: &groupID, Group: &service.Group{ID: groupID, Platform: service.PlatformOpenAI},
					User: &service.User{ID: 100},
				})
				c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 100})
				// prepareStudioChat rewrites the request path while Gin retains the Studio route.
				c.Request.URL.Path = apiPath
				h.ChatCompletions(c)
			})

			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(`{"model":"gpt-6.2-astra","stream":true,"messages":[{"role":"user","content":"hello"}]}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "text/event-stream")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			body := rec.Body.String()
			require.Equal(t, len(tc.streams), upstream.calls, body)
			if tc.wantError {
				require.Equal(t, 1, strings.Count(body, "Upstream HTTP/2 stream failed"), body)
			} else {
				require.NotContains(t, body, "Upstream HTTP/2 stream failed")
				require.Equal(t, 1, strings.Count(body, "[DONE]"), body)
				require.Equal(t, 1, strings.Count(body, `"role":"assistant"`), body)
			}
			if tc.wantFragment != "" {
				require.Equal(t, 1, strings.Count(body, tc.wantFragment), body)
			}
		})
	}
}
