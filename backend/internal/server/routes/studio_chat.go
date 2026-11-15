package routes

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// Resolve a user-owned key on the server, then reuse the authenticated gateway
// chain for routing, streaming, limits, and billing. No key is put in history.
func prepareStudioChat(keys *service.APIKeyService) gin.HandlerFunc {
	return func(c *gin.Context) {
		subject, ok := middleware.GetAuthSubjectFromContext(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "User not authenticated"})
			return
		}
		var req struct {
			KeyID    int64  `json:"key_id"`
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if c.ShouldBindJSON(&req) != nil || req.KeyID <= 0 || strings.TrimSpace(req.Model) == "" || len(req.Model) > 256 || len(req.Messages) == 0 || len(req.Messages) > 200 {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "Choose an API key and model, and provide 1–200 text messages"})
			return
		}
		total := 0
		for index, message := range req.Messages {
			length := utf8.RuneCountInString(message.Content)
			total += length
			if (message.Role != "user" && message.Role != "assistant" && !(message.Role == "system" && index == 0)) || strings.TrimSpace(message.Content) == "" || length > 32000 || total > 200000 {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "Invalid message role or text length"})
				return
			}
		}
		if req.Messages[len(req.Messages)-1].Role != "user" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "The last message must be a user message"})
			return
		}
		if keys == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"message": "API key service unavailable"})
			return
		}
		key, err := keys.GetByID(c.Request.Context(), req.KeyID)
		if err != nil || key == nil || key.UserID != subject.UserID || key.Status != service.StatusAPIKeyActive || key.GroupID == nil || *key.GroupID <= 0 {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "The selected API key is unavailable"})
			return
		}
		payload, err := json.Marshal(gin.H{"model": strings.TrimSpace(req.Model), "messages": req.Messages, "stream": true})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "Invalid chat request"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(payload))
		c.Request.ContentLength = int64(len(payload))
		originalPath := c.Request.URL.Path
		c.Request.URL.Path = "/v1/chat/completions"
		defer func() { c.Request.URL.Path = originalPath }()
		c.Request.Header.Set("Authorization", "Bearer "+key.Key)
		c.Request.Header.Set("Content-Type", "application/json")
		c.Next()
	}
}
