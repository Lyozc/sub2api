package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestKlingRelaySubmissionKeyForwarding(t *testing.T) {
	var method, key, prefer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, key, prefer = r.Method, r.Header.Get("Idempotency-Key"), r.Header.Get("Prefer")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"task_id":"original","task_status":"submitted"}}`))
	}))
	defer server.Close()
	account := &Account{Platform: PlatformKling, Credentials: map[string]any{"base_url": server.URL, "api_key": "ak|sk"}}
	ctx := WithKlingSubmissionKey(context.Background(), "scoped-key")
	_, err := (&OpenAIGatewayService{}).ForwardKling(ctx, nil, account, KlingEndpointText2Video, "", []byte(`{"prompt":"test"}`))
	require.NoError(t, err)
	require.Equal(t, "POST", method)
	require.Equal(t, "scoped-key", key)
	require.Empty(t, prefer, "keep acknowledgement-based billing compatible")
	_, err = (&OpenAIGatewayService{}).ForwardKling(ctx, nil, account, KlingEndpointQueryVideo, "original", nil)
	require.NoError(t, err)
	require.Equal(t, "GET", method)
	require.Empty(t, key, "do not send creation idempotency keys with status requests")
}
