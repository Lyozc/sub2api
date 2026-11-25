package routes

import (
	"bufio"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStudioChatKeepalivePreservesEarlyHTTPError(t *testing.T) {
	r := gin.New()
	r.GET("/", studioChatKeepalive(time.Hour), func(c *gin.Context) {
		c.Header("Retry-After", "30")
		c.JSON(http.StatusTooManyRequests, gin.H{"message": "retry later"})
	})
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept", "text/event-stream, application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	require.Equal(t, 429, rec.Code)
	require.Equal(t, "30", rec.Header().Get("Retry-After"))
	require.JSONEq(t, `{"message":"retry later"}`, rec.Body.String())
}

func TestStudioChatKeepaliveBeforeFirstOutputAndLateReply(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		body, event string
	}{
		{"success", 200, "{\n  \"choices\":[{\"message\":{\"content\":\"hello\"}}]\n}", `{"choices":[{"message":{"content":"hello"}}]}`},
		{"gateway error", 502, `{"error":{"message":"upstream timed out"}}`, `{"error":{"message":"upstream timed out"}}`},
		{"panel error", 403, `{"message":"key unavailable"}`, `{"error":{"message":"key unavailable"}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proceed := make(chan struct{})
			semanticSize := make(chan int, 1)
			r := gin.New()
			r.GET("/", studioChatKeepalive(10*time.Millisecond), func(c *gin.Context) {
				<-proceed
				semanticSize <- c.Writer.Size()
				c.Data(tc.status, "application/json", []byte(tc.body))
			})
			srv := httptest.NewServer(r)
			defer srv.Close()
			req, err := http.NewRequest("GET", srv.URL, nil)
			require.NoError(t, err)
			req.Header.Set("Accept", "text/event-stream")
			client := srv.Client()
			client.Timeout = 2 * time.Second
			resp, err := client.Do(req)
			if err != nil {
				close(proceed)
				t.Fatal(err)
			}
			defer func() { _ = resp.Body.Close() }()
			reader := bufio.NewReader(resp.Body)
			line, err := reader.ReadString('\n')
			close(proceed)
			require.NoError(t, err)
			require.Equal(t, ": keepalive\n", line)
			require.Equal(t, "no", resp.Header.Get("X-Accel-Buffering"))
			require.Equal(t, -1, <-semanticSize)
			body, err := io.ReadAll(reader)
			require.NoError(t, err)
			require.Contains(t, string(body), "data: "+tc.event+"\n\ndata: [DONE]\n\n")
		})
	}
}

func TestStudioChatHeartbeatWaitsForCompleteSSEFrame(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	w := newStudioChatWriter(c.Writer)
	w.Header().Set("Content-Type", "text/event-stream")
	now := time.Now().Add(time.Hour)
	_, err := w.WriteString("data: long")
	require.NoError(t, err)
	require.True(t, w.heartbeat(now, time.Second))
	require.Equal(t, "data: long", rec.Body.String())
	_, err = w.WriteString(" event\r\n")
	require.NoError(t, err)
	w.heartbeat(now, time.Second)
	require.False(t, strings.Contains(rec.Body.String(), "keepalive"))
	_, err = w.WriteString("\r\n")
	require.NoError(t, err)
	w.heartbeat(now, time.Second)
	require.Equal(t, "data: long event\r\n\r\n: keepalive\n\n", rec.Body.String())
	require.Equal(t, len("data: long event\r\n\r\n"), w.Size())
}
