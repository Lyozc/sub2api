package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/handler"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStudioChatUsesOwnedKeyAndPreservesConversation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	called := false
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		c.Next()
		require.Equal(t, "/api/v1/studio/chat", c.Request.URL.Path)
	})
	router.POST("/api/v1/studio/chat", prepareStudioChat(newStudioAIRouteKeyService(7)), func(c *gin.Context) {
		called = true
		require.Equal(t, "Bearer test-owned-key", c.GetHeader("Authorization"))
		require.Equal(t, "/v1/chat/completions", c.Request.URL.Path)
		body, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		require.Equal(t, int64(len(body)), c.Request.ContentLength)
		require.JSONEq(t, `{"model":"chat-model","stream":true,"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"hi"},{"role":"user","content":"follow up"}]}`, string(body))
		c.Header("Content-Type", "text/event-stream")
		c.String(200, "data: [DONE]\n\n")
	})
	body := `{"key_id":11,"model":" chat-model ","stream":false,"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"hi"},{"role":"user","content":"follow up"}]}`
	req := httptest.NewRequest("POST", "/api/v1/studio/chat", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.True(t, called)
	require.Equal(t, 200, rec.Code)
	require.Contains(t, rec.Header().Get("Content-Type"), "text/event-stream")
}

func TestStudioChatRejectsInvalidRequestsBeforeGateway(t *testing.T) {
	gin.SetMode(gin.TestMode)
	valid := `{"key_id":11,"model":"chat-model","messages":[{"role":"user","content":"hello"}]}`
	for _, tc := range []struct {
		name, body    string
		user, keyUser int64
		status        int
	}{
		{"no subject", valid, 0, 7, 401},
		{"foreign key", valid, 7, 8, 400},
		{"bad JSON", "{", 7, 7, 400},
		{"no key", `{"model":"chat-model","messages":[{"role":"user","content":"hello"}]}`, 7, 7, 400},
		{"no model", `{"key_id":11,"messages":[{"role":"user","content":"hello"}]}`, 7, 7, 400},
		{"empty", `{"key_id":11,"model":"chat-model","messages":[]}`, 7, 7, 400},
		{"whitespace", strings.Replace(valid, `"hello"`, `"  "`, 1), 7, 7, 400},
		{"tool role", strings.Replace(valid, `"user"`, `"tool"`, 1), 7, 7, 400},
		{"assistant last", strings.Replace(valid, `"user"`, `"assistant"`, 1), 7, 7, 400},
		{"long message", strings.Replace(valid, "hello", strings.Repeat("x", 32001), 1), 7, 7, 400},
		{"late system", `{"key_id":11,"model":"chat-model","messages":[{"role":"user","content":"hello"},{"role":"system","content":"bad"},{"role":"user","content":"hello"}]}`, 7, 7, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(func(c *gin.Context) {
				if tc.user > 0 {
					c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: tc.user})
				}
				c.Next()
			})
			called := false
			r.POST("/chat", prepareStudioChat(newStudioAIRouteKeyService(tc.keyUser)), func(c *gin.Context) { called = true })
			req := httptest.NewRequest("POST", "/chat", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			require.Equal(t, tc.status, rec.Code)
			require.False(t, called)
		})
	}
}

func TestStudioChatRejectsUnavailableKeys(t *testing.T) {
	for _, change := range []func(*service.APIKey){func(k *service.APIKey) { k.Status = "inactive" }, func(k *service.APIKey) { k.GroupID = nil }, func(k *service.APIKey) { zero := int64(0); k.GroupID = &zero }} {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
			c.Next()
		})
		group := int64(10)
		key := &service.APIKey{ID: 11, UserID: 7, Key: "secret", Status: service.StatusAPIKeyActive, GroupID: &group}
		change(key)
		keys := service.NewAPIKeyService(&studioAIRouteKeyRepo{key: key}, nil, nil, nil, nil, nil, nil)
		called := false
		r.POST("/chat", prepareStudioChat(keys), func(c *gin.Context) { called = true })
		req := httptest.NewRequest("POST", "/chat", strings.NewReader(`{"key_id":11,"model":"chat-model","messages":[{"role":"user","content":"hello"}]}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		require.Equal(t, 400, rec.Code)
		require.False(t, called)
	}
}

func TestStudioChatRouteRetainsGatewayMiddleware(t *testing.T) {
	r := gin.New()
	called := false
	RegisterStudioAIRoutes(r, &handler.Handlers{}, middleware.JWTAuthMiddleware(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		c.Next()
	}), middleware.APIKeyAuthMiddleware(func(c *gin.Context) {
		called = true
		require.Contains(t, c.Request.URL.Path, "/v1/chat/completions")
		c.AbortWithStatusJSON(429, gin.H{"error": gin.H{"message": "limited"}})
	}), newStudioAIRouteKeyService(7), nil, nil, nil, nil, &config.Config{Gateway: config.GatewayConfig{MaxBodySize: 1024 * 1024}}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/studio/chat", strings.NewReader(`{"key_id":11,"model":"chat-model","messages":[{"role":"user","content":"hello"}]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	require.True(t, called)
	require.Equal(t, 429, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
}
