package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type videoSubmissionResponse struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

type videoSubmissionWriter struct {
	gin.ResponseWriter
	headers http.Header
	body    bytes.Buffer
	status  int
	written bool
}

func (w *videoSubmissionWriter) Header() http.Header { return w.headers }
func (w *videoSubmissionWriter) WriteHeader(status int) {
	if !w.written {
		w.status = status
	}
}
func (w *videoSubmissionWriter) WriteHeaderNow() { w.written = true }
func (w *videoSubmissionWriter) Write(b []byte) (int, error) {
	w.written = true
	return w.body.Write(b)
}
func (w *videoSubmissionWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }
func (w *videoSubmissionWriter) Status() int                       { return w.status }
func (w *videoSubmissionWriter) Size() int                         { return w.body.Len() }
func (w *videoSubmissionWriter) Written() bool                     { return w.written }
func (w *videoSubmissionWriter) Flush()                            { w.written = true }

func videoSubmissionScope(c *gin.Context) string {
	subject, ok := middleware.GetAuthSubjectFromContext(c)
	if !ok {
		return ""
	}
	return "video.studio.user." + strconv.FormatInt(subject.UserID, 10)
}

func writeVideoSubmission(c *gin.Context, result *service.IdempotencyExecuteResult) {
	raw, _ := json.Marshal(result.Data)
	var stored videoSubmissionResponse
	if json.Unmarshal(raw, &stored) != nil || stored.Status < 100 {
		c.JSON(503, gin.H{"message": "Submission acknowledgement unavailable"})
		return
	}
	if result.Replayed {
		c.Header("X-Idempotency-Replayed", "true")
	}
	c.Data(stored.Status, "application/json", []byte(stored.Body))
}

// VideoStudioGenerationOnce buffers the small acknowledgement until it has
// been committed to durable storage, independent of browser disconnection.
func VideoStudioGenerationOnce(c *gin.Context, target gin.HandlerFunc) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"message": "Invalid request body"})
		return
	}
	if err = service.ValidateVideoStudioRequest(body); err != nil {
		c.JSON(400, gin.H{"error": gin.H{"code": "VIDEO_PARAMETER_INVALID", "message": err.Error()}})
		return
	}
	key := c.GetHeader("Idempotency-Key")
	// Old keys cannot become new paid jobs after deduplication records expire.
	stamp, err := strconv.ParseInt(strings.SplitN(key, "-", 2)[0], 10, 64)
	age := time.Since(time.UnixMilli(stamp))
	if err != nil || age < -5*time.Minute || age > 7*24*time.Hour {
		c.JSON(400, gin.H{"error": gin.H{"code": "VIDEO_SUBMISSION_KEY_INVALID", "message": "Submission key is missing or expired; check the original task before creating a new video"}})
		return
	}
	coordinator := service.DefaultIdempotencyCoordinator()
	if coordinator == nil || videoSubmissionScope(c) == "" {
		c.JSON(503, gin.H{"message": "Submission tracking unavailable"})
		return
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		c.JSON(400, gin.H{"message": "Invalid JSON"})
		return
	}
	result, err := coordinator.ExecuteVideoSubmission(c.Request.Context(), videoSubmissionScope(c), key, map[string]any{"group": c.GetHeader("X-Video-Studio-Group"), "request": payload}, func(ctx context.Context) (any, error) {
		originalWriter, originalRequest := c.Writer, c.Request
		w := &videoSubmissionWriter{ResponseWriter: originalWriter, headers: make(http.Header), status: 200}
		c.Writer = w
		c.Request = c.Request.WithContext(ctx)
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		defer func() { c.Writer = originalWriter; c.Request = originalRequest }()
		target(c)
		return videoSubmissionResponse{Status: w.status, Body: w.body.String()}, nil
	})
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	writeVideoSubmission(c, result)
}

func VideoStudioSubmission(c *gin.Context) {
	coordinator := service.DefaultIdempotencyCoordinator()
	if coordinator == nil || videoSubmissionScope(c) == "" {
		c.JSON(503, gin.H{"message": "Submission tracking unavailable"})
		return
	}
	result, err := coordinator.LookupVideoSubmission(c.Request.Context(), videoSubmissionScope(c), c.Param("submission_id"))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if result == nil {
		c.JSON(404, gin.H{"error": gin.H{"code": "VIDEO_SUBMISSION_NOT_FOUND", "message": "No submission acknowledgement found; do not create another job until the original submission is confirmed"}})
		return
	}
	writeVideoSubmission(c, result)
}
