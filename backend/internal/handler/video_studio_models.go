package handler

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/xai"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

// videoStudioModelPattern 与视频工作台前端一致的视频模型识别规则。
var videoStudioModelPattern = regexp.MustCompile(`(?i)(video|imagine|seedance|veo|sora|kling)`)

func isVideoStudioModel(id, platform string) bool {
	lower := strings.ToLower(id)
	isGrokImage := platform == service.PlatformGrok && xai.IsGrokImagineImageModel(id)
	return videoStudioModelPattern.MatchString(id) && !strings.Contains(lower, "image") && !isGrokImage
}

// VideoStudioModels 聚合用户全部视频分组的视频模型,按分组标注返回
// (多个 grok/composite 视频分组同台),供前端按模型所属分组路由生成请求。
// apiKeyService 由 routes 闭包注入(每分组一把工作台密钥已在 relay 中确保)。
func (h *GatewayHandler) VideoStudioModels(c *gin.Context, apiKeyService *service.APIKeyService, dreamina *OpenAIGatewayHandler) {
	if apiKeyService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"message": "api key service unavailable"}})
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"message": "User not authenticated"}})
		return
	}
	groups, err := apiKeyService.VideoStudioGroups(c.Request.Context(), subject.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"message": err.Error()}})
		return
	}

	type modelItem struct {
		ID            string                               `json:"id"`
		GroupID       int64                                `json:"group_id"`
		GroupName     string                               `json:"group_name"`
		Platform      string                               `json:"platform"`
		Provider      string                               `json:"provider,omitempty"`
		Capabilities  map[string]service.VideoCapabilities `json:"capabilities,omitempty"`
		UnitPrices    map[string]float64                   `json:"unit_prices,omitempty"`
		ProUnitPrices map[string]float64                   `json:"pro_unit_prices,omitempty"`
	}
	out := make([]modelItem, 0)
	seen := map[string]bool{}
	for i := range groups {
		g := &groups[i]
		pricingGroup := *g
		if !g.VideoRateIndependent {
			pricingGroup.RateMultiplier = h.gatewayService.ResolveUserGroupRateMultiplier(c.Request.Context(), subject.UserID, g.ID, g.RateMultiplier)
		}
		ids := h.studioAvailableModels(c.Request.Context(), g)
		if g.ModelAllowlistEnabled() {
			ids = g.ModelAllowlist.FilterForListing(ids)
		}
		for _, id := range ids {
			id = strings.TrimSpace(id)
			key := fmt.Sprintf("%d:%s", g.ID, id)
			if id == "" || seen[key] || !isVideoStudioModel(id, g.Platform) {
				continue
			}
			seen[key] = true
			var proPrices map[string]float64
			if g.Platform == service.PlatformKling {
				proPrices = service.VideoStudioUnitPrices(id+"-pro", &pricingGroup)
			}
			out = append(out, modelItem{ID: id, GroupID: g.ID, GroupName: g.Name, Platform: string(g.Platform), Capabilities: service.VideoStudioCapabilities(id), UnitPrices: service.VideoStudioUnitPrices(id, &pricingGroup), ProUnitPrices: proPrices})
		}
	}
	if dreamina != nil {
		gateway := dreamina.gatewayService
		if gateway != nil {
			for i := range groups {
				g := &groups[i]
				if g.Platform != service.PlatformKling {
					continue
				}
				ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
				account, err := gateway.DreaminaRelayAccount(ctx, g.ID)
				var models []service.DreaminaModel
				if err == nil {
					models, _ = gateway.DreaminaModels(ctx, account)
				}
				cancel()
				pricingGroup := *g
				pricingGroup.RateMultiplier = h.gatewayService.ResolveUserGroupRateMultiplier(c.Request.Context(), subject.UserID, g.ID, g.RateMultiplier)
				for _, model := range models {
					if !service.IsDreaminaModel(model.ID) || !g.ModelAllowlist.Allows(model.ID) {
						continue
					}
					capabilities := model.VideoStudioCapabilities()
					if len(capabilities) == 0 {
						continue
					}
					out = append(out, modelItem{ID: model.ID, GroupID: g.ID, GroupName: g.Name, Platform: g.Platform, Provider: "dreamina", Capabilities: capabilities, UnitPrices: service.DreaminaVideoStudioUnitPrices(model.ID, &pricingGroup)})
				}
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": out})
}
