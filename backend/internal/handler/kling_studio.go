package handler

import (
	"io"
	"net/http"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *OpenAIGatewayHandler) KlingStudioGeneration(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Unable to read request body")
		return
	}
	endpoint, payload, model, err := service.BuildKlingStudioRequest(body)
	if err != nil {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	h.handleKlingResponse(c, endpoint, "", payload, model, "studio")
}

func (h *OpenAIGatewayHandler) KlingStudioStatus(c *gin.Context) {
	h.klingStudioQuery(c, "studio")
}

func (h *OpenAIGatewayHandler) KlingStudioContent(c *gin.Context) {
	h.klingStudioQuery(c, "content")
}

func (h *OpenAIGatewayHandler) klingStudioQuery(c *gin.Context, responseMode string) {
	endpoint, taskID, err := service.ParseKlingStudioTaskID(c.Param("request_id"))
	if err != nil {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	h.handleKlingResponse(c, endpoint, taskID, nil, "", responseMode)
}

// VideoStudioCompositeQuery resolves the provider only after task ownership is
// confirmed. Each provider then applies its bound-account/group access checks.
func (h *OpenAIGatewayHandler) VideoStudioCompositeQuery(c *gin.Context, content bool) {
	key, ok := middleware.GetAPIKeyFromContext(c)
	subject, authenticated := middleware.GetAuthSubjectFromContext(c)
	if !ok || key == nil || !authenticated {
		c.Status(http.StatusUnauthorized)
		return
	}
	platform, err := h.gatewayService.ResolveVideoStudioTaskPlatform(c.Request.Context(), key, subject.UserID, c.Param("request_id"))
	if err != nil {
		h.errorResponse(c, http.StatusNotFound, "not_found_error", "Video request not found")
		return
	}
	if platform == service.PlatformKling {
		if content {
			h.KlingStudioContent(c)
		} else {
			h.KlingStudioStatus(c)
		}
	} else {
		if content {
			h.GrokVideoContent(c)
		} else {
			h.GrokVideoStatus(c)
		}
	}
}
