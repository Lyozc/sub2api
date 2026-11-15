package service

import (
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestVideoSubmissionReplayAndIsolation(t *testing.T) {
	repo := newInMemoryIdempotencyRepo()
	c := NewIdempotencyCoordinator(repo, DefaultIdempotencyConfig())
	calls := 0
	execute := func(ctx context.Context) (any, error) { calls++; return map[string]any{"id": "job-1"}, nil }
	first, err := c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", map[string]any{"duration": 5}, execute)
	require.NoError(t, err)
	require.False(t, first.Replayed)
	replay, err := c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", map[string]any{"duration": 5}, execute)
	require.NoError(t, err)
	require.True(t, replay.Replayed)
	require.Equal(t, 1, calls)
	_, err = c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", map[string]any{"duration": 10}, execute)
	require.ErrorIs(t, err, ErrIdempotencyKeyConflict)
	require.Equal(t, 1, calls)
	result, err := c.LookupVideoSubmission(context.Background(), "user-2", "test-key")
	require.NoError(t, err)
	require.Nil(t, result)
	_, err = c.ExecuteVideoSubmission(context.Background(), "user-2", "test-key", map[string]any{"duration": 5}, execute)
	require.NoError(t, err)
	require.Equal(t, 2, calls)
}

func TestVideoSubmissionNeverReclaimsUnknownAcceptance(t *testing.T) {
	repo := newInMemoryIdempotencyRepo()
	c := NewIdempotencyCoordinator(repo, DefaultIdempotencyConfig())
	calls := 0
	execute := func(ctx context.Context) (any, error) {
		calls++
		return nil, errors.New("connection lost after upstream accepted")
	}
	_, err := c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", nil, execute)
	require.Error(t, err)
	// A new coordinator simulates a process restart. It must not create a job.
	c = NewIdempotencyCoordinator(repo, DefaultIdempotencyConfig())
	_, err = c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", nil, execute)
	require.ErrorIs(t, err, ErrIdempotencyInProgress)
	require.Equal(t, 1, calls)
	_, err = c.LookupVideoSubmission(context.Background(), "user-1", "test-key")
	require.ErrorIs(t, err, ErrIdempotencyInProgress)
}

func TestVideoSubmissionConcurrentRetryAndDisconnectedClient(t *testing.T) {
	c := NewIdempotencyCoordinator(newInMemoryIdempotencyRepo(), DefaultIdempotencyConfig())
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		_, err := c.ExecuteVideoSubmission(ctx, "user-1", "test-key", nil, func(execCtx context.Context) (any, error) {
			close(started)
			<-release
			if err := execCtx.Err(); err != nil {
				return nil, err
			}
			return map[string]any{"id": "paid-job"}, nil
		})
		done <- err
	}()
	<-started
	_, err := c.ExecuteVideoSubmission(context.Background(), "user-1", "test-key", nil, func(context.Context) (any, error) { t.Error("duplicate paid job"); return nil, nil })
	require.ErrorIs(t, err, ErrIdempotencyInProgress)
	cancel()
	close(release)
	require.NoError(t, <-done)
	result, err := c.LookupVideoSubmission(context.Background(), "user-1", "test-key")
	require.NoError(t, err)
	require.Equal(t, map[string]any{"id": "paid-job"}, result.Data)
}
