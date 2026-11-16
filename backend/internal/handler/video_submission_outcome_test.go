package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestVideoSubmissionOutcomeKeepsReceiptSeparateFromGeneration(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		outcome string
	}{
		{"accepted pending job", 200, `{"id":"klingi2v:original","status":"pending"}`, "accepted"},
		{"accepted alternative id", 202, `{"request_id":"original"}`, "accepted"},
		{"missing task id", 200, `{}`, "unknown"},
		{"invalid parameters", 400, `{"error":{"message":"reference video required"}}`, "rejected"},
		{"upstream failure", 502, `{"error":{"message":"CLI submission failed"}}`, "unknown"},
		{"timeout", 408, `{}`, "unknown"},
		{"conflict", 409, `{}`, "unknown"},
		{"rate limited", 429, `{}`, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest("GET", "/submissions/original", nil)
			writeVideoSubmission(c, &service.IdempotencyExecuteResult{
				Data:     videoSubmissionResponse{Status: tc.status, Body: tc.body},
				Replayed: true,
			})
			require.Equal(t, tc.status, rec.Code)
			require.JSONEq(t, tc.body, rec.Body.String())
			require.Equal(t, tc.outcome, rec.Header().Get("X-Video-Submission-State"))
			require.Equal(t, "true", rec.Header().Get("X-Idempotency-Replayed"))
		})
	}
}
