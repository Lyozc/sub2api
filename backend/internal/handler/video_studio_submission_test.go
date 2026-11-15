package handler

import (
	"bytes"
	"fmt"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVideoStudioInvalidDurationNeverReachesUpstream(t *testing.T) {
	router := gin.New()
	calls := 0
	router.POST("/generations", func(c *gin.Context) {
		VideoStudioGenerationOnce(c, func(c *gin.Context) { calls++; c.Status(202) })
	})
	for _, body := range []string{
		`{"model":"grok-imagine-video","duration":16,"prompt":"ocean"}`,
		`{"model":"grok-imagine-video-1.5","duration":16,"prompt":"ocean"}`,
		`{"model":"grok-imagine-video-1.5-preview","duration":30,"prompt":"ocean"}`,
		`{"model":"grok-imagine-video-1.5-lite","duration":0,"prompt":"ocean"}`,
		`{"model":"kling-v4","duration":31,"prompt":"ocean"}`,
		`{"model":"kling-v4-flash","duration":21,"prompt":"ocean"}`,
		`{"model":"kling-v2-6","duration":6,"prompt":"ocean"}`,
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("POST", "/generations", bytes.NewBufferString(body)))
		require.Equal(t, 400, rec.Code)
		require.Contains(t, rec.Body.String(), "VIDEO_PARAMETER_INVALID")
	}
	require.Zero(t, calls)
}

func TestVideoStudioSubmissionReceipt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service.SetDefaultIdempotencyCoordinator(service.NewIdempotencyCoordinator(newUserMemoryIdempotencyRepoStub(), service.DefaultIdempotencyConfig()))
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	calls := 0
	router := gin.New()
	router.Use(withUserSubject(1))
	router.POST("/generations", func(c *gin.Context) {
		VideoStudioGenerationOnce(c, func(c *gin.Context) {
			calls++
			require.NoError(t, c.Request.Context().Err())
			c.JSON(http.StatusAccepted, gin.H{"id": "job-1"})
		})
	})
	router.GET("/submissions/:submission_id", VideoStudioSubmission)
	key := fmt.Sprintf("%d-key", time.Now().UnixMilli())
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", key)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	body := `{"model":"kling-v4","duration":5,"prompt":"ocean"}`
	first := request("POST", "/generations", body)
	require.Equal(t, 202, first.Code)
	require.JSONEq(t, `{"id":"job-1"}`, first.Body.String())
	replay := request("POST", "/generations", body)
	require.Equal(t, 202, replay.Code)
	require.Equal(t, "true", replay.Header().Get("X-Idempotency-Replayed"))
	require.Equal(t, 1, calls)
	receipt := request("GET", "/submissions/"+key, "")
	require.Equal(t, 202, receipt.Code)
	require.JSONEq(t, first.Body.String(), receipt.Body.String())
	require.Equal(t, 400, request("POST", "/generations", `{"model":"kling-v4-flash","duration":23,"prompt":"ocean"}`).Code)
	key = "1-old-key"
	require.Equal(t, 400, request("POST", "/generations", body).Code)
	require.Equal(t, 1, calls)
}

func TestVideoStudioFailureReceiptNeverResubmits(t *testing.T) {
	service.SetDefaultIdempotencyCoordinator(service.NewIdempotencyCoordinator(newUserMemoryIdempotencyRepoStub(), service.DefaultIdempotencyConfig()))
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	router := gin.New()
	router.Use(withUserSubject(1))
	calls := 0
	router.POST("/generations", func(c *gin.Context) {
		VideoStudioGenerationOnce(c, func(c *gin.Context) {
			calls++
			c.JSON(503, gin.H{"error": gin.H{"message": "unknown upstream outcome"}})
		})
	})
	router.GET("/submissions/:submission_id", VideoStudioSubmission)
	key := fmt.Sprintf("%d-failure", time.Now().UnixMilli())
	for _, method := range []string{"POST", "POST", "GET"} {
		path := "/generations"
		if method == "GET" {
			path = "/submissions/" + key
		}
		req := httptest.NewRequest(method, path, bytes.NewBufferString(`{"model":"kling-v4","duration":5,"prompt":"ocean"}`))
		req.Header.Set("Idempotency-Key", key)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, 503, rec.Code)
	}
	require.Equal(t, 1, calls)
}
