package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Studio chat opts in to SSE even before the upstream has returned headers.
// During long reasoning/queue intervals send comments so the client and its
// proxies can distinguish a live connection from a lost one. The gateway
// still sees only its own status and bytes for failover, Ops and billing.
func studioChatKeepalive(interval time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if interval <= 0 || !strings.Contains(c.GetHeader("Accept"), "text/event-stream") {
			c.Next()
			return
		}
		writer := newStudioChatWriter(c.Writer)
		c.Writer = writer
		ctx, stop := context.WithCancel(c.Request.Context())
		done := make(chan struct{})
		go func() {
			defer close(done)
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case now := <-ticker.C:
					if !writer.heartbeat(now, interval) {
						return
					}
				}
			}
		}()
		defer func() {
			stop()
			<-done
			c.Writer = writer.ResponseWriter
		}()
		c.Next()
		writer.finish()
	}
}

type studioChatWriter struct {
	gin.ResponseWriter
	// Only gateway code accesses header. The heartbeat writes standard SSE
	// headers directly to the real writer and never touches this map.
	header        http.Header
	mu            sync.Mutex
	status, size  int
	heartbeatSent bool
	isSSE         bool
	lastWrite     time.Time
	tail          string // up to three bytes, enough to recognize LF or CRLF event separators
	lateJSON      bytes.Buffer
	tooLarge      bool
}

func newStudioChatWriter(base gin.ResponseWriter) *studioChatWriter {
	return &studioChatWriter{ResponseWriter: base, header: base.Header().Clone(), status: base.Status(), size: -1}
}

func (w *studioChatWriter) Header() http.Header { return w.header }
func (w *studioChatWriter) Status() int         { return w.status }
func (w *studioChatWriter) Size() int           { return w.size }
func (w *studioChatWriter) Written() bool       { return w.size >= 0 }

func (w *studioChatWriter) WriteHeader(status int) {
	if status > 0 && !w.Written() {
		w.status = status
	}
}

func (w *studioChatWriter) WriteHeaderNow() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
}

func (w *studioChatWriter) commit() {
	if w.Written() {
		return
	}
	w.size = 0
	w.isSSE = strings.Contains(strings.ToLower(w.header.Get("Content-Type")), "text/event-stream")
	if w.heartbeatSent {
		return
	}
	header := w.ResponseWriter.Header()
	clear(header)
	for key, values := range w.header {
		header[key] = values
	}
	w.ResponseWriter.WriteHeader(w.status)
	w.ResponseWriter.WriteHeaderNow()
}

func (w *studioChatWriter) heartbeat(now time.Time, interval time.Duration) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.Written() {
		if !w.isSSE {
			return false
		}
		if w.size > 0 && !strings.HasSuffix(w.tail, "\n\n") && !strings.HasSuffix(w.tail, "\n\r\n") {
			return true
		}
	}
	if now.Sub(w.lastWrite) < interval {
		return true
	}
	if !w.Written() && !w.heartbeatSent {
		h := w.ResponseWriter.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Accel-Buffering", "no")
		h.Del("Content-Length")
		w.ResponseWriter.WriteHeader(http.StatusOK)
	}
	if _, err := w.ResponseWriter.WriteString(": keepalive\n\n"); err != nil {
		return false
	}
	w.ResponseWriter.Flush()
	w.lastWrite = now
	w.heartbeatSent = true
	return true
}

func (w *studioChatWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	if w.heartbeatSent && !w.isSSE {
		// Only a non-streaming fallback after an idle heartbeat is buffered.
		// The Studio accepts at most 200k characters of reply text.
		const limit = 4 << 20
		if len(data) > limit-w.lateJSON.Len() {
			w.tooLarge = true
		}
		if !w.tooLarge {
			_, _ = w.lateJSON.Write(data)
		}
		w.size += len(data)
		return len(data), nil
	}
	n, err := w.ResponseWriter.Write(data)
	w.size += n
	w.lastWrite = time.Now()
	if w.isSSE && n > 0 {
		if n >= 3 {
			w.tail = string(data[n-3 : n])
		} else {
			w.tail += string(data[:n])
			w.tail = w.tail[max(0, len(w.tail)-3):]
		}
	}
	return n, err
}

func (w *studioChatWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }

func (w *studioChatWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	w.ResponseWriter.Flush()
}

func (w *studioChatWriter) finish() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.commit()
	if !w.heartbeatSent || w.isSSE {
		return
	}
	var event bytes.Buffer
	// A slow upstream may return ordinary JSON (including errors) even when
	// asked to stream. Surface that result as a complete, single-line SSE event.
	if !w.tooLarge && json.Compact(&event, w.lateJSON.Bytes()) == nil {
		var envelope struct {
			Error json.RawMessage `json:"error"`
		}
		if w.status < http.StatusBadRequest || (json.Unmarshal(event.Bytes(), &envelope) == nil && len(envelope.Error) > 0 && string(envelope.Error) != "null") {
			w.sendJSONEvent(event.Bytes())
			return
		}
	}
	message := http.StatusText(w.status)
	if w.status < http.StatusBadRequest || message == "" {
		message = "The chat service returned an invalid reply"
	}
	var detail struct {
		Message string `json:"message"`
	}
	if w.status >= http.StatusBadRequest && !w.tooLarge && json.Unmarshal(w.lateJSON.Bytes(), &detail) == nil && detail.Message != "" {
		message = detail.Message
	}
	payload, _ := json.Marshal(gin.H{"error": gin.H{"message": message}})
	w.sendJSONEvent(payload)
}

func (w *studioChatWriter) sendJSONEvent(payload []byte) {
	_, _ = w.ResponseWriter.WriteString("data: " + string(payload) + "\n\ndata: [DONE]\n\n")
	w.ResponseWriter.Flush()
}
