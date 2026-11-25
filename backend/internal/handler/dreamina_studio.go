package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const dreaminaStudioEndpoint = "/api/v1/video-studio/dreamina"
const dreaminaUpstreamEndpoint = "/dreamina/v1/videos"

type dreaminaStudioTaskResponse struct {
	*service.DreaminaVideoTask
	PriceEstimate *float64 `json:"price_estimate,omitempty"`
}

func dreaminaStudioError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func writeDreaminaUpstreamError(c *gin.Context, err error) {
	var upstream *service.DreaminaUpstreamError
	if errors.As(err, &upstream) {
		if upstream.StatusCode >= 400 && upstream.StatusCode < 500 && upstream.StatusCode != 401 && upstream.StatusCode != 403 {
			if len(upstream.Body) > 0 {
				c.Data(upstream.StatusCode, "application/json", upstream.Body)
			} else {
				dreaminaStudioError(c, upstream.StatusCode, "DREAMINA_REJECTED", upstream.Message)
			}
			return
		}
		if upstream.StatusCode == http.StatusGatewayTimeout {
			dreaminaStudioError(c, 504, "DREAMINA_TIMEOUT", "Dreamina timed out. Check the original task before trying again.")
			return
		}
	}
	logger.FromContext(c.Request.Context()).Warn("Dreamina Studio upstream failed", zap.Error(err))
	dreaminaStudioError(c, 502, "DREAMINA_UNAVAILABLE", "Dreamina upstream is unavailable")
}

func (h *OpenAIGatewayHandler) dreaminaStudioAuth(c *gin.Context) (*service.APIKey, middleware.AuthSubject, bool) {
	key, validKey := middleware.GetAPIKeyFromContext(c)
	subject, authenticated := middleware.GetAuthSubjectFromContext(c)
	if !validKey || !authenticated || key == nil || key.User == nil {
		dreaminaStudioError(c, 401, "UNAUTHENTICATED", "User not authenticated")
		return nil, subject, false
	}
	if key.GroupID == nil || key.Group == nil || key.Group.Platform != service.PlatformKling || !service.GroupAllowsImageGeneration(key.Group) {
		dreaminaStudioError(c, 403, "DREAMINA_GROUP_REQUIRED", "Seedance requires a Kling video group")
		return nil, subject, false
	}
	return key, subject, true
}

func (h *OpenAIGatewayHandler) DreaminaStudioAssets(c *gin.Context) {
	key, subject, ok := h.dreaminaStudioAuth(c)
	if !ok {
		return
	}
	mimeType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || service.DreaminaAssetMediaType(mimeType) == "" {
		dreaminaStudioError(c, 415, "DREAMINA_ASSET_TYPE", "Unsupported Dreamina reference format")
		return
	}
	size := c.Request.ContentLength
	if size < 1 || size > service.DreaminaMaxAssetBytes {
		dreaminaStudioError(c, 413, "DREAMINA_ASSET_SIZE", "Dreamina reference files must be between 1 byte and 32 MiB")
		return
	}
	ctx := c.Request.Context()
	account, err := h.gatewayService.DreaminaRelayAccount(ctx, *key.GroupID)
	if err != nil {
		dreaminaStudioError(c, 503, "DREAMINA_NO_ACCOUNT", "No eligible Dreamina relay")
		return
	}
	asset, err := h.gatewayService.DreaminaUploadAsset(ctx, account, c.Request.Body, size, mimeType)
	if err != nil {
		writeDreaminaUpstreamError(c, err)
		return
	}
	binding := service.DreaminaStudioAssetBinding{AccountID: account.ID, MediaType: asset.MediaType}
	if err = h.gatewayService.StoreDreaminaStudioBinding(ctx, *key.GroupID, subject.UserID, "asset", asset.ID, binding); err != nil {
		response.ErrorFrom(c, service.ErrIdempotencyStoreUnavail)
		return
	}
	c.JSON(http.StatusOK, asset)
}

func (h *OpenAIGatewayHandler) DreaminaStudioQuotes(c *gin.Context) {
	key, subject, ok := h.dreaminaStudioAuth(c)
	if !ok {
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			dreaminaStudioError(c, 413, "DREAMINA_REQUEST_SIZE", "Dreamina quote request is too large")
		} else {
			dreaminaStudioError(c, 400, "DREAMINA_PLAN_INVALID", "Unable to read the video request")
		}
		return
	}
	var plan service.DreaminaVideoPlan
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&plan) != nil || !json.Valid(body) || !service.IsDreaminaModel(plan.Model) {
		dreaminaStudioError(c, 400, "DREAMINA_PLAN_INVALID", "Invalid Seedance request")
		return
	}
	if !key.Group.ModelAllowlist.Allows(plan.Model) {
		dreaminaStudioError(c, 404, "MODEL_NOT_ALLOWED", "Seedance model is not available in this group")
		return
	}
	if len(plan.References) > 50 || len(plan.Content) != 1 {
		dreaminaStudioError(c, 400, "DREAMINA_PLAN_INVALID", "Invalid Seedance prompt or references")
		return
	}
	clientKey, err := service.NormalizeIdempotencyKey(c.GetHeader("Idempotency-Key"))
	if err != nil || clientKey == "" {
		dreaminaStudioError(c, 400, "DREAMINA_IDEMPOTENCY_REQUIRED", "A valid Idempotency-Key is required")
		return
	}
	coordinator := service.DefaultIdempotencyCoordinator()
	if coordinator == nil {
		response.ErrorFrom(c, service.ErrIdempotencyStoreUnavail)
		return
	}

	groupID := *key.GroupID
	scope := fmt.Sprintf("dreamina.quote.%d.%d", groupID, subject.UserID)
	upstreamKey := "sub2api:" + service.HashIdempotencyKey(scope+":"+clientKey)
	opts := service.IdempotencyExecuteOptions{
		Scope: scope, Route: dreaminaStudioEndpoint + "/quotes", Method: http.MethodPost,
		IdempotencyKey: clientKey, Payload: plan, ExecutionTimeout: 195 * time.Second,
		TTL: 30 * 24 * time.Hour,
	}
	result, err := coordinator.Execute(c.Request.Context(), opts, func(ctx context.Context) (any, error) {
		account, err := h.gatewayService.DreaminaRelayAccount(ctx, groupID)
		if err != nil {
			return nil, err
		}
		for _, ref := range plan.References {
			var binding service.DreaminaStudioAssetBinding
			owned, err := h.gatewayService.LoadDreaminaStudioBinding(ctx, groupID, subject.UserID, "asset", ref.ID, &binding)
			if err != nil {
				return nil, err
			}
			if !owned || binding.MediaType != ref.MediaType || binding.AccountID != account.ID {
				return nil, &service.DreaminaUpstreamError{StatusCode: 400, Body: json.RawMessage(`{"error":{"message":"Reference is unavailable. Upload it again before requesting a quote."}}`)}
			}
		}
		models, err := h.gatewayService.DreaminaModels(ctx, account)
		if err != nil {
			return nil, err
		}
		var model *service.DreaminaModel
		for i := range models {
			if models[i].ID == plan.Model {
				model = &models[i]
				break
			}
		}
		var validationError error
		if model == nil {
			validationError = errors.New("Seedance model is unavailable on this relay")
		} else {
			validationError = model.ValidateVideo(plan)
		}
		if validationError != nil {
			raw, _ := json.Marshal(gin.H{"error": gin.H{"message": validationError.Error()}})
			return nil, &service.DreaminaUpstreamError{StatusCode: 400, Body: raw}
		}
		// Bind the same relay for retries even if the caller disconnected.
		draft := service.DreaminaStudioDraft{AccountID: account.ID, Key: upstreamKey, Plan: body, CreatedAt: time.Now()}
		resolution, _ := service.LookupVideoBillingResolution(plan.Resolution)
		if unit := service.LookupVideoModelPrice(key.Group.VideoModelPrices, plan.Model, resolution); unit != nil {
			pricingGroup := *key.Group
			pricingGroup.RateMultiplier = h.gatewayService.ResolveUserGroupRateMultiplier(ctx, subject.UserID, groupID, key.Group.RateMultiplier)
			total := service.DreaminaVideoStudioUnitPrices(plan.Model, &pricingGroup)[resolution] * float64(plan.Duration)
			if total >= 0 && !math.IsNaN(total) && !math.IsInf(total, 0) {
				draft.UnitPrice = unit
				draft.Total = &total
			}
		}
		task, err := h.gatewayService.DreaminaVideoQuote(ctx, account, draft.Plan, draft.Key)
		if err != nil {
			return nil, err
		}
		if err = h.gatewayService.StoreDreaminaStudioBinding(ctx, groupID, subject.UserID, "task", task.ID, draft); err != nil {
			return nil, service.ErrIdempotencyStoreUnavail.WithCause(err)
		}
		return dreaminaStudioTaskResponse{task, draft.Total}, nil
	})
	if err != nil {
		var upstream *service.DreaminaUpstreamError
		if errors.As(err, &upstream) {
			writeDreaminaUpstreamError(c, err)
		} else if errors.Is(err, service.ErrNoAvailableAccounts) {
			dreaminaStudioError(c, 503, "DREAMINA_NO_ACCOUNT", "No eligible Dreamina relay")
		} else if errors.Is(err, service.ErrIdempotencyInProgress) || errors.Is(err, service.ErrIdempotencyRetryBackoff) ||
			errors.Is(err, service.ErrIdempotencyKeyConflict) || errors.Is(err, service.ErrIdempotencyStoreUnavail) {
			response.ErrorFrom(c, err)
		} else {
			writeDreaminaUpstreamError(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, result.Data)
}

func (h *OpenAIGatewayHandler) dreaminaStudioLoad(c *gin.Context, key *service.APIKey, userID int64) (*service.Account, *service.DreaminaStudioDraft, string) {
	id := c.Param("request_id")
	if !service.IsDreaminaTaskID(id) {
		dreaminaStudioError(c, 404, "DREAMINA_TASK_NOT_FOUND", "Seedance task not found")
		return nil, nil, ""
	}
	ctx := c.Request.Context()
	var draft service.DreaminaStudioDraft
	found, err := h.gatewayService.LoadDreaminaStudioBinding(ctx, *key.GroupID, userID, "task", id, &draft)
	if err != nil {
		response.ErrorFrom(c, service.ErrIdempotencyStoreUnavail)
		return nil, nil, ""
	}
	if !found {
		dreaminaStudioError(c, 404, "DREAMINA_TASK_NOT_FOUND", "Seedance task not found")
		return nil, nil, ""
	}
	account, err := h.gatewayService.DreaminaBoundRelay(ctx, *key.GroupID, draft.AccountID)
	if err != nil {
		dreaminaStudioError(c, 503, "DREAMINA_BOUND_ACCOUNT", "The original Dreamina relay is unavailable")
		return nil, nil, ""
	}
	setOpsSelectedAccount(c, account.ID, account.Platform)
	return account, &draft, id
}

func (h *OpenAIGatewayHandler) DreaminaStudioApprove(c *gin.Context) {
	key, subject, ok := h.dreaminaStudioAuth(c)
	if !ok {
		return
	}
	account, draft, id := h.dreaminaStudioLoad(c, key, subject.UserID)
	if draft == nil {
		return
	}
	var approval struct {
		Ceiling *int `json:"approved_credit_ceiling"`
	}
	if c.ShouldBindJSON(&approval) != nil || approval.Ceiling == nil || *approval.Ceiling < 0 || *approval.Ceiling > math.MaxInt32 {
		dreaminaStudioError(c, 400, "DREAMINA_APPROVAL_INVALID", "A valid approved credit ceiling is required")
		return
	}
	var plan service.DreaminaVideoPlan
	if json.Unmarshal(draft.Plan, &plan) != nil || !key.Group.ModelAllowlist.Allows(plan.Model) {
		dreaminaStudioError(c, 404, "MODEL_NOT_ALLOWED", "Seedance model is not available in this group")
		return
	}
	if draft.Total == nil || draft.UnitPrice == nil {
		dreaminaStudioError(c, 409, "DREAMINA_PRICE_REQUIRED", "Configure the Seedance model and resolution price in the video group, then request a new quote.")
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 195*time.Second)
	defer cancel()
	c.Request = c.Request.WithContext(ctx)
	subscription, _ := middleware.GetSubscriptionFromContext(c)
	if h.billingCacheService == nil {
		response.ErrorFrom(c, service.ErrBillingServiceUnavailable)
		return
	}
	// Query first to make a repeated approval a read even after credits were used.
	task, err := h.gatewayService.DreaminaVideoStatus(ctx, account, id)
	if err != nil {
		writeDreaminaUpstreamError(c, err)
		return
	}
	if task.Relay.Phase == "awaiting_approval" {
		if !account.IsSchedulable() {
			dreaminaStudioError(c, 503, "DREAMINA_BOUND_ACCOUNT", "The original Dreamina relay is paused")
			return
		}
		if task.Relay.MaxCredits == nil || *approval.Ceiling > *task.Relay.MaxCredits {
			dreaminaStudioError(c, 409, "DREAMINA_APPROVAL_INVALID", "Review the latest quote before approving the credit ceiling")
			return
		}
		if err = h.billingCacheService.CheckBillingEligibility(ctx, key.User, key, key.Group, subscription, service.PlatformKling); err != nil {
			writeDreaminaBillingError(c, err)
			return
		}
		reservation, err := h.billingCacheService.ReserveFixedCharge(ctx, key.User, key, key.Group, subscription, *draft.Total)
		if err != nil {
			writeDreaminaBillingError(c, err)
			return
		}
		if reservation != nil {
			defer reservation.HandlerDone()
		}
		task, err = h.gatewayService.DreaminaVideoApprove(ctx, account, draft.Plan, draft.Key, id, *approval.Ceiling)
		if err != nil {
			writeDreaminaUpstreamError(c, err)
			return
		}
	}
	if !h.dreaminaStudioRecordSuccess(c, key, account, draft, task) {
		return
	}
	c.JSON(http.StatusOK, dreaminaStudioTaskResponse{task, draft.Total})
}

func writeDreaminaBillingError(c *gin.Context, err error) {
	status, code, message, retryAfter := billingErrorDetails(err)
	if retryAfter > 0 {
		c.Header("Retry-After", strconv.Itoa(retryAfter))
	}
	dreaminaStudioError(c, status, code, message)
}

func (h *OpenAIGatewayHandler) DreaminaStudioTask(c *gin.Context, content bool) {
	key, subject, ok := h.dreaminaStudioAuth(c)
	if !ok {
		return
	}
	account, draft, id := h.dreaminaStudioLoad(c, key, subject.UserID)
	if draft == nil {
		return
	}
	ctx := c.Request.Context()
	task, err := h.gatewayService.DreaminaVideoStatus(ctx, account, id)
	if err != nil {
		writeDreaminaUpstreamError(c, err)
		return
	}
	if !h.dreaminaStudioRecordSuccess(c, key, account, draft, task) {
		return
	}
	if !content {
		c.JSON(http.StatusOK, dreaminaStudioTaskResponse{task, draft.Total})
		return
	}
	if task.Status != "succeeded" {
		dreaminaStudioError(c, 409, "DREAMINA_VIDEO_NOT_READY", "Seedance video is not ready")
		return
	}
	video, err := h.gatewayService.DreaminaVideoContent(ctx, account, id)
	if err != nil {
		writeDreaminaUpstreamError(c, err)
		return
	}
	defer video.Body.Close()
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, video.ContentLength, "video/mp4", video.Body, nil)
}

func (h *OpenAIGatewayHandler) dreaminaStudioRecordSuccess(c *gin.Context, key *service.APIKey, account *service.Account, draft *service.DreaminaStudioDraft, task *service.DreaminaVideoTask) bool {
	if task.Status != "succeeded" {
		return true
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 12*time.Second)
	defer cancel()
	bindingID := service.DreaminaStudioUsagePrefix + task.ID
	claimed, err := h.gatewayService.ClaimGrokVideoBilling(ctx, bindingID, key.User.ID, key.ID)
	if err == nil && !claimed {
		return true
	}
	var plan service.DreaminaVideoPlan
	if err == nil {
		err = json.Unmarshal(draft.Plan, &plan)
	}
	if err == nil && draft.Total != nil && draft.UnitPrice != nil {
		subscription, _ := middleware.GetSubscriptionFromContext(c)
		result := &service.OpenAIForwardResult{
			Model: plan.Model, BillingModel: plan.Model, UpstreamModel: plan.Model, RequestID: bindingID,
			ResponseID: task.ID, VideoCount: 1, VideoResolution: strings.ToLower(plan.Resolution),
			VideoDurationSeconds: plan.Duration, Duration: time.Since(draft.CreatedAt),
			DreaminaVideoQuote: &service.CostBreakdown{TotalCost: *draft.UnitPrice * float64(plan.Duration), ActualCost: *draft.Total, BillingMode: string(service.BillingModeVideo)},
		}
		err = h.gatewayService.RecordUsage(ctx, &service.OpenAIRecordUsageInput{
			Result: result, APIKey: key, User: key.User, Account: account, Subscription: subscription,
			InboundEndpoint: dreaminaStudioEndpoint + "/tasks", UpstreamEndpoint: dreaminaUpstreamEndpoint,
			APIKeyService: h.apiKeyService, QuotaPlatform: service.PlatformKling,
			RequestPayloadHash: service.HashUsageRequestPayload(draft.Plan),
		})
	} else if err == nil {
		err = errors.New("approved video has no pricing snapshot")
	}
	if err == nil {
		return true
	}
	if claimed {
		_ = h.gatewayService.ReleaseGrokVideoBilling(ctx, bindingID, key.User.ID, key.ID)
	}
	logger.FromContext(ctx).Warn("Unable to record Seedance usage", zap.String("task_id", task.ID), zap.Error(err))
	dreaminaStudioError(c, 503, "DREAMINA_BILLING_UNAVAILABLE", "The video is ready. Retry the original task to finalize billing.")
	return false
}
