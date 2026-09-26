package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"demo/gin-users-api/internal/domain"
	"demo/gin-users-api/internal/repository"
	"github.com/google/uuid"
)

type UserService interface {
	Create(ctx context.Context, req domain.CreateUserRequest) (*domain.User, error)
	GetByID(ctx context.Context, id string) (*domain.User, error)
	List(ctx context.Context, q domain.ListQuery) ([]*domain.User, int, error)
	Delete(ctx context.Context, id string) error
}

type userService struct {
	repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) UserService {
	return &userService{repo: repo}
}

func (s *userService) Create(ctx context.Context, req domain.CreateUserRequest) (*domain.User, error) {
	existing, err := s.repo.GetByEmail(ctx, req.Email)
	if err != nil && !errors.Is(err, repository.ErrNoRows) {
		return nil, domain.ErrInternal.New(err)
	}
	if existing != nil {
		return nil, domain.ErrConflict.New(errors.New("email already registered"))
	}

	sum := sha256.Sum256([]byte(req.Password))
	u := &domain.User{
		ID:           uuid.NewString(),
		Name:         req.Name,
		Email:        req.Email,
		PasswordHash: hex.EncodeToString(sum[:]),
		Role:         req.Role,
		CreatedAt:    time.Now().UTC(),
	}
	if u.Role == "" {
		u.Role = "user"
	}
	if err := s.repo.Save(ctx, u); err != nil {
		return nil, domain.ErrInternal.New(err)
	}
	return u, nil
}

func (s *userService) GetByID(ctx context.Context, id string) (*domain.User, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNoRows) {
			return nil, domain.ErrNotFound.New(err)
		}
		return nil, domain.ErrInternal.New(err)
	}
	return u, nil
}

func (s *userService) List(ctx context.Context, q domain.ListQuery) ([]*domain.User, int, error) {
	page, limit := q.Page, q.Limit
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	items, total := s.repo.List(ctx, strings.TrimSpace(q.Role), (page-1)*limit, limit)
	return items, total, nil
}

func (s *userService) Delete(ctx context.Context, id string) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		if errors.Is(err, repository.ErrNoRows) {
			return domain.ErrNotFound.New(err)
		}
		return domain.ErrInternal.New(err)
	}
	return nil
}
