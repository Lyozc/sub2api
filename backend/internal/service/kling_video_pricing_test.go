package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestKlingVideoPriceAliasesAndResolutionBilling(t *testing.T) {
	t.Parallel()
	prices := NormalizeVideoModelPrices(map[string]map[string]float64{
		"kling-4.0":             {"720p": 0.12},
		"kling-video-v4_0":      {"1080p": 0.25},
		"kling-v4-flash":        {"720p": 0},
		"kling-video-v3_0_omni": {"4k": 0.5},
		"custom-kling":          {"4k": 0.7},
	})
	require.Equal(t, map[string]float64{"720p": 0.12, "1080p": 0.25}, prices["kling-v4"])
	group := &Group{VideoModelPrices: prices, VideoRateIndependent: true, VideoRateMultiplier: 1.5}
	for _, model := range []string{"kling-v4", "kling-4.0", "kling-v4.0", "kling-v4-0", "kling-video-v4_0"} {
		price := group.GetVideoPriceForModel(model, "720p")
		require.NotNil(t, price)
		require.InDelta(t, 0.12, *price, 1e-9)
		result := (&BillingService{}).CalculateVideoCost(model, "720p", 2, 12, group.VideoPriceConfig(), 1.5)
		require.InDelta(t, 2.88, result.TotalCost, 1e-9)
		require.InDelta(t, 4.32, result.ActualCost, 1e-9)
	}
	free := (&BillingService{}).CalculateVideoCost("kling-v4.0-flash", "720p", 1, 10, group.VideoPriceConfig(), 2)
	require.Zero(t, free.ActualCost)
	high := (&BillingService{}).CalculateVideoCost("kling-v3-omni", "4k", 1, 5, group.VideoPriceConfig(), 1.5)
	require.InDelta(t, 3.75, high.ActualCost, 1e-9)
	require.Equal(t, 0.7, prices["custom-kling"]["4k"])
	quote := VideoStudioUnitPrices("kling-v3-omni", group)
	require.InDelta(t, 0.75, quote["4k"], 1e-9)
}

func TestKlingVideoPricingLegacyMapsAndFallback(t *testing.T) {
	t.Parallel()
	legacy := map[string]map[string]float64{"kling-4.0": {"720p": 0.2}}
	price := LookupVideoModelPrice(legacy, "kling-v4", "720p")
	require.NotNil(t, price)
	require.Equal(t, 0.2, *price)
	flat := 0.08
	group := &Group{VideoModelPrices: legacy, VideoPrice1080P: &flat}
	require.Equal(t, flat, *group.GetVideoPriceForModel("kling-v4", "1080p"))
	require.Nil(t, LookupVideoModelPrice(legacy, "kling-v4-flash", "720p"))
	require.Nil(t, LookupVideoModelPrice(legacy, "kling-v4-pro", "720p"))
	for input, want := range map[string]string{"kling-o1": "kling-o1", "kling-video-o1": "kling-o1", "kling-v3.0-omni": "kling-v3-omni", "kling-v2.6": "kling-v2-6", "kling-v4-pro": "kling-v4-pro"} {
		require.Equal(t, want, CanonicalVideoPriceFamily(input))
	}
}
