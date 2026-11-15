package service

import (
	"context"
	"encoding/json"
	"time"
)

// Video submissions cannot be reclaimed: an upstream may have accepted a job
// even when the gateway crashed before saving its acknowledgement.
func (c *IdempotencyCoordinator) ExecuteVideoSubmission(ctx context.Context, scope, key string, payload any, execute func(context.Context) (any, error)) (*IdempotencyExecuteResult, error) {
	key, err := NormalizeIdempotencyKey(key)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, ErrIdempotencyKeyRequired
	}
	fingerprint, err := BuildIdempotencyFingerprint("POST", "/video-studio/generations", scope, payload)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Minute)
	defer cancel()
	now := time.Now()
	expires := now.Add(30 * 24 * time.Hour)
	record := &IdempotencyRecord{Scope: scope, IdempotencyKeyHash: HashIdempotencyKey(key), RequestFingerprint: fingerprint, Status: IdempotencyStatusProcessing, ExpiresAt: expires, LockedUntil: &expires}
	owner, err := c.repo.CreateProcessing(ctx, record)
	if err != nil {
		return nil, ErrIdempotencyStoreUnavail.WithCause(err)
	}
	if !owner {
		existing, err := c.repo.GetByScopeAndKeyHash(ctx, scope, record.IdempotencyKeyHash)
		if err != nil || existing == nil {
			return nil, ErrIdempotencyStoreUnavail
		}
		if existing.RequestFingerprint != fingerprint {
			return nil, ErrIdempotencyKeyConflict
		}
		return videoSubmissionResult(existing)
	}
	// An execution error or panic leaves the reservation in place. Never assume
	// that a lost upstream response means it is safe to create another paid job.
	data, err := execute(ctx)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer persistCancel()
	if err = c.repo.MarkSucceeded(persistCtx, record.ID, 200, string(body), expires); err != nil {
		return nil, ErrIdempotencyStoreUnavail.WithCause(err)
	}
	return &IdempotencyExecuteResult{Data: data}, nil
}

func videoSubmissionResult(record *IdempotencyRecord) (*IdempotencyExecuteResult, error) {
	if record.Status != IdempotencyStatusSucceeded || record.ResponseBody == nil {
		return nil, ErrIdempotencyInProgress
	}
	var data any
	if err := json.Unmarshal([]byte(*record.ResponseBody), &data); err != nil {
		return nil, ErrIdempotencyStoreUnavail
	}
	return &IdempotencyExecuteResult{Data: data, Replayed: true}, nil
}

func (c *IdempotencyCoordinator) LookupVideoSubmission(ctx context.Context, scope, key string) (*IdempotencyExecuteResult, error) {
	key, err := NormalizeIdempotencyKey(key)
	if err != nil {
		return nil, err
	}
	record, err := c.repo.GetByScopeAndKeyHash(ctx, scope, HashIdempotencyKey(key))
	if err != nil {
		return nil, ErrIdempotencyStoreUnavail.WithCause(err)
	}
	if record == nil {
		return nil, nil
	}
	return videoSubmissionResult(record)
}
