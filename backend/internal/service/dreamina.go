package service

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
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	DreaminaMaxAssetBytes    = 32 << 20
	DreaminaMaxRequestBytes  = 64 << 10
	DreaminaMaxVideoBytes    = 128 << 20
	dreaminaMaxResponseBytes = 2 << 20
)

var (
	dreaminaUUID       = regexp.MustCompile(`^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$`)
	dreaminaRequestKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,160}$`)
)

type DreaminaAsset struct {
	ID        string `json:"id"`
	MediaType string `json:"mediaType"`
}

type DreaminaVideoTask struct {
	ID     string             `json:"id"`
	Model  string             `json:"model"`
	Status string             `json:"status"`
	Relay  DreaminaRelayState `json:"relay"`
	Error  *DreaminaTaskError `json:"error,omitempty"`
	Raw    json.RawMessage    `json:"-"`
}

type DreaminaRelayState struct {
	Phase                 string          `json:"phase"`
	MaxCredits            *int            `json:"max_credits,omitempty"`
	ApprovedCreditCeiling *int            `json:"approved_credit_ceiling,omitempty"`
	Outputs               int             `json:"outputs,omitempty"`
	Unit                  string          `json:"unit,omitempty"`
	Billing               json.RawMessage `json:"billing,omitempty"`
}

type DreaminaTaskError struct {
	Message     string `json:"message"`
	ServiceCode int    `json:"service_code,omitempty"`
}

type DreaminaUpstreamError struct {
	StatusCode int
	Message    string
	Body       json.RawMessage
}

func (e *DreaminaUpstreamError) Error() string {
	return fmt.Sprintf("Dreamina returned HTTP %d: %s", e.StatusCode, e.Message)
}

func IsDreaminaTaskID(id string) bool {
	return dreaminaUUID.MatchString(id)
}

func IsDreaminaModel(model string) bool {
	return strings.HasPrefix(model, "seedance_")
}

func (s *OpenAIGatewayService) DreaminaModels(ctx context.Context, account *Account) ([]DreaminaModel, error) {
	var catalog struct {
		Data []DreaminaModel `json:"data"`
	}
	_, err := s.dreaminaJSON(ctx, account, http.MethodGet, "/models?type=video", "", "", nil, 0, &catalog)
	return catalog.Data, err
}

func (s *OpenAIGatewayService) DreaminaVideoQuote(ctx context.Context, account *Account, body []byte, idempotencyKey string) (*DreaminaVideoTask, error) {
	if !dreaminaRequestKey.MatchString(idempotencyKey) {
		return nil, errors.New("invalid Dreamina idempotency key")
	}
	if gjson.GetBytes(body, "quote_id").Exists() || gjson.GetBytes(body, "approved_credit_ceiling").Exists() {
		return nil, errors.New("credit approval is forbidden on a Dreamina quote")
	}
	return s.dreaminaVideoSubmit(ctx, account, body, idempotencyKey)
}

func (s *OpenAIGatewayService) DreaminaVideoApprove(ctx context.Context, account *Account, body []byte, idempotencyKey, quoteID string, approvedCreditCeiling int) (*DreaminaVideoTask, error) {
	if !IsDreaminaTaskID(quoteID) || !dreaminaRequestKey.MatchString(idempotencyKey) || approvedCreditCeiling < 0 || approvedCreditCeiling > math.MaxInt32 {
		return nil, errors.New("invalid Dreamina quote confirmation")
	}
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return nil, errors.New("invalid Dreamina quote body")
	}
	confirmed, err := sjson.SetBytes(body, "quote_id", quoteID)
	if err != nil {
		return nil, err
	}
	confirmed, err = sjson.SetBytes(confirmed, "approved_credit_ceiling", approvedCreditCeiling)
	if err != nil {
		return nil, err
	}
	task, err := s.dreaminaVideoSubmit(ctx, account, confirmed, idempotencyKey)
	if err == nil && task.ID != quoteID {
		return nil, errors.New("Dreamina confirmation returned a different task ID")
	}
	return task, err
}

func (s *OpenAIGatewayService) DreaminaVideoStatus(ctx context.Context, account *Account, taskID string) (*DreaminaVideoTask, error) {
	if !IsDreaminaTaskID(taskID) {
		return nil, errors.New("invalid Dreamina task ID")
	}
	var task DreaminaVideoTask
	raw, err := s.dreaminaJSON(ctx, account, http.MethodGet, "/videos/"+taskID, "", "", nil, 0, &task)
	if err != nil {
		return nil, err
	}
	if task.ID != taskID || task.Status == "" {
		return nil, errors.New("Dreamina returned an invalid task status")
	}
	task.Raw = raw
	return &task, nil
}

func DreaminaAssetMediaType(contentType string) string {
	switch contentType {
	case "image/png", "image/jpeg", "image/webp":
		return "image"
	case "video/mp4", "video/quicktime":
		return "video"
	case "audio/mpeg", "audio/wav", "audio/x-wav":
		return "audio"
	default:
		return ""
	}
}

func (s *OpenAIGatewayService) DreaminaUploadAsset(ctx context.Context, account *Account, body io.Reader, size int64, contentType string) (*DreaminaAsset, error) {
	contentType, _, err := mime.ParseMediaType(contentType)
	kind := DreaminaAssetMediaType(contentType)
	if err != nil || kind == "" || body == nil || size < 1 || size > DreaminaMaxAssetBytes {
		return nil, errors.New("invalid Dreamina reference upload")
	}
	var asset DreaminaAsset
	_, err = s.dreaminaJSON(ctx, account, http.MethodPost, "/assets", "", contentType, body, size, &asset)
	if err != nil {
		return nil, err
	}
	if !IsDreaminaTaskID(asset.ID) || asset.MediaType != kind {
		return nil, errors.New("Dreamina returned an invalid reference asset")
	}
	return &asset, nil
}

// The caller owns resp.Body and streams it after authorizing access to taskID.
func (s *OpenAIGatewayService) DreaminaVideoContent(ctx context.Context, account *Account, taskID string) (*http.Response, error) {
	if !IsDreaminaTaskID(taskID) {
		return nil, errors.New("invalid Dreamina task ID")
	}
	resp, err := s.dreaminaRequest(ctx, account, http.MethodGet, "/videos/"+taskID+"/content", "", "", nil, 0, "video/mp4")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, readDreaminaError(resp)
	}
	contentType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || contentType != "video/mp4" || resp.ContentLength < 1 || resp.ContentLength > DreaminaMaxVideoBytes {
		_ = resp.Body.Close()
		return nil, errors.New("Dreamina returned invalid video content")
	}
	return resp, nil
}

func (s *OpenAIGatewayService) dreaminaVideoSubmit(ctx context.Context, account *Account, body []byte, idempotencyKey string) (*DreaminaVideoTask, error) {
	if len(body) == 0 || len(body) > DreaminaMaxRequestBytes || !json.Valid(body) || !gjson.ParseBytes(body).IsObject() {
		return nil, errors.New("invalid Dreamina video request")
	}
	var task DreaminaVideoTask
	raw, err := s.dreaminaJSON(ctx, account, http.MethodPost, "/videos", idempotencyKey, "application/json", bytes.NewReader(body), int64(len(body)), &task)
	if err != nil {
		return nil, err
	}
	if !IsDreaminaTaskID(task.ID) || task.Status == "" {
		return nil, errors.New("Dreamina returned an invalid video task")
	}
	task.Raw = raw
	return &task, nil
}

func (s *OpenAIGatewayService) dreaminaJSON(ctx context.Context, account *Account, method, endpoint, key, contentType string, body io.Reader, size int64, out any) (json.RawMessage, error) {
	resp, err := s.dreaminaRequest(ctx, account, method, endpoint, key, contentType, body, size, "application/json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, readDreaminaError(resp)
	}
	raw, err := readUpstreamResponseBodyLimited(resp.Body, min(dreaminaMaxResponseBytes, resolveUpstreamResponseReadLimit(s.cfg)))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return nil, errors.New("Dreamina returned an invalid JSON response")
	}
	return raw, nil
}

func readDreaminaError(resp *http.Response) error {
	out := &DreaminaUpstreamError{StatusCode: resp.StatusCode, Message: http.StatusText(resp.StatusCode)}
	if resp.StatusCode < http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		// These statuses describe the server credential or transport, not the caller.
		out.StatusCode = http.StatusBadGateway
		out.Message = "Dreamina upstream authorization or transport failed"
		return out
	}
	raw, err := readUpstreamResponseBodyLimited(resp.Body, 64<<10)
	if err != nil {
		return out
	}
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &payload) == nil {
		if message := strings.TrimSpace(payload.Error.Message); message != "" {
			out.Message = message
		}
		out.Body = raw
	}
	return out
}

func (s *OpenAIGatewayService) dreaminaRequest(ctx context.Context, account *Account, method, endpoint, key, contentType string, body io.Reader, size int64, accept string) (*http.Response, error) {
	if account == nil || !account.IsKling() || s.httpUpstream == nil {
		return nil, errors.New("Dreamina requires a Kling account with an upstream transport")
	}
	base, err := s.validateUpstreamBaseURL(account.GetKlingBaseURL())
	if err != nil {
		return nil, err
	}
	destination, err := url.Parse(base)
	if err != nil || destination.User != nil || destination.RawQuery != "" || destination.Fragment != "" {
		return nil, errors.New("invalid Dreamina base URL")
	}
	suffix, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	// Kling account model URLs may end in /v1 or /v1/models. Preserve a relay
	// prefix used by operator deployments while selecting Dreamina's own path.
	prefix := strings.TrimRight(destination.Path, "/")
	for _, ending := range []string{"/dreamina/v1", "/v1/models", "/v1"} {
		if trimmed, ok := strings.CutSuffix(prefix, ending); ok {
			prefix = trimmed
			break
		}
	}
	destination.Path = prefix + "/dreamina/v1" + suffix.Path
	destination.RawPath = ""
	destination.RawQuery = suffix.RawQuery

	accessKey, secretKey := account.GetKlingAccessSecret()
	token, err := BuildKlingJWT(accessKey, secretKey, time.Now())
	if err != nil {
		return nil, err
	}
	ctx = WithHTTPUpstreamRedirectsDisabled(ctx)
	req, err := http.NewRequestWithContext(ctx, method, destination.String(), body)
	if err != nil {
		return nil, err
	}
	req.ContentLength = size
	if method == http.MethodPost {
		// A transport retry may replay a credit-bearing confirmation. The
		// caller recovers by checking the original task first.
		req.GetBody = nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", accept)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	proxyURL := ""
	if account.ProxyID != nil && account.Proxy != nil {
		proxyURL = account.Proxy.URL()
	}
	resp, err := s.httpUpstream.Do(req, proxyURL, account.ID, account.Concurrency)
	if err != nil {
		return nil, fmt.Errorf("Dreamina transport failed: %s", sanitizeStreamError(err))
	}
	return resp, nil
}
