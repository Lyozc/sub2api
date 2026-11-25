package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode/utf8"
)

type DreaminaModel struct {
	ID          string              `json:"id"`
	DisplayName string              `json:"displayName"`
	Modes       []DreaminaModelMode `json:"modes"`
}

type DreaminaModelMode struct {
	Name       string             `json:"name"`
	Flags      []DreaminaModeFlag `json:"flags"`
	References DreaminaReferences `json:"references"`
}

type DreaminaModeFlag struct {
	Flag      string   `json:"flag"`
	Values    []string `json:"values"`
	Min       int      `json:"min"`
	Max       int      `json:"max"`
	Step      int      `json:"step"`
	MinLength int      `json:"minLength"`
	MaxLength int      `json:"maxLength"`
}

type DreaminaReferences struct {
	Min               int                  `json:"min"`
	Max               int                  `json:"max"`
	Types             []DreaminaMediaLimit `json:"types"`
	RequireAnyOfTypes []string             `json:"requireAnyOfTypes"`
}

type DreaminaMediaLimit struct {
	MediaType string `json:"mediaType"`
	Min       int    `json:"min"`
	Max       int    `json:"max"`
}

type DreaminaTextPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type DreaminaVideoPlan struct {
	Model      string             `json:"model"`
	Mode       string             `json:"mode"`
	Content    []DreaminaTextPart `json:"content"`
	References []DreaminaAsset    `json:"references,omitempty"`
	Resolution string             `json:"resolution"`
	Duration   int                `json:"duration"`
	Ratio      string             `json:"ratio,omitempty"`
}

func (mode DreaminaModelMode) flag(name string) DreaminaModeFlag {
	for _, flag := range mode.Flags {
		if flag.Flag == name {
			return flag
		}
	}
	return DreaminaModeFlag{}
}

func (mode DreaminaModelMode) durations() []int {
	duration := mode.flag("--duration")
	if duration.Min < 1 || duration.Max < duration.Min || duration.Max > 300 {
		return nil
	}
	values := make([]int, 0)
	step := max(1, duration.Step)
	for value := duration.Min; value <= duration.Max; value += step {
		values = append(values, value)
	}
	return values
}

func (mode DreaminaModelMode) referenceLimits() *VideoReferenceLimits {
	if mode.Name == "t2v" {
		return nil
	}
	counts := map[string]int{}
	total := 0
	for _, media := range mode.References.Types {
		// Bound allocations independently of the directory response.
		counts[media.MediaType] = min(50, max(0, media.Max))
		total += counts[media.MediaType]
	}
	limits := &VideoReferenceLimits{
		ImageSlots: []string{}, VideoSlots: []string{}, AudioSlots: []string{}, RequiredSlots: []string{},
		MaxImages: counts["image"], MaxTotal: min(total, mode.References.Max),
		MaxImagesWithVideo: counts["image"],
	}
	if mode.Name == "first_last_frame" {
		limits.ImageSlots = []string{"input"}
		limits.RequiredSlots = []string{"input"}
		if limits.MaxImages >= 2 {
			limits.ImageSlots = append(limits.ImageSlots, "tail_image")
		}
		return limits
	}
	for i := 1; i <= counts["image"]; i++ {
		limits.ImageSlots = append(limits.ImageSlots, fmt.Sprintf("image_%d", i))
	}
	for i := 1; i <= counts["video"]; i++ {
		limits.VideoSlots = append(limits.VideoSlots, fmt.Sprintf("video_%d", i))
	}
	for i := 1; i <= counts["audio"]; i++ {
		limits.AudioSlots = append(limits.AudioSlots, fmt.Sprintf("audio_%d", i))
	}
	return limits
}

func (m DreaminaModel) VideoStudioCapabilities() map[string]VideoCapabilities {
	capabilities := make(map[string]VideoCapabilities)
	for _, mode := range m.Modes {
		var name string
		switch mode.Name {
		case "t2v":
			name = "t2v"
		case "first_last_frame":
			name = "i2v"
		case "m2v":
			name = "reference"
		default:
			continue
		}
		durations := mode.durations()
		resolutions := make([]string, 0)
		for _, resolution := range mode.flag("--resolution").Values {
			resolutions = append(resolutions, strings.ToLower(resolution))
		}
		if len(durations) == 0 || len(resolutions) == 0 {
			continue
		}
		ratios := append([]string{}, mode.flag("--ratio").Values...)
		if name == "i2v" {
			ratios = []string{}
		}
		references := mode.referenceLimits()
		capability := VideoCapabilities{
			Durations: durations, Resolutions: resolutions, DefaultResolution: resolutions[0],
			Ratios: ratios, Modes: []string{"std"}, AudioResolutions: []string{},
			PromptMax: min(12000, mode.flag("--prompt").MaxLength), ImageMaxBytes: DreaminaMaxAssetBytes,
			References: references,
		}
		if references != nil {
			capability.MinReferences = mode.References.Min
			capability.MaxVideos = len(references.VideoSlots)
			capability.MaxAudios = len(references.AudioSlots)
			allowed := mode.References.RequireAnyOfTypes
			capability.RequiresImageOrVideo = slices.Contains(allowed, "image") && slices.Contains(allowed, "video") && !slices.Contains(allowed, "audio")
		}
		if name == "i2v" {
			for count := max(1, mode.References.Min); count <= min(2, mode.References.Max); count++ {
				capability.ReferenceCounts = append(capability.ReferenceCounts, count)
			}
			// The provider lists separate one-frame and two-frame variants.
			// Keep the wider set of slots and expose both exact supported counts.
			if previous, ok := capabilities[name]; ok {
				capability.ReferenceCounts = append(capability.ReferenceCounts, previous.ReferenceCounts...)
				capability.MinReferences = min(capability.MinReferences, previous.MinReferences)
				if previous.References.MaxImages > references.MaxImages {
					capability.References = previous.References
				}
			}
			slices.Sort(capability.ReferenceCounts)
			capability.ReferenceCounts = slices.Compact(capability.ReferenceCounts)
		}
		capabilities[name] = capability
	}
	return capabilities
}

func (m DreaminaModel) ValidateVideo(plan DreaminaVideoPlan) error {
	if plan.Model != m.ID {
		return errors.New("unsupported Dreamina model")
	}
	mode := plan.Mode
	if mode == "" {
		mode = "t2v"
	}
	if mode != "t2v" && mode != "first_last_frame" && mode != "m2v" {
		return errors.New("unsupported Dreamina video mode")
	}
	if len(plan.Content) != 1 || plan.Content[0].Type != "text" {
		return errors.New("Dreamina accepts a single text prompt")
	}
	text := plan.Content[0].Text
	promptLength := utf8.RuneCountInString(text)
	if promptLength > 12000 || strings.ContainsRune(text, 0) {
		return errors.New("invalid Dreamina text prompt")
	}
	if strings.TrimSpace(text) == "" && mode == "t2v" {
		return errors.New("Dreamina text-to-video requires a prompt")
	}
	counts := map[string]int{}
	assetIDs := map[string]struct{}{}
	for _, asset := range plan.References {
		if !IsDreaminaTaskID(asset.ID) {
			return errors.New("invalid Dreamina asset ID")
		}
		if _, exists := assetIDs[asset.ID]; exists {
			return errors.New("Dreamina reference assets must be distinct")
		}
		assetIDs[asset.ID] = struct{}{}
		counts[asset.MediaType]++
	}
	for _, catalogMode := range m.Modes {
		if catalogMode.Name != mode || !slices.Contains(catalogMode.durations(), plan.Duration) ||
			!slices.ContainsFunc(catalogMode.flag("--resolution").Values, func(value string) bool { return strings.EqualFold(value, plan.Resolution) }) {
			continue
		}
		if mode != "first_last_frame" && !slices.Contains(catalogMode.flag("--ratio").Values, plan.Ratio) {
			continue
		}
		if mode == "first_last_frame" && plan.Ratio != "" {
			return errors.New("Dreamina first and last frames determine the aspect ratio")
		}
		prompt := catalogMode.flag("--prompt")
		if promptLength < prompt.MinLength || (prompt.MaxLength > 0 && promptLength > prompt.MaxLength) {
			continue
		}
		if catalogMode.References.allows(len(plan.References), counts) {
			return nil
		}
	}
	return errors.New("Dreamina does not support this combination of mode, duration, resolution, aspect ratio, prompt or references")
}

func (rules DreaminaReferences) allows(total int, counts map[string]int) bool {
	if total < rules.Min || total > rules.Max {
		return false
	}
	known := 0
	for _, media := range rules.Types {
		count := counts[media.MediaType]
		if count < media.Min || count > media.Max {
			return false
		}
		known += count
	}
	if known != total {
		return false
	}
	return len(rules.RequireAnyOfTypes) == 0 || slices.ContainsFunc(rules.RequireAnyOfTypes, func(media string) bool { return counts[media] > 0 })
}

func DreaminaVideoStudioUnitPrices(model string, group *Group) map[string]float64 {
	if group == nil {
		return nil
	}
	multiplier := math.Max(0, resolveVideoRateMultiplier(&APIKey{Group: group}, group.RateMultiplier))
	prices := map[string]float64{}
	for _, resolution := range []string{"480p", "720p", "1080p", "4k"} {
		if price := LookupVideoModelPrice(group.VideoModelPrices, model, resolution); price != nil {
			prices[resolution] = *price * multiplier
		}
	}
	return prices
}

func (s *OpenAIGatewayService) DreaminaRelayAccount(ctx context.Context, groupID int64) (*Account, error) {
	accounts, err := s.accountRepo.ListSchedulableByGroupIDAndPlatform(ctx, groupID, PlatformKling)
	if err != nil {
		return nil, err
	}
	var selected *Account
	for i := range accounts {
		account := &accounts[i]
		if !account.IsKling() {
			continue
		}
		access, secret := account.GetKlingAccessSecret()
		if access != "" && secret != "" && (selected == nil || account.ID < selected.ID) {
			selected = account
		}
	}
	if selected == nil {
		return nil, ErrNoAvailableAccounts
	}
	return selected, nil
}

func (s *OpenAIGatewayService) DreaminaBoundRelay(ctx context.Context, groupID, accountID int64) (*Account, error) {
	accounts, err := s.accountRepo.ListByGroup(ctx, groupID)
	if err != nil {
		return nil, err
	}
	for i := range accounts {
		account := &accounts[i]
		if account.ID == accountID && account.IsKling() && account.IsActive() {
			return account, nil
		}
	}
	return nil, ErrNoAvailableAccounts
}
