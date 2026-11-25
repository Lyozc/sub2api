package routes

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/handler"
	"github.com/Wei-Shaw/sub2api/internal/pkg/apicompat"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStudioChatForwardsMultimodalHistoryToResponses(t *testing.T) {
	const pngFile = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
	pdfFile := base64.StdEncoding.EncodeToString([]byte("%PDF-1.4\nfixture\n%%EOF"))
	textFile := base64.StdEncoding.EncodeToString([]byte("\uFEFF原始报告\n"))
	body := fmt.Sprintf(`{"model":"gpt-6.2-astra","key_id":11,"messages":[{"role":"user","content":"阅读这一页","attachments":[{"name":"p.png","type":"image/png","data":%q},{"name":"报告.pdf","type":"application/pdf","data":%q}]},{"role":"assistant","content":"收到了"},{"role":"user","attachments":[{"name":"备注.md","type":"text/plain","data":%q}]}]}`, pngFile, pdfFile, textFile)
	called := false
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7}) })
	r.POST("/studio", prepareStudioChat(newStudioAIRouteKeyService(7)), func(c *gin.Context) {
		called = true
		require.Equal(t, "/v1/chat/completions", c.Request.URL.Path)
		require.Equal(t, "Bearer test-owned-key", c.GetHeader("Authorization"))
		var cc apicompat.ChatCompletionsRequest
		require.NoError(t, json.NewDecoder(c.Request.Body).Decode(&cc))
		require.True(t, cc.Stream)
		require.Equal(t, "max", cc.ReasoningEffort)
		require.Len(t, cc.Messages, 3)
		require.JSONEq(t, `"收到了"`, string(cc.Messages[1].Content))
		responses, err := apicompat.ChatCompletionsToResponses(&cc)
		require.NoError(t, err)
		var input []apicompat.ResponsesInputItem
		require.NoError(t, json.Unmarshal(responses.Input, &input))
		require.Len(t, input, 3)
		require.JSONEq(t, fmt.Sprintf(`[{"type":"input_text","text":"阅读这一页"},{"type":"input_image","image_url":"data:image/png;base64,%s"},{"type":"input_file","filename":"报告.pdf","file_data":"data:application/pdf;base64,%s"}]`, pngFile, pdfFile), string(input[0].Content))
		require.JSONEq(t, `[{"type":"input_text","text":"\n\n[备注.md]\n原始报告\n"}]`, string(input[2].Content))
		c.Status(http.StatusNoContent)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("POST", "/studio", strings.NewReader(body)))
	require.True(t, called, rec.Body.String())
}

func TestStudioChatRejectsInvalidAttachments(t *testing.T) {
	secret := base64.StdEncoding.EncodeToString([]byte("private attachment content"))
	file := studioChatAttachment{Name: "test.txt", Type: "text/plain", Data: secret}
	for _, tc := range []struct {
		name, role string
		files      []studioChatAttachment
	}{
		{"assistant attachment", "assistant", []studioChatAttachment{file}},
		{"system attachment", "system", []studioChatAttachment{file}},
		{"six files", "user", []studioChatAttachment{file, file, file, file, file, file}},
		{"unsupported type", "user", []studioChatAttachment{{Name: "script.exe", Type: "application/octet-stream", Data: secret}}},
		{"path", "user", []studioChatAttachment{{Name: "../file.txt", Type: "text/plain", Data: secret}}},
		{"control in name", "user", []studioChatAttachment{{Name: "bad\n.txt", Type: "text/plain", Data: secret}}},
		{"invalid base64", "user", []studioChatAttachment{{Name: "x.txt", Type: "text/plain", Data: "https://example.org/file"}}},
		{"too much text", "user", []studioChatAttachment{{Name: "x.txt", Type: "text/plain", Data: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("a"), studioChatTextFileBytes+1))}}},
		{"binary as text", "user", []studioChatAttachment{{Name: "x.txt", Type: "text/plain", Data: "/wA="}}},
		{"empty text", "user", []studioChatAttachment{{Name: "x.txt", Type: "text/plain", Data: "IA=="}}},
		{"wrong image format", "user", []studioChatAttachment{{Name: "x.webp", Type: "image/webp", Data: secret}}},
		{"wrong PDF format", "user", []studioChatAttachment{{Name: "x.pdf", Type: "application/pdf", Data: secret}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := studioChatGatewayMessages([]studioChatMessage{{Role: tc.role, Content: "x", Attachments: tc.files}})
			require.Error(t, err)
			require.NotContains(t, err.Error(), secret)
		})
	}
}

func TestStudioChatAttachmentLimitsAcrossHistory(t *testing.T) {
	pdf := make([]byte, studioChatFileBytes)
	copy(pdf, "%PDF-1.4\n")
	file := studioChatAttachment{Name: "large.pdf", Type: "application/pdf", Data: base64.StdEncoding.EncodeToString(pdf)}
	_, _, err := file.part(studioChatFileBytes - 1)
	require.Error(t, err)
	messages := []studioChatMessage{{Role: "user", Attachments: []studioChatAttachment{file, file}}, {Role: "assistant", Content: "received"}, {Role: "user", Attachments: []studioChatAttachment{file}}}
	_, err = studioChatGatewayMessages(messages)
	require.NoError(t, err)
	messages[2].Attachments = append(messages[2].Attachments, studioChatAttachment{Name: "x.txt", Type: "text/plain", Data: "YQ=="})
	_, err = studioChatGatewayMessages(messages)
	require.Error(t, err)
}

func TestStudioChatHonorsSmallerWireLimitEvenAfterValidJSON(t *testing.T) {
	body := `{"key_id":11,"model":"chat-model","messages":[{"role":"user","content":"hello"}]}`
	r := gin.New()
	RegisterStudioAIRoutes(r, &handler.Handlers{}, func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 7})
		c.Next()
	}, nil, newStudioAIRouteKeyService(7), nil, nil, nil, nil, &config.Config{Gateway: config.GatewayConfig{MaxBodySize: int64(len(body) + 1)}}, nil)
	req := httptest.NewRequest("POST", "/api/v1/studio/chat", strings.NewReader(body+"  "))
	req.ContentLength = -1
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	require.Equal(t, 413, rec.Code)
}
