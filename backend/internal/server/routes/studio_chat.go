package routes

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	pkghttputil "github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
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
			KeyID    int64               `json:"key_id"`
			Model    string              `json:"model"`
			Messages []studioChatMessage `json:"messages"`
		}
		decoder := json.NewDecoder(c.Request.Body)
		err := decoder.Decode(&req)
		if err == nil {
			// Consume trailing whitespace so a valid JSON prefix cannot bypass the wire limit.
			_, err = decoder.Token()
			switch err {
			case io.EOF:
				err = nil
			case nil:
				err = errors.New("invalid trailing input")
			}
		}
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"message": "Chat request exceeds the size limit"})
			return
		}
		if err != nil || req.KeyID <= 0 || strings.TrimSpace(req.Model) == "" || len(req.Model) > 256 || len(req.Messages) == 0 || len(req.Messages) > 200 {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "Choose an API key and model, and provide 1–200 messages"})
			return
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
		messages, err := studioChatGatewayMessages(req.Messages)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": err.Error()})
			return
		}
		model := strings.TrimSpace(req.Model)
		chat := gin.H{"model": model, "messages": messages, "stream": true}
		if effort := service.StudioChatReasoningEffort(model); effort != "" {
			chat["reasoning_effort"] = effort
		}
		var payload bytes.Buffer
		encoder := json.NewEncoder(&payload)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(chat); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"message": "Invalid chat request"})
			return
		}
		c.Request.Body = pkghttputil.NewPrereadBody(payload.Bytes())
		c.Request.ContentLength = int64(payload.Len())
		originalPath := c.Request.URL.Path
		c.Request.URL.Path = "/v1/chat/completions"
		defer func() { c.Request.URL.Path = originalPath }()
		c.Request.Header.Set("Authorization", "Bearer "+key.Key)
		c.Request.Header.Set("Content-Type", "application/json")
		c.Next()
	}
}
