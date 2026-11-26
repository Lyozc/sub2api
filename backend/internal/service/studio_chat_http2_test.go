package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStudioChatUpstreamHTTP2Reset(t *testing.T) {
	const role = `{"type":"response.created","response":{"id":"failed-attempt","status":"in_progress","output":[]}}`
	const reset = `{"type":"error","sequence_number":0,"param":null,"code":"upstream_http2_stream_error","message":"Upstream HTTP/2 stream failed"}`

	for _, tc := range []struct {
		name, progress, visible             string
		retry, external, canceled, disabled bool
	}{
		{name: "only role and queue metadata", progress: `{"type":"response.in_progress"}`, retry: true},
		{name: "exhausted or disabled", disabled: true},
		{name: "client canceled", canceled: true},
		{name: "partial text", progress: `{"type":"response.output_text.delta","delta":"partial"}`, visible: "partial"},
		{name: "hidden reasoning", progress: `{"type":"response.reasoning_text.delta","delta":"thinking"}`, visible: "reasoning_content"},
		{name: "reasoning item without converted chunk", progress: `{"type":"response.output_item.added","item":{"type":"reasoning"}}`},
		{name: "tool started", progress: `{"type":"response.output_item.added","item":{"type":"function_call","name":"search","call_id":"tool-id"}}`, visible: "tool_calls"},
		{name: "refusal", progress: `{"type":"response.refusal.delta","delta":"declined"}`, visible: "declined"},
		{name: "reported input usage", progress: `{"type":"response.in_progress","usage":{"input_tokens":13}}`},
		{name: "embedded output", progress: `{"type":"response.in_progress","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"already generated"}]}]}}`},
		{name: "unrecognized frame", progress: `{"type":"vendor.work"}`},
		{name: "malformed frame", progress: `not-json`},
		{name: "ordinary API unchanged", external: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			if !tc.external {
				c.Set(StudioChatHTTP2RetryAllowedKey, !tc.disabled)
			}
			if tc.canceled {
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			svc := &OpenAIGatewayService{}
			account := &Account{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"pool_mode": true}}
			run := func(events ...string) (*OpenAIForwardResult, error) {
				var stream strings.Builder
				_, _ = stream.WriteString(": heartbeat\n\n")
				for _, event := range events {
					if event != "" {
						_, _ = stream.WriteString("data: " + event + "\n\n")
					}
				}
				resp := &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(stream.String()))}
				return svc.handleChatStreamingResponse(resp, c, account, "gpt-6.2-astra", "gpt-6.2-astra", "gpt-6.2-astra", time.Now(), 1000)
			}
			result, err := run(role, tc.progress, reset)
			require.Error(t, err)
			var failover *UpstreamFailoverError
			require.Equal(t, tc.retry, errors.As(err, &failover))

			if tc.retry {
				require.Nil(t, result)
				require.True(t, failover.RetryableOnSameAccount)
				require.Equal(t, 1, failover.SameAccountRetryMax)
				require.False(t, c.Writer.Written())
				c.Set(StudioChatHTTP2RetryAllowedKey, false)
				result, err = run(`{"type":"response.created","response":{"id":"successful-attempt"}}`,
					`{"type":"response.output_text.delta","delta":"recovered"}`,
					`{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":8,"output_tokens":3}}}`)
				require.NoError(t, err)
				require.Equal(t, 3, result.Usage.OutputTokens)
				require.NotContains(t, rec.Body.String(), "failed-attempt")
				require.Equal(t, 1, strings.Count(rec.Body.String(), "recovered"))
				require.Equal(t, 1, strings.Count(rec.Body.String(), "[DONE]"))
				return
			}

			require.NotNil(t, result)
			require.Contains(t, rec.Body.String(), "Upstream HTTP/2 stream failed")
			if !tc.external {
				require.Contains(t, rec.Body.String(), `"code":"upstream_http2_stream_error"`)
			}
			if tc.visible != "" {
				require.Contains(t, rec.Body.String(), tc.visible)
			}
			if tc.name == "reported input usage" {
				require.Equal(t, 13, result.Usage.InputTokens)
			}
		})
	}
}
