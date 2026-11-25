package routes

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Wei-Shaw/sub2api/internal/pkg/apicompat"
	_ "golang.org/x/image/webp"
)

const (
	studioChatFilesPerMessage = 5
	studioChatFileBytes       = 4 << 20
	studioChatTextFileBytes   = 256 << 10
	studioChatTotalFileBytes  = 12 << 20
	// 12 MiB of attachments expands to 16 MiB in base64. Leave room for
	// conversation text and JSON escaping, even for chunked requests.
	studioChatWireBytes = 20 << 20
)

type studioChatMessage struct {
	Role        string                 `json:"role"`
	Content     string                 `json:"content"`
	Attachments []studioChatAttachment `json:"attachments"`
}

type studioChatAttachment struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data string `json:"data"`
}

type studioChatGatewayMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"` // string for text-only history, []ChatContentPart when files are present
}

func studioChatGatewayMessages(messages []studioChatMessage) ([]studioChatGatewayMessage, error) {
	result := make([]studioChatGatewayMessage, 0, len(messages))
	textLength, fileBytes := 0, 0
	for i, message := range messages {
		if message.Role != "user" && message.Role != "assistant" && !(message.Role == "system" && i == 0) {
			return nil, errors.New("Invalid message role")
		}
		length := utf8.RuneCountInString(message.Content)
		textLength += length
		if length > 32000 || textLength > 200000 {
			return nil, errors.New("Message text is too long")
		}
		out := studioChatGatewayMessage{Role: message.Role, Content: message.Content}
		if len(message.Attachments) == 0 {
			if strings.TrimSpace(message.Content) == "" {
				return nil, errors.New("Message is empty")
			}
		} else {
			if message.Role != "user" || len(message.Attachments) > studioChatFilesPerMessage {
				return nil, errors.New("Only user messages may contain up to five attachments")
			}
			parts := make([]apicompat.ChatContentPart, 0, 1+len(message.Attachments))
			if strings.TrimSpace(message.Content) != "" {
				parts = append(parts, apicompat.ChatContentPart{Type: "text", Text: message.Content})
			}
			for _, file := range message.Attachments {
				part, size, err := file.part(studioChatTotalFileBytes - fileBytes)
				if err != nil {
					return nil, err
				}
				fileBytes += size
				parts = append(parts, part)
			}
			out.Content = parts
		}
		result = append(result, out)
	}
	return result, nil
}

func (file studioChatAttachment) part(remaining int) (apicompat.ChatContentPart, int, error) {
	var part apicompat.ChatContentPart
	name := strings.TrimSpace(file.Name)
	if name == "" || name == "." || name == ".." || len(name) > 255 || strings.ContainsAny(name, `/\`) || strings.IndexFunc(file.Name, unicode.IsControl) >= 0 {
		return part, 0, errors.New("Invalid attachment filename")
	}
	limit := studioChatFileBytes
	switch file.Type {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf":
	case "text/plain":
		limit = studioChatTextFileBytes
	default:
		return part, 0, errors.New("Unsupported attachment type")
	}
	// Reject large inputs before allocating the decoded copy. Strict decoding
	// and the exact decoded length check below also cover base64 padding.
	if len(file.Data) > base64.StdEncoding.EncodedLen(min(limit, remaining)) {
		return part, 0, errors.New("Attachment or total attachment size exceeds the limit")
	}
	if file.Data == "" || strings.ContainsAny(file.Data, "\r\n") {
		return part, 0, errors.New("Attachment data must be non-empty base64")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(file.Data)
	if err != nil || len(data) == 0 || len(data) > limit || len(data) > remaining {
		return part, 0, errors.New("Invalid attachment encoding or size")
	}
	switch file.Type {
	case "text/plain":
		const bom = "\uFEFF"
		text := bytes.TrimPrefix(data, []byte(bom))
		if !utf8.Valid(text) || len(bytes.TrimSpace(text)) == 0 || bytes.IndexFunc(text, invalidStudioTextControl) >= 0 {
			return part, 0, errors.New("Text attachment must contain readable UTF-8 text")
		}
		part = apicompat.ChatContentPart{Type: "text", Text: "\n\n[" + name + "]\n" + string(text)}
	case "application/pdf":
		if http.DetectContentType(data) != file.Type {
			return part, 0, errors.New("PDF attachment does not have a PDF header")
		}
		part = apicompat.ChatContentPart{Type: "file", File: &apicompat.ChatFile{Filename: name, FileData: "data:application/pdf;base64," + file.Data}}
	default:
		_, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || "image/"+format != file.Type {
			return part, 0, errors.New("Image attachment does not match the declared image format")
		}
		part = apicompat.ChatContentPart{Type: "image_url", ImageURL: &apicompat.ChatImageURL{URL: "data:" + file.Type + ";base64," + file.Data}}
	}
	return part, len(data), nil
}

func invalidStudioTextControl(r rune) bool {
	return unicode.IsControl(r) && r != '\t' && r != '\n' && r != '\r' && r != '\f'
}
