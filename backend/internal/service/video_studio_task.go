package service

import "context"

// ResolveVideoStudioTaskPlatform uses the authenticated owner's binding, including
// legacy unprefixed Kling text-to-video IDs. An ID prefix alone grants no access.
func (s *OpenAIGatewayService) ResolveVideoStudioTaskPlatform(ctx context.Context, key *APIKey, userID int64, id string) (string, error) {
	_, taskID, err := ParseKlingStudioTaskID(id)
	if err != nil {
		return "", ErrNoAvailableAccounts
	}
	accountID, err := s.ResolveGrokMediaVideoRequestAccount(ctx, key.GroupID, taskID, userID, key.ID)
	if err != nil || accountID <= 0 {
		return "", ErrNoAvailableAccounts
	}
	account, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil || account == nil {
		return "", ErrNoAvailableAccounts
	}
	if account.Platform != PlatformKling && account.Platform != PlatformGrok {
		return "", ErrNoAvailableAccounts
	}
	return account.Platform, nil
}
