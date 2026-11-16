package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOpsErrorLoggerMiddleware_BillableWriterRestoresOuterStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, billable := range []bool{false, true} {
		for _, tc := range []struct {
			name      string
			status    int
			cancelled bool
		}{
			{name: "accepted", status: http.StatusOK},
			{name: "upstream failure", status: http.StatusBadGateway},
			{name: "client closed", status: statusClientClosedRequest, cancelled: true},
			{name: "acknowledgement after disconnect", status: http.StatusOK, cancelled: true},
		} {
			t.Run(fmt.Sprintf("%s/billable=%t", tc.name, billable), func(t *testing.T) {
				router := gin.New()
				var original, observed gin.ResponseWriter
				var status int
				router.Use(func(c *gin.Context) {
					original = c.Writer
					c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{Group: &service.Group{ReturnBillableUsage: billable}})
					c.Next()
					observed = c.Writer
					status = c.Writer.Status()
				})
				router.POST("/api/v1/video-studio/generations", OpsErrorLoggerMiddleware(nil), middleware2.BillableUsageResponse(), func(c *gin.Context) {
					if tc.status == statusClientClosedRequest {
						c.Status(tc.status)
						return
					}
					c.JSON(tc.status, gin.H{"status": "pending"})
				})
				req := httptest.NewRequest(http.MethodPost, "/api/v1/video-studio/generations", nil)
				if tc.cancelled {
					ctx, cancel := context.WithCancel(req.Context())
					cancel()
					req = req.WithContext(ctx)
				}
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, req)
				require.Same(t, original, observed)
				require.Equal(t, tc.status, status, "outer access logger must see the actual application status")
				require.Equal(t, tc.status, recorder.Code)
			})
		}
	}
}

func TestOpsErrorLoggerMiddleware_KlingErrorsKeepProviderAttribution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		errType string
		phase   string
		owner   string
		source  string
	}{
		{
			name: "Kling provider failure", status: http.StatusBadGateway,
			body:    `{"error":{"type":"kling_upstream_error","code":5000,"message":"Browser upstream unavailable; see service logs"}}`,
			errType: "upstream_error", phase: "upstream", owner: "provider", source: "upstream_http",
		},
		{
			name: "Kling provider credits", status: http.StatusPaymentRequired,
			body:    `{"error":{"type":"kling_upstream_error","code":1102,"message":"Insufficient paid credits"}}`,
			errType: "upstream_error", phase: "upstream", owner: "provider", source: "upstream_http",
		},
		{
			name: "local user balance", status: http.StatusForbidden,
			body:    `{"error":{"type":"permission_error","code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}}`,
			errType: "permission_error", phase: "request", owner: "client", source: "client_request",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupOpsErrorLogTestQueue(t, 1)
			ops := service.NewOpsService(nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{Group: &service.Group{Platform: service.PlatformKling}})
			})
			router.POST("/v1/videos", OpsErrorLoggerMiddleware(ops), middleware2.BillableUsageResponse(), func(c *gin.Context) {
				c.Data(tc.status, "application/json", []byte(tc.body))
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/videos", nil))
			require.Equal(t, tc.status, recorder.Code)
			require.Equal(t, int64(1), OpsErrorLogQueueLength())
			entry := (<-opsErrorLogQueue).entry
			require.Equal(t, tc.status, entry.StatusCode)
			require.Equal(t, service.PlatformKling, entry.Platform)
			require.Equal(t, tc.errType, entry.ErrorType)
			require.Equal(t, tc.phase, entry.ErrorPhase)
			require.Equal(t, tc.owner, entry.ErrorOwner)
			require.Equal(t, tc.source, entry.ErrorSource)
		})
	}
}
