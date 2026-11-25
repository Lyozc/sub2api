package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// DreaminaStudioDraft keeps the request and relay account used to obtain the
// quote. An approval uses this snapshot, never a replacement request body.
type DreaminaStudioDraft struct {
	AccountID int64           `json:"account_id"`
	Key       string          `json:"key"`
	Plan      json.RawMessage `json:"plan"`
	UnitPrice *float64        `json:"unit_price,omitempty"`
	Total     *float64        `json:"total,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

func dreaminaStudioCacheKey(groupID, userID int64, kind, id string) string {
	return fmt.Sprintf("dreamina:studio:%d:%d:%s:%s", groupID, userID, kind, id)
}

func (s *OpenAIGatewayService) StoreDreaminaStudioBinding(ctx context.Context, groupID, userID int64, kind, id string, binding any) error {
	if s.cache == nil {
		return errors.New("video task storage is unavailable")
	}
	data, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	ttl := 30 * 24 * time.Hour
	if kind == "asset" {
		ttl = 24 * time.Hour
	}
	return s.cache.SetGrokVideoPendingBilling(ctx, dreaminaStudioCacheKey(groupID, userID, kind, id), data, ttl)
}

func (s *OpenAIGatewayService) LoadDreaminaStudioBinding(ctx context.Context, groupID, userID int64, kind, id string, out any) (bool, error) {
	if s.cache == nil {
		return false, errors.New("video task storage is unavailable")
	}
	data, err := s.cache.GetGrokVideoPendingBilling(ctx, dreaminaStudioCacheKey(groupID, userID, kind, id))
	if err != nil || len(data) == 0 {
		return false, err
	}
	err = json.Unmarshal(data, out)
	return err == nil, err
}

type DreaminaStudioAssetBinding struct {
	AccountID int64  `json:"account_id"`
	MediaType string `json:"media_type"`
}

const DreaminaStudioUsagePrefix = "dreamina-video:"
